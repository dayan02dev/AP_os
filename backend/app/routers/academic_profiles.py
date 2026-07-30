"""Cached enrichment of academic-roster profile pages.

    GET  /admin/platform/academic-profiles?profile_url=…   cached row or null
    POST /admin/platform/academic-profiles/enrich           fetch + extract + cache

Both are gated by ``manage_jury_roster`` (admin only) — this is roster work, and
the enrich call spends money and makes an outbound request, so it is not
something the wider leadership role should be able to trigger.

The fetch target is validated by exact match against the roster allow-list in
``services/academic_enrichment/fetch.py``; see that module for why a host
allow-list would not be sufficient here.

A ``done`` row is returned as-is unless ``force`` is set, so opening the same
professor twice costs nothing.
"""
# NOTE: no `from __future__ import annotations` — FastAPI + pydantic 2 cannot
# resolve stringified deps (same constraint as routers/jury.py).

import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi import status as http_status
from pydantic import BaseModel, ConfigDict, Field

from ..deps import get_current_user
from ..rbac import require_capability
from ..services.academic_enrichment import run as enrich_run
from ..services.academic_enrichment.fetch import FetchError, is_allowed
from ..supabase_client import get_admin_client

log = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/platform/academic-profiles", tags=["academic-profiles"])

_TABLE = "academic_profiles"


class EnrichBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    profile_url: str = Field(..., min_length=4, max_length=2000)
    name: str | None = Field(default=None, max_length=200)
    # Re-fetch even when a completed row is already cached.
    force: bool = False


def _public(row: dict | None) -> dict | None:
    if not row:
        return None
    return {
        "profile_url":   row.get("profile_url"),
        "name":          row.get("name"),
        "status":        row.get("status"),
        "error_code":    row.get("error_code"),
        "error":         row.get("error"),
        "http_status":   row.get("http_status"),
        "extracted":     row.get("extracted"),
        "model":         row.get("model"),
        "content_chars": row.get("content_chars"),
        "fetched_at":    row.get("fetched_at"),
    }


def _fetch_row(sb: Any, profile_url: str) -> dict | None:
    try:
        rows = (sb.table(_TABLE).select("*")
                .eq("profile_url", profile_url).limit(1).execute().data) or []
    except Exception as exc:
        log.warning("academic_profiles: read failed",
                    extra={"profile_url": profile_url, "err": str(exc)})
        return None
    rows = [r for r in rows if r.get("profile_url") == profile_url]
    return rows[0] if rows else None


def _upsert(sb: Any, payload: dict) -> dict:
    try:
        sb.table(_TABLE).upsert(payload, on_conflict="profile_url").execute()
    except Exception as exc:
        log.error("academic_profiles: upsert failed",
                  extra={"profile_url": payload.get("profile_url"), "err": str(exc)})
    return payload


@router.get("", dependencies=[Depends(require_capability("manage_jury_roster"))])
async def get_academic_profile(
    profile_url: str = Query(..., min_length=4, max_length=2000),
) -> dict[str, Any]:
    """Cached enrichment for one profile URL, or ``{"profile": null}``.

    Never 404s or 500s on a miss — the professor page renders a "Fetch details"
    prompt when this comes back null.
    """
    row = _fetch_row(get_admin_client(), profile_url.strip())
    return {"profile": _public(row), "enrichable": is_allowed(profile_url.strip())}


@router.post("/enrich", dependencies=[Depends(require_capability("manage_jury_roster"))])
async def enrich_academic_profile(
    body: EnrichBody, user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Fetch + extract one profile page and cache the result.

    Failures are recorded as ``status='failed'`` with a code and returned as a
    200 alongside that row, NOT raised — the UI shows an inline explanation with
    a Retry, and a hard error here would surface as an opaque "Failed to fetch"
    (the CORS-less-500 trap from the 07-27 jury fixes). The one exception is a
    URL outside the roster, which is a caller bug and gets a 422.
    """
    url = body.profile_url.strip()
    if not is_allowed(url):
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "url_not_in_roster",
                    "message": "That profile URL is not part of the academic roster."})

    sb = get_admin_client()
    existing = _fetch_row(sb, url)
    if existing and existing.get("status") == "done" and not body.force:
        return {"profile": _public(existing), "cached": True}

    now = datetime.now(UTC).isoformat()
    base = {
        "profile_url": url,
        "name": (body.name or (existing or {}).get("name") or None),
        "enriched_by": user["user_id"],
        "updated_at": now,
    }

    try:
        result = enrich_run.enrich(url)
    except FetchError as exc:
        row = _upsert(sb, {
            **base, "status": "failed", "error_code": exc.code, "error": exc.message,
            "http_status": exc.http_status, "fetched_at": now,
        })
        return {"profile": _public({**(existing or {}), **row}), "cached": False}
    except Exception as exc:  # noqa: BLE001 — never let this bubble to a bare 500
        log.exception("academic enrich unexpected failure", extra={"profile_url": url})
        row = _upsert(sb, {
            **base, "status": "failed", "error_code": "unexpected",
            "error": "Enrichment failed unexpectedly. Try again.",
            "fetched_at": now,
        })
        del exc
        return {"profile": _public({**(existing or {}), **row}), "cached": False}

    row = _upsert(sb, {
        **base,
        "status": "done",
        "error_code": None,
        "error": None,
        "http_status": result["http_status"],
        "extracted": result["extracted"],
        "model": result["model"],
        "content_chars": result["content_chars"],
        "fetched_at": now,
    })
    return {
        "profile": _public(row),
        "cached": False,
        # The page distinguishes "fetched but the page said nothing" from
        # "not fetched yet", so it never shows a blank card as if it were data.
        "empty": enrich_run.is_empty(result["extracted"]),
    }
