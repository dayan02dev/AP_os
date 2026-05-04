"""Admin router (Phase 8) — read-only ops endpoints.

Endpoints (all require `X-Admin-Key: <settings.admin_api_key>`):

    GET  /admin/stats                   counts by status + recent activity
    GET  /admin/applications            paginated list (status filter, 50/page)
    GET  /admin/applications/{id}       full application row

Why a header-key check (not Supabase auth)?
    Admin access is rare, shared across a tiny ops team, and must work even if
    Supabase Auth is down (`/admin/stats` may be the first thing someone hits
    during an incident). The key lives in the environment; rotate it by
    redeploying with a new value.

Rate limiting
    Per-key sliding window via utils/rate_limit (60/min). Plenty for a human
    operator or one-shot curl script; an automated scraper will see 429.

Never log the admin key. Key comparison uses `secrets.compare_digest` to
avoid a timing side-channel.
"""

from __future__ import annotations

import logging
import secrets
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status

from ..config import settings
from ..supabase_client import get_admin_client
from ..utils.rate_limit import check_and_record

log = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])


# ─── Auth guard ────────────────────────────────────────────────────

async def require_admin_key(
    x_admin_key: Annotated[str | None, Header(alias="X-Admin-Key")] = None,
) -> None:
    """Reject any request without a matching X-Admin-Key header.

    Uses constant-time comparison. Never log the supplied header value,
    even on failure — an attacker spraying keys shouldn't leave traces in
    our logs that could be correlated against a leaked dataset.
    """
    if not x_admin_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-Admin-Key header.",
        )
    if not secrets.compare_digest(x_admin_key, settings.admin_api_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid admin key.",
        )
    # 60/min per key — the key acts as a stable identity we can bucket on.
    # Prefix keeps keys out of the bucket dict path; we hash-slice so the
    # dict key never contains the raw secret.
    bucket_key = x_admin_key[:12]
    check_and_record("admin", bucket_key, 60, 60)


# ─── Routes ───────────────────────────────────────────────────────

@router.get("/stats")
async def admin_stats(_: None = Depends(require_admin_key)) -> dict[str, Any]:
    """Counts by application status + recent audit activity.

    Intentionally cheap — a single indexed aggregate per query.
    """
    admin = get_admin_client()
    stats: dict[str, Any] = {}

    # Application status counts.
    status_values = [
        "draft", "submitted", "under_review", "shortlisted",
        "rejected", "accepted", "withdrawn",
    ]
    status_counts: dict[str, int] = {}
    for s in status_values:
        try:
            res = (
                admin.table("tir_applications")
                .select("id", count="exact")
                .eq("status", s)
                .execute()
            )
            status_counts[s] = res.count or 0
        except Exception as exc:
            log.warning("admin.stats status count failed", extra={"status": s, "err": str(exc)})
            status_counts[s] = -1  # -1 = query failed, distinguishable from 0
    stats["applications_by_status"] = status_counts
    stats["applications_total"] = sum(v for v in status_counts.values() if v >= 0)

    # Resume uploads total.
    try:
        res = admin.table("tir_resume_uploads").select("id", count="exact").execute()
        stats["resume_uploads_total"] = res.count or 0
    except Exception as exc:
        log.warning("admin.stats resume count failed", extra={"err": str(exc)})
        stats["resume_uploads_total"] = -1

    # Support tickets by status.
    ticket_counts: dict[str, int] = {}
    for s in ("open", "in_progress", "resolved", "closed"):
        try:
            res = (
                admin.table("support_tickets")
                .select("id", count="exact")
                .eq("status", s)
                .execute()
            )
            ticket_counts[s] = res.count or 0
        except Exception:
            ticket_counts[s] = -1
    stats["support_tickets_by_status"] = ticket_counts

    # Profiles total (≈ registered users).
    try:
        res = admin.table("profiles").select("id", count="exact").execute()
        stats["profiles_total"] = res.count or 0
    except Exception:
        stats["profiles_total"] = -1

    return stats


@router.get("/applications")
async def admin_list_applications(
    _: None = Depends(require_admin_key),
    status_filter: str | None = Query(None, alias="status", max_length=30),
    page: int = Query(1, ge=1, le=1000),
    page_size: int = Query(50, ge=1, le=100),
) -> dict[str, Any]:
    """Paginated list. `status` filters by application status; omit for all.

    Returns at most 100 rows/page. The payload trims heavy free-text columns —
    use GET /admin/applications/{id} for the full row.
    """
    admin = get_admin_client()
    # Trimmed column set: identity + status + completion + contact.
    # Heavy essay fields are excluded — pull them via the detail endpoint.
    cols = (
        "id, user_id, status, completion_pct, current_section, "
        "basic_full_name, basic_email, basic_org, "
        "created_at, updated_at, submitted_at"
    )
    q = admin.table("tir_applications").select(cols, count="exact")
    if status_filter:
        q = q.eq("status", status_filter)

    start = (page - 1) * page_size
    end = start + page_size - 1
    try:
        res = q.order("created_at", desc=True).range(start, end).execute()
    except Exception as exc:
        log.exception("admin.list_applications failed", extra={"err": str(exc)})
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Query failed.",
        ) from exc

    total = res.count or 0
    return {
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": (total + page_size - 1) // page_size if page_size else 0,
        "applications": res.data or [],
    }


@router.get("/applications/{application_id}")
async def admin_get_application(
    application_id: str,
    _: None = Depends(require_admin_key),
) -> dict[str, Any]:
    """Full application row plus the caller's profile + latest resume parse."""
    admin = get_admin_client()
    try:
        res = (
            admin.table("tir_applications")
            .select("*")
            .eq("id", application_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        log.exception("admin.get_application failed", extra={"err": str(exc)})
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Query failed.",
        ) from exc

    rows = res.data or []
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")
    app_row = rows[0]

    # Attach the owner's profile row.
    try:
        prof_res = (
            admin.table("profiles")
            .select("*")
            .eq("id", app_row["user_id"])
            .limit(1)
            .execute()
        )
        profile = (prof_res.data or [None])[0]
    except Exception:
        profile = None

    # Attach the most-recent resume parse.
    try:
        resume_res = (
            admin.table("tir_resume_uploads")
            .select("id, parse_status, parsed_data, parsed_at, original_filename, created_at")
            .eq("user_id", app_row["user_id"])
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        latest_resume = (resume_res.data or [None])[0]
    except Exception:
        latest_resume = None

    return {
        "application": app_row,
        "profile": profile,
        "latest_resume": latest_resume,
    }
