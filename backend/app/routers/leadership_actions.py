"""Leadership dashboard — write endpoints (Session 6, Tasks 20-22).

Mounted under `/leadership/applications/{application_id}/...`:

    PATCH  /status                              status state machine (spec §4.8)
    POST   /reviewers                           assign 1-3 reviewers (idempotent)
    DELETE /reviewers/{reviewer_user_id}        unassign a reviewer
    GET    /legal-next-statuses                 client convenience (mirror of map)

Kept in a separate file from `leadership.py` (the reads router) so Session 4's
read surface and Session 6's writes can evolve independently — see
docs/superpowers/plans/2026-05-13-session-division.md.

Track is server-inferred via `applications_query.find_application_with_track`
to match the read side; the frontend never needs to pass it. The
`leadershipApi.*` helpers still accept a `track` arg for symmetry with the
list rows but ignore it on the wire.

Every write best-effort calls `write_audit(...)` so failures here can't roll
back the primary mutation. Status changes also append to
`application_status_log` (best-effort, logged).
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..deps import get_current_user
from ..rbac import require_capability
from ..services import applications_query
from ..services.audit import write_audit
from ..services.state_machine import (
    LEGAL_TRANSITIONS,
    assert_legal_transition,
    legal_next_states,
)
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


def _append_status_log(
    *,
    application_id: str,
    track: str,
    from_status: str | None,
    to_status: str,
    changed_by: str | None,
    reason: str | None,
) -> None:
    """Append-only insert into application_status_log. Never raises.

    The dashboard's timeline reads this table directly via the reads
    endpoint, so the row is the user-visible audit-of-status record.
    Failure here would lose the timeline entry — log loud and continue;
    the audit_log_v2 write below still captures the event for forensics.
    """
    try:
        get_admin_client().table("application_status_log").insert({
            "application_id":    application_id,
            "application_track": track,
            "from_status":       from_status,
            "to_status":         to_status,
            "changed_by":        changed_by,
            "reason":            reason,
        }).execute()
    except Exception:
        log.warning(
            "append_status_log failed (swallowed)",
            extra={
                "application_id": application_id,
                "track": track,
                "to_status": to_status,
            },
            exc_info=True,
        )


# ─── Status transition (Task 20) ───────────────────────────────────────


class ChangeStatusRequest(BaseModel):
    to_status: str = Field(..., min_length=1, max_length=40)
    reason: str | None = Field(default=None, max_length=2000)
    # Advisory only — server resolves the canonical track from the DB. If the
    # client passes one that disagrees, we 422 so we never silently write to
    # the wrong row. Optional so the frontend can omit it and let server resolve.
    track: str | None = Field(default=None, pattern="^(tir|sip)$")


@router.patch(
    "/{application_id}/status",
    dependencies=[Depends(require_capability("change_app_status"))],
)
async def change_status(
    application_id: str,
    body: ChangeStatusRequest,
    current_user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Transition an application's status (leadership-initiated).

    Enforces spec §4.8: legal moves only. Illegal → 422 ``illegal_transition``
    with the allowed list and (for rewind attempts) a Phase-1.5 hint.

    Side effects on success:
      1. update {track}_applications.status
      2. append application_status_log row
      3. write audit_log_v2 row
    """
    track, row = _resolve_app(application_id)
    if body.track and body.track != track:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "track_mismatch",
                "expected": track,
                "got": body.track,
            },
        )

    from_status = row.get("status")
    # No-op short-circuit BEFORE the legality check — staying put is always
    # safe even if `assert_legal_transition` would otherwise refuse the
    # nominal X → X move (X is rarely in its own allowed set).
    if from_status == body.to_status:
        return {
            "ok": True,
            "application_id": application_id,
            "track": track,
            "from_status": from_status,
            "to_status": body.to_status,
            "reason": body.reason,
            "noop": True,
        }

    assert_legal_transition(from_status, body.to_status)

    table_name = applications_query.track_table(track)
    try:
        get_admin_client().table(table_name).update({
            "status": body.to_status,
        }).eq("id", application_id).execute()
    except Exception as exc:
        log.exception(
            "change_status update failed",
            extra={"application_id": application_id, "track": track},
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": "update_failed", "message": str(exc)[:200]},
        ) from exc

    _append_status_log(
        application_id=application_id,
        track=track,
        from_status=from_status,
        to_status=body.to_status,
        changed_by=current_user["user_id"],
        reason=body.reason,
    )

    write_audit(
        actor_user_id=current_user["user_id"],
        actor_role="leadership",
        action_type="application.status_changed",
        target_table=table_name,
        target_id=application_id,
        before={"status": from_status},
        after={"status": body.to_status},
        reason=body.reason,
    )

    return {
        "ok": True,
        "application_id": application_id,
        "track": track,
        "from_status": from_status,
        "to_status": body.to_status,
        "reason": body.reason,
    }


@router.get(
    "/{application_id}/legal-next-statuses",
    dependencies=[Depends(require_capability("change_app_status"))],
)
async def get_legal_next_statuses(application_id: str) -> dict[str, Any]:
    """Convenience read for clients that prefer the server's view of the map.

    The modal currently mirrors `LEGAL_TRANSITIONS` client-side via
    `lib/statusMachine.js`, but exposing this lets future tools (CLI,
    automated routines, mobile) avoid duplicating the map.
    """
    track, row = _resolve_app(application_id)
    from_status = row.get("status")
    return {
        "application_id": application_id,
        "track": track,
        "current_status": from_status,
        "allowed": legal_next_states(from_status),
    }


# ─── Reviewer assignment (Task 21) ─────────────────────────────────────


MAX_REVIEWERS_PER_APP = 3
ACTIVE_ASSIGNMENT_STATES = ("pending", "accepted")


class AssignReviewersRequest(BaseModel):
    # min/max here is "how many user_ids in this request body", not the
    # cap of total active assignments. A single request that pushes the
    # total over 3 is rejected by the cap check below.
    reviewer_user_ids: list[str] = Field(..., min_length=1, max_length=MAX_REVIEWERS_PER_APP)
    track: str | None = Field(default=None, pattern="^(tir|sip)$")


def _fetch_active_assignments(application_id: str, track: str) -> list[dict[str, Any]]:
    try:
        res = (
            get_admin_client()
            .table("reviewer_assignments")
            .select("*")
            .eq("application_id", application_id)
            .eq("application_track", track)
            .in_("state", list(ACTIVE_ASSIGNMENT_STATES))
            .execute()
        )
        return res.data or []
    except Exception:
        log.exception(
            "fetch_active_assignments failed",
            extra={"application_id": application_id, "track": track},
        )
        return []


@router.post(
    "/{application_id}/reviewers",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_capability("assign_reviewers"))],
)
async def assign_reviewers(
    application_id: str,
    body: AssignReviewersRequest,
    current_user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Assign 1-3 reviewers to an application.

    Idempotent: requesting a user that is already an active assignee is a
    no-op (no insert, no error). The cap (max 3 active) is counted *after*
    deduping against current assignees.

    Spec §9 guards enforced here:
      - 3-active-reviewer cap → 409 ``reviewer_limit_reached``
      - self-assignment block → 409 ``self_assignment_blocked``
    """
    track, app_row = _resolve_app(application_id)
    if body.track and body.track != track:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "track_mismatch", "expected": track, "got": body.track},
        )

    applicant_user_id = app_row.get("user_id")
    # Self-assignment block — the applicant can never be one of their own
    # reviewers. Spec §9.
    if applicant_user_id and applicant_user_id in body.reviewer_user_ids:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "self_assignment_blocked",
                "applicant_user_id": applicant_user_id,
            },
        )

    # Dedup + preserve order so the response's "added" list matches request.
    requested = []
    seen: set[str] = set()
    for uid in body.reviewer_user_ids:
        if uid not in seen:
            seen.add(uid)
            requested.append(uid)

    active = _fetch_active_assignments(application_id, track)
    active_ids = {a["reviewer_user_id"] for a in active}

    to_add = [uid for uid in requested if uid not in active_ids]
    already_assigned = [uid for uid in requested if uid in active_ids]

    if len(active_ids) + len(to_add) > MAX_REVIEWERS_PER_APP:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "reviewer_limit_reached",
                "max": MAX_REVIEWERS_PER_APP,
                "current_active": len(active_ids),
                "would_add": len(to_add),
            },
        )

    inserted: list[dict[str, Any]] = []
    if to_add:
        rows = [
            {
                "application_id":    application_id,
                "application_track": track,
                "reviewer_user_id":  uid,
                "assigned_by":       current_user["user_id"],
                "state":             "pending",
            }
            for uid in to_add
        ]
        try:
            res = (
                get_admin_client()
                .table("reviewer_assignments")
                .insert(rows)
                .execute()
            )
            inserted = res.data or []
        except Exception as exc:
            # UNIQUE(application_id, application_track, reviewer_user_id) means a
            # historically-declined or -completed row already exists for this
            # triple. We don't currently support re-activation in a single hop;
            # surface as 409 so the modal can ask the user to clean up first.
            msg = str(exc).lower()
            if "duplicate" in msg or "23505" in msg:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "code": "assignment_history_conflict",
                        "message": "One or more of these reviewers has a prior assignment row for this application. Remove it first.",
                    },
                ) from exc
            log.exception(
                "assign_reviewers insert failed",
                extra={"application_id": application_id, "track": track},
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={"code": "assign_failed", "message": str(exc)[:200]},
            ) from exc

    if to_add:
        write_audit(
            actor_user_id=current_user["user_id"],
            actor_role="leadership",
            action_type="reviewer.assigned",
            target_table="reviewer_assignments",
            target_id=application_id,
            after={"track": track, "reviewer_user_ids": to_add},
        )

    # Return the post-state for an easy frontend refresh path.
    assignments = applications_query.fetch_reviewer_assignments_for(application_id, track)
    return {
        "ok": True,
        "application_id": application_id,
        "track": track,
        "added": to_add,
        "already_assigned": already_assigned,
        "assignments": assignments,
    }


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
            .select("id,status")
            .eq("application_id", application_id)
            .eq("application_track", track)
            .eq("reviewer_user_id", reviewer_user_id)
            .eq("status", "submitted")
            .limit(1)
            .execute()
        )
        if rev.data:
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


# Module-level export for the rare caller that wants the canonical map
# (tests, smoke scripts). The frontend mirror lives in
# `frontend/src/lib/statusMachine.js`; keep them in sync.
__all__ = [
    "router",
    "LEGAL_TRANSITIONS",
    "MAX_REVIEWERS_PER_APP",
    "ACTIVE_ASSIGNMENT_STATES",
]
