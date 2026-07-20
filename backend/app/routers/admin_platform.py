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
from ..services import admin_query, applications_query, decisions, track_move
from ..services.assignment_email import notify_reviewers_assigned
from ..services.audit import actor_role_of, write_audit
from ..supabase_client import get_admin_client

router = APIRouter(prefix="/admin/platform", tags=["admin-platform"])


def _native_track(application_id: str, hint: str) -> str:
    """Resolve the physical (native) track for an application id. Under the
    track-move overlay the frontend passes the effective/display track, but
    writes must target the table the row actually lives in. Falls back to the
    URL `hint` if the probe can't locate the id (record_decision then 404s)."""
    found = applications_query.find_application_with_track(application_id)
    return found[0] if found else hint


@router.get(
    "/applications",
    dependencies=[Depends(require_capability("view_all_apps"))],
)
async def list_pipeline(
    track: str | None = None,
    status: str | None = None,
    exclude_status: str | None = None,
    industry: str | None = None,
    decision: str | None = None,
    batch_id: str | None = None,
    search: str | None = None,
    include_hidden: bool = False,
    include_archived: bool = False,
    recommended_for: str | None = None,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Admin pipeline list with decision / meta / batch / jury-pick joins.

    ``recommended_for=<juror_user_id>`` narrows the list to that juror's
    precomputed jury recommendations, attaches a ``recommendation`` block per
    row, and sorts by fit score. Omit it for the normal newest-first pipeline.
    """
    return admin_query.fetch_pipeline({
        "track":            track,
        "status":           status,
        "exclude_status":    exclude_status,
        "industry":         industry,
        "decision":         decision,
        "batch_id":         batch_id,
        "search":           search,
        "include_hidden":   include_hidden,
        "include_archived": include_archived,
        "recommended_for":  recommended_for,
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
    decision: Literal["shortlisted", "on_hold", "rejected", "waitlisted", "jury_review", "offered"]
    rationale: str | None = None
    gate_stage: Literal["gate1", "gate2"] = "gate1"


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
    """Gate-1 or Gate-2 admin decision: guarded status change + admin_decisions + audit.

    gate_stage="gate1" (default): shortlisted/on_hold/rejected/waitlisted/jury_review —
        reject/waitlist/hold require a rationale; shortlist may omit one.
    gate_stage="gate2": offered/waitlisted/on_hold/rejected —
        routed via decisions.record_gate2_decision which enforces its own
        rationale rule (required unless decision is 'offered').
    """
    # Under the track-move overlay the frontend passes the EFFECTIVE track, but
    # the application row + all its child tables (admin_decisions, status) live
    # in the NATIVE table. Resolve the native track from the id so the write
    # hits the right table; the URL track is only a hint.
    track = _native_track(application_id, track)
    # Route to gate-2 when gate_stage is explicitly "gate2" OR when the
    # decision is "offered" (offered is a gate-2-only outcome; accepting it
    # on the gate-1 path would record the wrong gate_stage in admin_decisions).
    is_gate2 = (body.gate_stage == "gate2") or (body.decision == "offered")
    if is_gate2:
        return decisions.record_gate2_decision(
            track=track, application_id=application_id,
            decision=body.decision, rationale=body.rationale,
            decided_by=user["user_id"],
            decided_by_role=actor_role_of(user),
        )
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


@router.post(
    "/applications/{track}/{application_id}/move-track",
    dependencies=[Depends(require_capability("decide_application"))],
)
async def move_track(
    track: Literal["tir", "sip"],
    application_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Toggle a reversible TIR<->VIP reclassification flag (admin only).

    The flag lives on the NATIVE application row, so resolve the native track
    from the id (the URL track may be the effective/display track)."""
    track = _native_track(application_id, track)
    return track_move.move_track(
        track=track, application_id=application_id,
        actor_user_id=user["user_id"], actor_role=actor_role_of(user),
    )


class BulkDecisionItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    track: Literal["tir", "sip"]
    application_id: str
    decision: Literal["shortlisted", "on_hold", "rejected", "waitlisted", "jury_review"]
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


@router.delete(
    "/batches/{batch_id}",
    dependencies=[Depends(require_capability("manage_batches"))],
)
async def delete_batch(
    batch_id: str,
    user: dict = Depends(get_current_user),
) -> dict:
    """Delete a batch (unlink-only).

    Removes the batch and its `application_batches` links (apps revert to no
    batch → "Random allotment"), and clears any `reviewer_profiles.batch_id`
    pointing at it. `reviewer_assignments` and `reviews` are left untouched, so
    no scored work is orphaned.
    """
    sb = get_admin_client()
    existing = (
        sb.table("batches").select("id,name").eq("id", batch_id).limit(1).execute().data
    )
    if not existing:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail={"code": "batch_not_found"},
        )
    # 1. Unlink applications (revert to no batch / Random allotment).
    sb.table("application_batches").delete().eq("batch_id", batch_id).execute()
    # 2. Clear reviewer_profiles.batch_id references (avoid a dangling pointer).
    sb.table("reviewer_profiles").update({"batch_id": None}).eq("batch_id", batch_id).execute()
    # 3. Delete the batch row.
    sb.table("batches").delete().eq("id", batch_id).execute()
    write_audit(
        actor_user_id=user["user_id"],
        actor_role=actor_role_of(user),
        action_type="batch_deleted",
        target_table="batches",
        target_id=batch_id,
        before={"name": existing[0].get("name")},
    )
    return {"ok": True, "batch_id": batch_id}


@router.post(
    "/batches/{batch_id}/applications",
    dependencies=[Depends(require_capability("manage_batches"))],
)
async def assign_applications(
    batch_id: str,
    body: BatchAssign,
    user: dict = Depends(get_current_user),
) -> dict:
    """Bulk-assign applications to a batch (upsert moves an app between batches).

    Additively fans out to the batch's CURRENT reviewers: every reviewer with an
    active assignment on an app already in the batch gets a new reviewer_assignment
    for each newly-added app (skipping existing triples) and is emailed. Moving an
    app between batches does NOT strip the previous batch's assignments.
    """
    sb = get_admin_client()
    existing = sb.table("batches").select("id").eq("id", batch_id).limit(1).execute().data
    if not existing:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail={"code": "batch_not_found"},
        )
    # Append apps to the batch (multi-batch: an app may be in many batches) and
    # fan out THIS batch's reviewers (batch_reviewers) to the newly-added apps.
    from app.services import batch_membership

    items = [(item.application_id, item.track) for item in body.items]
    result = batch_membership.add_apps_to_batch(
        sb, batch_id, items, actor=user["user_id"]
    )
    if result["created_rows"]:
        notify_reviewers_assigned(sb, result["created_rows"])

    write_audit(
        actor_user_id=user["user_id"],
        actor_role=actor_role_of(user),
        action_type="batch_applications_assigned",
        target_table="application_batches",
        target_id=batch_id,
        after={
            "count": result["assigned"],
            "assignments_created": result["assignments_created"],
            "reviewers_notified": result["reviewers_notified"],
        },
    )
    return {
        "assigned": result["assigned"],
        "assignments_created": result["assignments_created"],
        "reviewers_notified": result["reviewers_notified"],
    }


@router.post(
    "/batches/{batch_id}/applications/remove",
    dependencies=[Depends(require_capability("manage_batches"))],
)
async def remove_applications_from_batch(
    batch_id: str,
    body: BatchAssign,
    user: dict = Depends(get_current_user),
) -> dict:
    """Detach applications from ONE batch (smart remove).

    Multi-batch aware: keeps a reviewer that another of the app's remaining
    batches still supplies, and never removes a reviewer who already submitted a
    review. Leaves the app's other batch memberships untouched.
    """
    sb = get_admin_client()
    from app.services import batch_membership

    removed = 0
    skipped = 0
    for item in body.items:
        r = batch_membership.remove_app_from_batch(
            sb, batch_id, item.application_id, item.track, actor=user["user_id"]
        )
        removed += r["assignments_removed"]
        skipped += r["skipped_submitted"]

    write_audit(
        actor_user_id=user["user_id"],
        actor_role=actor_role_of(user),
        action_type="batch_applications_removed",
        target_table="application_batches",
        target_id=batch_id,
        after={
            "count": len(body.items),
            "assignments_removed": removed,
            "skipped_submitted": skipped,
        },
    )
    return {
        "removed": len(body.items),
        "assignments_removed": removed,
        "skipped_submitted": skipped,
    }


@router.post(
    "/batches/unassign",
    dependencies=[Depends(require_capability("manage_batches"))],
)
async def unassign_applications(
    body: BatchAssign,
    user: dict = Depends(get_current_user),
) -> dict:
    """Remove applications from whatever batch they are in AND every reviewer.

    Deletes each app's `application_batches` row plus ALL of its
    `reviewer_assignments` rows (every reviewer, not just one) via
    `detach_application_from_review`, so an unassigned app disappears from
    every reviewer's queue/roster consistently. `reviews` rows are kept for
    audit. Idempotent: an app that is already unbatched/unassigned
    contributes 0 to both counters.
    """
    sb = get_admin_client()
    removed = 0
    assignments_removed = 0
    for item in body.items:
        result = applications_query.detach_application_from_review(
            sb, item.application_id, item.track, remove_batch_link=True,
        )
        removed += result["batch_links_removed"]
        assignments_removed += result["assignments_removed"]
    write_audit(
        actor_user_id=user["user_id"],
        actor_role=actor_role_of(user),
        action_type="batch_applications_unassigned",
        target_table="application_batches",
        target_id=None,
        after={"removed": removed, "assignments_removed": assignments_removed,
               "count": len(body.items)},
    )
    return {"removed": removed, "assignments_removed": assignments_removed}


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

    # Row-creation is shared with the reviewer-invite flow (admin_query); this
    # endpoint additionally emails the newly-assigned reviewers and audits.
    result = admin_query.assign_reviewers_to_batch(
        sb, batch_id, body.reviewer_user_ids, assigned_by=user["user_id"],
    )
    if result["created_rows"]:
        notify_reviewers_assigned(sb, result["created_rows"])
    created = result["created"]

    write_audit(
        actor_user_id=user["user_id"],
        actor_role=actor_role_of(user),
        action_type="batch_reviewers_assigned",
        target_table="batches",
        target_id=batch_id,
        after={
            "created": created,
            "reviewers": result["reviewers"],
            "applications": result["applications"],
        },
    )
    return {
        "created": created,
        "reviewers": result["reviewers"],
        "applications": result["applications"],
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
    """Remove a reviewer's membership in a batch (batch_reviewers) and their
    assignments on the batch's apps.

    Multi-batch aware: keeps the reviewer on an app that another of the app's
    batches still supplies, and never removes a reviewer who already submitted a
    review. Returns the number of assignments removed + submitted-skips.
    """
    sb = get_admin_client()
    existing_batch = sb.table("batches").select("id").eq("id", batch_id).limit(1).execute().data
    if not existing_batch:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail={"code": "batch_not_found"},
        )

    from app.services import batch_membership

    result = batch_membership.remove_reviewer_from_batch(
        sb, batch_id, reviewer_user_id, actor=user["user_id"]
    )

    write_audit(
        actor_user_id=user["user_id"],
        actor_role=actor_role_of(user),
        action_type="batch_reviewers_unassigned",
        target_table="batches",
        target_id=batch_id,
        after={
            "reviewer_user_id": reviewer_user_id,
            "removed": result["removed"],
            "skipped_submitted": result["skipped_submitted"],
        },
    )
    return {"removed": result["removed"], "skipped_submitted": result["skipped_submitted"]}


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
    weight: float | None = Field(default=None, ge=0, le=10)
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


@router.get(
    "/reviewers/{user_id}/applications",
    dependencies=[Depends(require_capability("manage_reviewers_roster"))],
)
async def list_reviewer_applications(user_id: str) -> dict[str, Any]:
    """Applications actively assigned to one reviewer (Manage Applications drawer)."""
    return admin_query.fetch_reviewer_applications(user_id)


class _ReviewerAppItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    application_id: str
    track: Literal["tir", "sip"]


class ReviewerAppsBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[_ReviewerAppItem] = Field(..., min_length=1, max_length=500)


@router.post(
    "/reviewers/{user_id}/applications",
    dependencies=[Depends(require_capability("manage_reviewers_roster"))],
)
async def bulk_assign_reviewer_applications(
    user_id: str,
    body: ReviewerAppsBody,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Bulk-assign applications to one reviewer (Manage Applications drawer)."""
    res = admin_query.bulk_assign_reviewer_apps(
        user_id, [i.model_dump() for i in body.items], assigned_by=user["user_id"],
    )
    notify_reviewers_assigned(get_admin_client(), [
        {"reviewer_user_id": user_id, "application_id": r["application_id"], "application_track": r["track"]}
        for r in res.get("results", []) if r.get("status") == "created"
    ])
    write_audit(
        actor_user_id=user["user_id"],
        actor_role=actor_role_of(user),
        action_type="reviewer.bulk_assigned",
        target_table="reviewer_assignments",
        target_id=user_id,
        after={"count": len(body.items)},
    )
    return res


@router.post(
    "/reviewers/{user_id}/applications/remove",
    dependencies=[Depends(require_capability("manage_reviewers_roster"))],
)
async def bulk_remove_reviewer_applications(
    user_id: str,
    body: ReviewerAppsBody,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Bulk-unassign applications from one reviewer (skips submitted reviews)."""
    res = admin_query.bulk_remove_reviewer_apps(
        user_id, [i.model_dump() for i in body.items],
    )
    write_audit(
        actor_user_id=user["user_id"],
        actor_role=actor_role_of(user),
        action_type="reviewer.bulk_removed",
        target_table="reviewer_assignments",
        target_id=user_id,
        before={"count": len(body.items)},
    )
    return res


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
    notify_reviewers_assigned(sb, rows)
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


# ─── Jury roster v2 (metrics + per-juror apps + profile patch) ─────────────
#
# Mirrors the reviewer roster endpoints under the `manage_jury_roster` cap.
# Jury v2 is pick-based (no scoring), so the profile PATCH carries only
# weight + expertise_domains — jury_profiles has no batch_id column (mig 033).


class JurorProfileBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    weight: float | None = Field(default=None, ge=0, le=10)
    expertise_domains: list[str] | None = None


@router.get(
    "/jurors",
    dependencies=[Depends(require_capability("manage_jury_roster"))],
)
async def list_jurors() -> dict[str, Any]:
    """Jury roster (pick-based workload) plus outstanding invites."""
    return admin_query.fetch_jury_roster()


@router.get(
    "/jurors/{user_id}/applications",
    dependencies=[Depends(require_capability("manage_jury_roster"))],
)
async def list_juror_applications(user_id: str) -> dict[str, Any]:
    """Applications assigned to one juror (Manage Applications drawer)."""
    return admin_query.fetch_juror_applications(user_id)


@router.patch(
    "/jurors/{user_id}",
    dependencies=[Depends(require_capability("manage_jury_roster"))],
)
async def update_juror_profile(
    user_id: str,
    body: JurorProfileBody,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Edit a juror's roster details (weight, expertise_domains).

    Upserts jury_profiles keyed by juror_user_id — the juror already has a
    profiles row from accept time, so identity fields are not touched here.
    """
    fields: dict[str, Any] = {}
    if body.weight is not None:
        fields["weight"] = body.weight
    if body.expertise_domains is not None:
        fields["expertise_domains"] = body.expertise_domains

    if not fields:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "no_fields", "message": "Provide at least one field."},
        )

    sb = get_admin_client()
    sb.table("jury_profiles").upsert(
        {
            "juror_user_id": user_id,
            "updated_at": datetime.now(UTC).isoformat(),
            **fields,
        },
        on_conflict="juror_user_id",
    ).execute()

    write_audit(
        actor_user_id=user["user_id"],
        actor_role=actor_role_of(user),
        action_type="juror_profile_update",
        target_table="jury_profiles",
        target_id=user_id,
        after=fields,
    )
    return {"juror_user_id": user_id, **fields}


# ─── Jury: expertise enrichment + recommendation matching (Task 5) ─────────
#
# Both endpoints only enqueue SQS jobs (`jury_enrich` / `jury_match`) that the
# worker Lambda picks up asynchronously — enrichment does a web-grounded LLM
# call and matching does one LLM pass per juror, both too slow for a
# request/response cycle. 202 signals "accepted, not yet done".


@router.post(
    "/jurors/{user_id}/enrich",
    status_code=202,
    dependencies=[Depends(require_capability("manage_jury_roster"))],
)
async def enrich_juror(user_id: str, user: dict = Depends(get_current_user)) -> dict:
    from ..services.sqs_publisher import publish_jury_job

    queued = publish_jury_job("jury_enrich", user_id)
    get_admin_client().table("jury_profiles").update({"enrichment_status": "pending"}) \
        .eq("juror_user_id", user_id).execute()
    return {"queued": bool(queued), "juror_user_id": user_id}


class RecomputeBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    juror_user_id: str | None = None


@router.post(
    "/jury/recommendations/recompute",
    status_code=202,
    dependencies=[Depends(require_capability("manage_jury_roster"))],
)
async def recompute_recommendations(
    body: RecomputeBody,
    user: dict = Depends(get_current_user),
) -> dict:
    from ..services.sqs_publisher import publish_jury_job

    sb = get_admin_client()
    if body.juror_user_id:
        ids = [body.juror_user_id]
    else:
        ids = sorted({r["user_id"] for r in
                      (sb.table("user_roles").select("user_id,role").eq("role", "jury")
                       .execute().data or []) if r.get("role") == "jury"})
    queued = [jid for jid in ids if publish_jury_job("jury_match", jid)]
    return {"queued": queued}


class AutoAssignBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    juror_user_id: str | None = None


@router.post(
    "/jury/auto-assign",
    dependencies=[Depends(require_capability("manage_jury_roster"))],
)
async def auto_assign_jury(
    body: AutoAssignBody, user: dict = Depends(get_current_user),
) -> dict:
    from ..services.jury_matching.run import auto_assign_from_recommendations

    result = auto_assign_from_recommendations(
        get_admin_client(), body.juror_user_id, assigned_by=user["user_id"])
    write_audit(actor_user_id=user["user_id"], actor_role=actor_role_of(user),
                action_type="jury.auto_assigned", target_table="jury_assignments",
                target_id=body.juror_user_id or "all", after=result)
    return result
