"""Leadership dashboard — write endpoints.

Mounted under `/leadership/applications/{application_id}/...`:

    POST   /reviewers                           bulk-assign reviewers
    DELETE /reviewers/{reviewer_user_id}        unassign a reviewer

The status-change (`PATCH /status`, `GET /legal-next-statuses`) endpoints were
removed from the leadership surface. The canonical status state machine lives in
`services/state_machine.py` and is still used by the reviewer flow.

Track is server-inferred via `applications_query.find_application_with_track`
to match the read side; the frontend never needs to pass it.

The write best-effort calls `write_audit(...)` so audit failures can't roll
back the primary mutation.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..deps import get_current_user
from ..rbac import require_capability
from ..services import applications_query, decisions
from ..services.assignment_email import notify_reviewers_assigned
from ..services.audit import write_audit
from ..supabase_client import get_admin_client

log = logging.getLogger(__name__)

router = APIRouter(prefix="/leadership/applications", tags=["leadership-actions"])


# ─── Helpers ────────────────────────────────────────────────────────────


def _resolve_app(application_id: str) -> tuple[str, dict[str, Any]]:
    """Resolve `(track, row)` for ``application_id`` or raise 404.

    Re-uses the read-side helper so both sides see the same "track" answer
    for any given id. The probe is cheap (PK lookup on each track table).
    """
    found = applications_query.find_application_with_track(application_id)
    if found is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "application_not_found", "application_id": application_id},
        )
    return found


# ─── Reviewer bulk-assignment ─────────────────────────────────────────


class AssignReviewersBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reviewer_user_ids: list[str] = Field(..., min_length=1, max_length=10)
    due_at: str | None = None

    @field_validator("reviewer_user_ids")
    @classmethod
    def _ids_nonempty(cls, v):
        if any(not str(s).strip() for s in v):
            raise ValueError("reviewer_user_ids items must be non-empty strings")
        return v


@router.post(
    "/{application_id}/reviewers",
    dependencies=[Depends(require_capability("assign_reviewers"))],
)
async def assign_reviewers(
    application_id: str,
    body: AssignReviewersBody,
    user: dict = Depends(get_current_user),
) -> dict:
    """Bulk-create reviewer assignments. Per-id result statuses:
    created | already_assigned | not_a_reviewer. 404 if the app doesn't exist.
    Track is server-inferred (matches the DELETE-unassign convention).

    v1 treats ANY existing row for a (application_id, application_track,
    reviewer_user_id) triple as already_assigned — including declined rows.
    This keeps the logic simple; a future iteration can filter out declined
    rows to allow re-assignment after a decline.
    """
    track, _row = _resolve_app(application_id)
    sb = get_admin_client()

    role_rows = (
        sb.table("user_roles")
        .select("user_id")
        .eq("role", "reviewer")
        .execute()
        .data
    ) or []
    reviewer_ids = {r["user_id"] for r in role_rows}

    existing_rows = (
        sb.table("reviewer_assignments")
        .select("reviewer_user_id")
        .eq("application_id", application_id)
        .eq("application_track", track)
        .execute()
        .data
    ) or []
    already = {r["reviewer_user_id"] for r in existing_rows}

    now = datetime.now(UTC).isoformat()
    results: list[dict] = []
    for rid in body.reviewer_user_ids:
        if rid not in reviewer_ids:
            results.append({"reviewer_user_id": rid, "status": "not_a_reviewer"})
            continue
        if rid in already:
            results.append({"reviewer_user_id": rid, "status": "already_assigned"})
            continue
        row = {
            "application_id": application_id,
            "application_track": track,
            "reviewer_user_id": rid,
            "assigned_by": user["user_id"],
            "assigned_at": now,
            "state": "pending",
            "due_at": body.due_at,
        }
        sb.table("reviewer_assignments").insert(row).execute()
        write_audit(
            actor_user_id=user["user_id"],
            actor_role="leadership",
            action_type="reviewer.assigned",
            target_table="reviewer_assignments",
            target_id=f"{application_id}:{rid}",
            after={"application_track": track, "due_at": body.due_at},
        )
        already.add(rid)
        results.append({"reviewer_user_id": rid, "status": "created"})

    notify_reviewers_assigned(sb, [
        {"reviewer_user_id": r["reviewer_user_id"], "application_id": application_id, "application_track": track}
        for r in results if r.get("status") == "created"
    ])

    from app.services import state_machine
    if any(r.get("status") == "created" for r in results):
        state_machine.advance_to_under_review_on_assignment(application_id, track)

    return {"application_id": application_id, "track": track, "results": results}


# ─── Gate-1 decision (reject / shortlist / hold / waitlist) ────────────


class LeadershipDecisionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: Literal["rejected", "shortlisted", "on_hold", "waitlisted"] = "rejected"
    rationale: str | None = None


@router.post(
    "/{application_id}/decision",
    dependencies=[Depends(require_capability("decide_application"))],
)
async def decide_application(
    application_id: str,
    body: LeadershipDecisionBody,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Record a leadership gate-1 decision (default: reject) and move status.

    Track is server-inferred. Reject is legal from any active status (see
    state_machine.LEGAL_TRANSITIONS), so leadership can reject an application
    directly from the dashboard without first walking it to `evaluated`. A
    rationale is optional from this surface; a default is recorded so the
    audit trail and admin_decisions row are never blank.
    """
    track, _row = _resolve_app(application_id)
    rationale = (body.rationale or "").strip() or f"{body.decision} by leadership"
    return decisions.record_decision(
        track=track,
        application_id=application_id,
        decision=body.decision,
        rationale=rationale,
        decided_by=user["user_id"],
        decided_by_role="leadership",
    )


# ─── Reviewer un-assignment ────────────────────────────────────────────


@router.delete(
    "/{application_id}/reviewers/{reviewer_user_id}",
    dependencies=[Depends(require_capability("assign_reviewers"))],
)
async def unassign_reviewer(
    application_id: str,
    reviewer_user_id: str,
    current_user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Hard-delete a reviewer's assignment row.

    Hard-delete (not soft) so the UNIQUE(application_id, application_track,
    reviewer_user_id) constraint lets the same reviewer be re-assigned
    later without history surgery.

    Phase 1 guard: if a corresponding row in `reviews` is already submitted,
    refuse (409 ``review_already_submitted``). The reviewer's scored work
    stays intact; surfacing this lets the leader course-correct gracefully.
    """
    track, _row = _resolve_app(application_id)

    # Block if the reviewer has already submitted a review for this app —
    # we don't want to orphan a submitted score by deleting the assignment.
    try:
        rev = (
            get_admin_client()
            .table("reviews")
            .select("id,submitted_at,application_id,application_track,reviewer_user_id")
            .eq("application_id", application_id)
            .eq("application_track", track)
            .eq("reviewer_user_id", reviewer_user_id)
            .execute()
        )
        already_submitted = any(
            row.get("submitted_at")
            for row in (rev.data or [])
            if row.get("application_id") == application_id
            and row.get("application_track") == track
            and row.get("reviewer_user_id") == reviewer_user_id
        )
        if already_submitted:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "review_already_submitted",
                    "message": "This reviewer has already submitted a review; their assignment can't be revoked.",
                },
            )
    except HTTPException:
        raise
    except Exception:
        # Reads on `reviews` failing here is non-fatal — log and let the
        # delete proceed. (We've made our best effort to guard.)
        log.warning(
            "unassign_reviewer: pre-check on reviews failed; continuing",
            extra={
                "application_id": application_id,
                "track": track,
                "reviewer_user_id": reviewer_user_id,
            },
            exc_info=True,
        )

    try:
        res = (
            get_admin_client()
            .table("reviewer_assignments")
            .delete()
            .eq("application_id", application_id)
            .eq("application_track", track)
            .eq("reviewer_user_id", reviewer_user_id)
            .execute()
        )
        deleted_rows = res.data or []
    except Exception as exc:
        log.exception(
            "unassign_reviewer delete failed",
            extra={
                "application_id": application_id,
                "track": track,
                "reviewer_user_id": reviewer_user_id,
            },
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": "unassign_failed", "message": str(exc)[:200]},
        ) from exc

    write_audit(
        actor_user_id=current_user["user_id"],
        actor_role="leadership",
        action_type="reviewer.unassigned",
        target_table="reviewer_assignments",
        target_id=application_id,
        before={"track": track, "reviewer_user_id": reviewer_user_id},
    )

    return {
        "ok": True,
        "application_id": application_id,
        "track": track,
        "reviewer_user_id": reviewer_user_id,
        "deleted": bool(deleted_rows),
    }


__all__ = ["router"]
