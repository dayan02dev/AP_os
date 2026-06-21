"""Admin-portal pipeline + detail router (Task 6).

Two read endpoints that back the admin Pipeline view:

    GET /admin/platform/applications
        Cross-track pipeline list with admin-portal joins (latest decision,
        hide/archive meta, batch). Hidden/archived excluded by default.

    GET /admin/platform/applications/{track}/{application_id}
        Full application detail + admin decision/meta/batch.

Both wrap `services.admin_query`, which reuses the leadership/applications_query
helpers so the query logic lives in one place. Guarded by the same leadership
capabilities (`view_all_apps` / `view_app_detail`) that admins also hold — see
`rbac.ROLE_CAPABILITIES`.
"""

from __future__ import annotations

import csv
import io
import logging
from datetime import UTC, datetime
from typing import Any, Literal

log = logging.getLogger(__name__)

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi import status as http_status
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from ..deps import get_current_user
from ..rbac import require_capability
from ..services import admin_query, decisions
from ..services.audit import actor_role_of, write_audit
from ..supabase_client import get_admin_client

router = APIRouter(prefix="/admin/platform", tags=["admin-platform"])


@router.get(
    "/applications",
    dependencies=[Depends(require_capability("view_all_apps"))],
)
async def list_pipeline(
    track: str | None = None,
    status: str | None = None,
    industry: str | None = None,
    decision: str | None = None,
    batch_id: str | None = None,
    search: str | None = None,
    include_hidden: bool = False,
    include_archived: bool = False,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Admin pipeline list with decision / meta / batch joins."""
    return admin_query.fetch_pipeline({
        "track":            track,
        "status":           status,
        "industry":         industry,
        "decision":         decision,
        "batch_id":         batch_id,
        "search":           search,
        "include_hidden":   include_hidden,
        "include_archived": include_archived,
    })


@router.get(
    "/applications/{track}/{application_id}",
    dependencies=[Depends(require_capability("view_app_detail"))],
)
async def get_detail(
    track: Literal["tir", "sip"],
    application_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Full admin detail for one application; 404 if not found."""
    payload = admin_query.fetch_detail(track, application_id)
    if payload is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail={"code": "application_not_found"},
        )
    return payload


class DecisionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: Literal["shortlisted", "on_hold", "rejected", "waitlisted"]
    rationale: str | None = None


@router.post(
    "/applications/{track}/{application_id}/decision",
    dependencies=[Depends(require_capability("decide_application"))],
)
async def decide(
    track: Literal["tir", "sip"],
    application_id: str,
    body: DecisionBody,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Gate-1 admin decision: guarded status change + admin_decisions + audit.

    Reject / waitlist / hold require a rationale; shortlist may omit one.
    """
    if body.decision in ("rejected", "waitlisted", "on_hold") and not (body.rationale or "").strip():
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "rationale_required",
                "message": "A rationale is required for reject / waitlist / hold.",
            },
        )
    return decisions.record_decision(
        track=track, application_id=application_id,
        decision=body.decision, rationale=body.rationale,
        decided_by=user["user_id"],
        decided_by_role=actor_role_of(user),
    )


class BulkDecisionItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    track: Literal["tir", "sip"]
    application_id: str
    decision: Literal["shortlisted", "on_hold", "rejected", "waitlisted"]
    rationale: str | None = None


class BulkDecisionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[BulkDecisionItem] = Field(..., min_length=1, max_length=200)


@router.post("/decisions/bulk", dependencies=[Depends(require_capability("decide_application"))])
async def bulk_decide(body: BulkDecisionBody, user: dict = Depends(get_current_user)) -> dict:
    """Bulk gate-1 decisions: per-id result dict instead of raising on individual failures."""
    caller_role = actor_role_of(user)
    results = [
        decisions.record_decision_safe(
            track=i.track, application_id=i.application_id,
            decision=i.decision, rationale=i.rationale,
            decided_by=user["user_id"],
            decided_by_role=caller_role,
        )
        for i in body.items
    ]
    return {"results": results}


class MetaBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    is_hidden: bool | None = None
    is_archived: bool | None = None
    hidden_reason: str | None = None


# ─── Task 12: Audit-log read endpoint + CSV ──────────────────────────────


@router.get(
    "/audit-log",
    dependencies=[Depends(require_capability("view_audit_log"))],
)
async def get_audit_log(
    actor: str | None = None,
    action: str | None = None,
    from_: str | None = Query(None, alias="from"),
    to: str | None = Query(None),
    format: str = "json",
    user: dict = Depends(get_current_user),
):
    """Merged audit-log from audit_log_v2 + application_status_log.

    Returns JSON {entries: [...]} by default; format=csv returns text/csv.
    Each entry has keys: ts, actor, action, target, detail.
    Filters: actor (substring), action (eq/prefix), from (ts >=), to (ts <=).
    """
    entries = admin_query.fetch_audit({
        "actor":  actor,
        "action": action,
        "from":   from_,
        "to":     to,
    })

    if format == "csv":
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(["ts", "actor", "action", "target", "detail"])
        for e in entries:
            writer.writerow([e["ts"], e["actor"], e["action"], e["target"], e["detail"]])
        return Response(content=buf.getvalue(), media_type="text/csv")

    return {"entries": entries}


# ─── Task 10: Batches CRUD + bulk assign ──────────────────────────────────


class BatchCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(..., min_length=1)
    phase: str | None = None


class BatchRename(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = None
    phase: str | None = None


class BatchAssignItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    track: Literal["tir", "sip"]
    application_id: str


class BatchAssign(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[BatchAssignItem] = Field(..., min_length=1, max_length=500)


@router.get("/batches", dependencies=[Depends(require_capability("manage_batches"))])
async def list_batches() -> dict:
    """List all batches."""
    sb = get_admin_client()
    data = sb.table("batches").select("*").execute().data or []
    return {"batches": data}


@router.post("/batches", dependencies=[Depends(require_capability("manage_batches"))])
async def create_batch(body: BatchCreate, user: dict = Depends(get_current_user)) -> dict:
    """Create a new batch."""
    sb = get_admin_client()
    row: dict[str, Any] = {
        "name": body.name,
        "created_at": datetime.now(UTC).isoformat(),
        "updated_at": datetime.now(UTC).isoformat(),
    }
    if body.phase is not None:
        row["phase"] = body.phase
    result = sb.table("batches").insert(row).execute()
    write_audit(
        actor_user_id=user["user_id"],
        actor_role=actor_role_of(user),
        action_type="batch_created",
        target_table="batches",
        target_id=None,
        after=row,
    )
    data = result.data
    return data[0] if data else row


@router.patch(
    "/batches/{batch_id}",
    dependencies=[Depends(require_capability("manage_batches"))],
)
async def rename_batch(
    batch_id: str,
    body: BatchRename,
    user: dict = Depends(get_current_user),
) -> dict:
    """Update batch name and/or phase."""
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if not fields:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "no_fields", "message": "Provide at least one field."},
        )
    sb = get_admin_client()
    existing = sb.table("batches").select("id").eq("id", batch_id).limit(1).execute().data
    if not existing:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail={"code": "batch_not_found"},
        )
    fields["updated_at"] = datetime.now(UTC).isoformat()
    sb.table("batches").update(fields).eq("id", batch_id).execute()
    write_audit(
        actor_user_id=user["user_id"],
        actor_role=actor_role_of(user),
        action_type="batch_updated",
        target_table="batches",
        target_id=batch_id,
        after=fields,
    )
    return {"batch_id": batch_id, **fields}


@router.post(
    "/batches/{batch_id}/applications",
    dependencies=[Depends(require_capability("manage_batches"))],
)
async def assign_applications(
    batch_id: str,
    body: BatchAssign,
    user: dict = Depends(get_current_user),
) -> dict:
    """Bulk-assign applications to a batch (upsert moves app between batches)."""
    sb = get_admin_client()
    existing = sb.table("batches").select("id").eq("id", batch_id).limit(1).execute().data
    if not existing:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail={"code": "batch_not_found"},
        )
    now = datetime.now(UTC).isoformat()
    rows = [
        {
            "application_id": item.application_id,
            "application_track": item.track,
            "batch_id": batch_id,
            "added_at": now,
        }
        for item in body.items
    ]
    sb.table("application_batches").upsert(
        rows, on_conflict="application_id,application_track"
    ).execute()
    n = len(body.items)
    write_audit(
        actor_user_id=user["user_id"],
        actor_role=actor_role_of(user),
        action_type="batch_applications_assigned",
        target_table="application_batches",
        target_id=batch_id,
        after={"count": n},
    )
    return {"assigned": n}


class BatchReviewersBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reviewer_user_ids: list[str] = Field(..., min_length=1, max_length=50)


@router.post(
    "/batches/{batch_id}/reviewers",
    dependencies=[Depends(require_capability("manage_reviewers_roster"))],
)
async def assign_batch_reviewers(
    batch_id: str,
    body: BatchReviewersBody,
    user: dict = Depends(get_current_user),
) -> dict:
    """Assign reviewers to every application in a batch.

    Creates one reviewer_assignment per (app in batch × reviewer), skipping any
    (application_id, application_track, reviewer_user_id) triple that already
    exists. Returns the number of rows actually inserted, the reviewer count,
    and the number of applications in the batch.
    """
    sb = get_admin_client()
    existing_batch = sb.table("batches").select("id").eq("id", batch_id).limit(1).execute().data
    if not existing_batch:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail={"code": "batch_not_found"},
        )

    # Apps in this batch. `.eq()` narrows on real PostgREST; the fake no-ops
    # `.eq()` for non-PK selects, so re-filter in Python on batch_id.
    link_rows = (
        sb.table("application_batches")
        .select("application_id,application_track,batch_id")
        .eq("batch_id", batch_id)
        .execute()
        .data
    ) or []
    apps = [
        (r["application_id"], r["application_track"])
        for r in link_rows
        if r.get("batch_id") == batch_id and r.get("application_id") and r.get("application_track")
    ]

    reviewer_ids = list(dict.fromkeys(body.reviewer_user_ids))  # dedupe, keep order

    # Existing assignments for these apps × reviewers, so we skip duplicates.
    # Bulk-fetch all assignments then filter in Python (fake `.in_()` no-ops).
    app_keys = set(apps)
    existing_pairs: set[tuple[str, str, str]] = set()
    for a in (sb.table("reviewer_assignments").select("*").execute().data) or []:
        key = (a.get("application_id"), a.get("application_track"))
        rid = a.get("reviewer_user_id")
        if key in app_keys and rid in set(reviewer_ids):
            existing_pairs.add((a.get("application_id"), a.get("application_track"), rid))

    now = datetime.now(UTC).isoformat()
    rows = [
        {
            "application_id": aid,
            "application_track": track,
            "reviewer_user_id": rid,
            "assigned_by": user["user_id"],
            "assigned_at": now,
            "state": "pending",
            "due_at": None,
        }
        for (aid, track) in apps
        for rid in reviewer_ids
        if (aid, track, rid) not in existing_pairs
    ]
    if rows:
        sb.table("reviewer_assignments").insert(rows).execute()
    created = len(rows)

    write_audit(
        actor_user_id=user["user_id"],
        actor_role=actor_role_of(user),
        action_type="batch_reviewers_assigned",
        target_table="batches",
        target_id=batch_id,
        after={
            "created": created,
            "reviewers": len(reviewer_ids),
            "applications": len(apps),
        },
    )
    return {
        "created": created,
        "reviewers": len(reviewer_ids),
        "applications": len(apps),
    }


@router.delete(
    "/batches/{batch_id}/reviewers/{reviewer_user_id}",
    dependencies=[Depends(require_capability("manage_reviewers_roster"))],
)
async def unassign_batch_reviewer(
    batch_id: str,
    reviewer_user_id: str,
    user: dict = Depends(get_current_user),
) -> dict:
    """Remove a reviewer's assignments for a batch's apps.

    Only deletes assignments where NO review has been submitted yet (mirrors the
    leadership unassign guard). Returns the number of assignments removed.
    """
    sb = get_admin_client()
    existing_batch = sb.table("batches").select("id").eq("id", batch_id).limit(1).execute().data
    if not existing_batch:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail={"code": "batch_not_found"},
        )

    link_rows = (
        sb.table("application_batches")
        .select("application_id,application_track,batch_id")
        .eq("batch_id", batch_id)
        .execute()
        .data
    ) or []
    apps = [
        (r["application_id"], r["application_track"])
        for r in link_rows
        if r.get("batch_id") == batch_id and r.get("application_id") and r.get("application_track")
    ]

    # Apps that already have a submitted review by this reviewer — guard so we
    # never orphan a scored review. Bulk-fetch + Python filter (fake-friendly).
    reviewed_keys: set[tuple[str, str]] = set()
    for rv in (sb.table("reviews").select("*").execute().data) or []:
        if (
            rv.get("reviewer_user_id") == reviewer_user_id
            and rv.get("status") == "submitted"
        ):
            reviewed_keys.add((rv.get("application_id"), rv.get("application_track")))

    removed = 0
    for (aid, track) in apps:
        if (aid, track) in reviewed_keys:
            continue
        res = (
            sb.table("reviewer_assignments")
            .delete()
            .eq("application_id", aid)
            .eq("application_track", track)
            .eq("reviewer_user_id", reviewer_user_id)
            .execute()
        )
        removed += len(res.data or [])

    write_audit(
        actor_user_id=user["user_id"],
        actor_role=actor_role_of(user),
        action_type="batch_reviewers_unassigned",
        target_table="batches",
        target_id=batch_id,
        after={"reviewer_user_id": reviewer_user_id, "removed": removed},
    )
    return {"removed": removed}


@router.patch(
    "/applications/{track}/{application_id}/meta",
    dependencies=[Depends(require_capability("view_all_apps"))],
)
async def update_meta(
    track: Literal["tir", "sip"],
    application_id: str,
    body: MetaBody,
    user: dict = Depends(get_current_user),
) -> dict:
    """Upsert hide/archive meta for an application; audited."""
    fields = {k: v for k, v in body.model_dump(exclude_unset=True).items()}
    if not fields:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "no_fields", "message": "Provide at least one field."},
        )
    sb = get_admin_client()
    row = {
        "application_id": application_id,
        "application_track": track,
        "updated_at": datetime.now(UTC).isoformat(),
        "updated_by": user["user_id"],
        **fields,
    }
    sb.table("application_admin_meta").upsert(
        row, on_conflict="application_id,application_track"
    ).execute()
    write_audit(
        actor_user_id=user["user_id"],
        actor_role=actor_role_of(user),
        action_type="admin_meta_update",
        target_table=f"{track}_applications",
        target_id=application_id,
        after=fields,
    )
    return {"application_id": application_id, "track": track, **fields}


# ─── Task 11: Reviewer roster (metrics + profile patch + rebalance) ────────


class ReviewerProfileBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    weight: float | None = None
    domains: list[str] | None = None
    batch_id: str | None = None
    # Identity fields live on `profiles` (not reviewer_profiles). Admin can
    # correct a reviewer's display name / contact email from the roster.
    full_name: str | None = None
    email: str | None = None


class RebalanceBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    track: Literal["tir", "sip"] | None = None


@router.get(
    "/reviewers",
    dependencies=[Depends(require_capability("manage_reviewers_roster"))],
)
async def list_reviewers() -> dict[str, Any]:
    """Reviewer roster with workload + consistency metrics."""
    return admin_query.fetch_roster()


@router.patch(
    "/reviewers/{user_id}",
    dependencies=[Depends(require_capability("manage_reviewers_roster"))],
)
async def update_reviewer_profile(
    user_id: str,
    body: ReviewerProfileBody,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Edit a reviewer's roster details.

    Splits across two tables: expertise/weight/batch live on
    ``reviewer_profiles``; the display name + contact email live on
    ``profiles`` (and, for email, the auth user so login stays consistent).
    """
    # reviewer_profiles fields
    fields: dict[str, Any] = {}
    if body.weight is not None:
        fields["weight"] = body.weight
    if body.domains is not None:
        fields["expertise_domains"] = body.domains
    if body.batch_id is not None:
        fields["batch_id"] = body.batch_id

    # profiles (identity) fields
    profile_fields: dict[str, Any] = {}
    if body.full_name is not None:
        profile_fields["full_name"] = body.full_name.strip()
    if body.email is not None:
        profile_fields["email"] = body.email.strip()

    if not fields and not profile_fields:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "no_fields", "message": "Provide at least one field."},
        )

    sb = get_admin_client()

    if fields:
        sb.table("reviewer_profiles").upsert(
            {
                "reviewer_user_id": user_id,
                "updated_at": datetime.now(UTC).isoformat(),
                **fields,
            },
            on_conflict="reviewer_user_id",
        ).execute()

    if profile_fields:
        # UPDATE (not upsert): the reviewer already has a profiles row from
        # invite time. An upsert's INSERT path validates NOT NULL on `email`
        # before the ON CONFLICT update kicks in, so a name-only edit (email
        # omitted) would fail with a not-null violation.
        sb.table("profiles").update(profile_fields).eq("id", user_id).execute()
        # Keep the auth login email in sync (best-effort — a unique-collision
        # or auth error must not undo the profile write above).
        if "email" in profile_fields:
            try:
                sb.auth.admin.update_user_by_id(
                    user_id,
                    {"email": profile_fields["email"], "email_confirm": True},
                )
            except Exception as exc:  # noqa: BLE001
                logging.getLogger(__name__).warning(
                    "reviewer email auth-sync failed for %s: %s", user_id, exc
                )

    after = {**fields, **profile_fields}
    write_audit(
        actor_user_id=user["user_id"],
        actor_role=actor_role_of(user),
        action_type="reviewer_profile_update",
        target_table="reviewer_profiles",
        target_id=user_id,
        after=after,
    )
    return {"reviewer_user_id": user_id, **after}


# ─── Task 13: Reviewer-calibration analytics + admin dashboard stats ────────


@router.get(
    "/analytics/reviewer-calibration",
    dependencies=[Depends(require_capability("view_stats"))],
)
async def get_reviewer_calibration() -> dict[str, Any]:
    """Per-reviewer calibration analytics: n_reviews, avg_score, avg_variance_vs_ai.

    Gated by `view_stats` (leadership + admin). Bulk-fetches reviewers,
    submitted reviews, and ai_screening rows without per-reviewer N+1 loops.
    """
    return admin_query.fetch_calibration()


@router.get(
    "/stats",
    dependencies=[Depends(require_capability("view_stats"))],
)
async def get_admin_stats() -> dict[str, Any]:
    """Admin dashboard stats: full leadership stats shape + admin_decisions counts.

    Reuses the leadership get_stats route logic for totals/funnel/status_counts/
    ai_score_overalls, then layers in a `decisions` dict counting admin_decisions
    rows by their decision value (shortlisted/on_hold/rejected/waitlisted).
    """
    from .leadership import get_stats as _leadership_get_stats

    # Call the leadership stats aggregation (same async route fn, no required args).
    base: dict[str, Any] = await _leadership_get_stats()

    # Count admin_decisions by decision value — one bulk fetch, grouped in Python.
    sb = admin_query.get_admin_client()
    try:
        dec_rows = (sb.table("admin_decisions").select("decision").execute().data) or []
    except Exception as exc:
        log.warning("admin_stats: admin_decisions fetch failed", extra={"err": str(exc)})
        dec_rows = []

    decision_counts: dict[str, int] = {}
    for row in dec_rows:
        d = row.get("decision")
        if d:
            decision_counts[d] = decision_counts.get(d, 0) + 1

    base["decisions"] = decision_counts
    return base


@router.post(
    "/reviewers/rebalance",
    dependencies=[Depends(require_capability("manage_reviewers_roster"))],
)
async def rebalance_reviewers(
    body: RebalanceBody,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Distribute every unassigned non-draft app round-robin across reviewers.

    Creates one reviewer_assignment per app (state pending). Returns the count
    of assignments created and the number of reviewers used.
    """
    reviewer_ids = admin_query._reviewer_user_ids()
    if not reviewer_ids:
        return {"assigned": 0, "reviewers": 0}

    apps = admin_query.fetch_unassigned_apps(body.track)
    if not apps:
        return {"assigned": 0, "reviewers": 0}

    sb = get_admin_client()
    now = datetime.now(UTC).isoformat()
    n_rev = len(reviewer_ids)
    rows = [
        {
            "application_id": app_ref["application_id"],
            "application_track": app_ref["application_track"],
            "reviewer_user_id": reviewer_ids[i % n_rev],
            "assigned_by": user["user_id"],
            "assigned_at": now,
            "state": "pending",
            "due_at": None,
        }
        for i, app_ref in enumerate(apps)
    ]
    sb.table("reviewer_assignments").insert(rows).execute()
    created = len(rows)

    write_audit(
        actor_user_id=user["user_id"],
        actor_role=actor_role_of(user),
        action_type="reviewer_rebalance",
        target_table="reviewer_assignments",
        target_id=None,
        after={"assigned": created, "reviewers": n_rev, "track": body.track},
    )
    return {"assigned": created, "reviewers": n_rev}
