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
from ..services import applications_query, decisions, jury_query
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
    decision: Literal["rejected", "shortlisted", "on_hold", "waitlisted",
                       "offered"] = "rejected"
    rationale: str | None = None
    gate_stage: Literal["gate1", "gate2"] = "gate1"


@router.post(
    "/{application_id}/decision",
    dependencies=[Depends(require_capability("decide_application"))],
)
async def decide_application(
    application_id: str,
    body: LeadershipDecisionBody,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Record a leadership gate-1 or gate-2 decision and move status.

    Track is server-inferred. The gate_stage field selects which path:
    gate1 (default) — original gate-1 path (shortlisted/on_hold/rejected/waitlisted);
    reject is legal from any active status (see state_machine.LEGAL_TRANSITIONS),
    so leadership can reject directly from the dashboard, and a rationale default
    is recorded so the audit trail and admin_decisions row are never blank.
    gate2 — offered/waitlisted/on_hold/rejected routed via
    decisions.record_gate2_decision (its own rationale rule; no applicant email).
    """
    track, _row = _resolve_app(application_id)
    # Route to gate-2 when gate_stage is explicitly "gate2" OR when the
    # decision is "offered" (offered is a gate-2-only outcome; accepting it on
    # the gate-1 path would record the wrong gate_stage in admin_decisions).
    is_gate2 = (body.gate_stage == "gate2") or (body.decision == "offered")
    if is_gate2:
        return decisions.record_gate2_decision(
            track=track,
            application_id=application_id,
            decision=body.decision,
            rationale=body.rationale,
            decided_by=user["user_id"],
            decided_by_role="leadership",
        )
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


# ─── Per-app juror assign / unassign (v2) ────────────────────────────────


class AssignJurorsBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    juror_user_ids: list[str] = Field(..., min_length=1, max_length=10)
    track: Literal["tir", "sip"] | None = None  # optional hint; server-inferred is authoritative

    @field_validator("juror_user_ids")
    @classmethod
    def _ids_nonempty(cls, v):
        if any(not str(s).strip() for s in v):
            raise ValueError("juror_user_ids items must be non-empty strings")
        return v


@router.post(
    "/{application_id}/jurors",
    dependencies=[Depends(require_capability("assign_jurors"))],
)
async def assign_jurors(
    application_id: str,
    body: AssignJurorsBody,
    current_user: dict = Depends(get_current_user),
) -> dict:
    """Bulk-create per-app jury assignments. Per-id result statuses:
    created | already_assigned | not_a_juror. 404 if the app doesn't exist.

    v2 eligibility: the app MUST already be in ``jury_review`` (Gate-1 approve
    puts it there) — otherwise 409 not_eligible_for_jury. There is no
    shortlisted→jury_review auto-flip.
    """
    track, _row = _resolve_app(application_id)
    sb = get_admin_client()

    # Eligibility guard: app must already be in jury_review (v2 — no auto-flip).
    table = "tir_applications" if track == "tir" else "sip_applications"
    app_rows = (
        sb.table(table).select("status").eq("id", application_id).limit(1).execute().data
        or []
    )
    current_status = (app_rows[0].get("status") if app_rows else None)
    if current_status != "jury_review":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "not_eligible_for_jury", "status": current_status},
        )

    # Fetch juror role membership.
    role_rows = (
        sb.table("user_roles")
        .select("user_id")
        .eq("role", "jury")
        .execute()
        .data
    ) or []
    juror_ids = {r["user_id"] for r in role_rows}

    # Existing assignments for this app.
    existing_rows = (
        sb.table("jury_assignments")
        .select("juror_user_id")
        .eq("application_id", application_id)
        .eq("application_track", track)
        .execute()
        .data
    ) or []
    already = {r["juror_user_id"] for r in existing_rows}

    now = datetime.now(UTC).isoformat()
    results: list[dict] = []

    for jid in body.juror_user_ids:
        if jid not in juror_ids:
            results.append({"juror_user_id": jid, "status": "not_a_juror"})
            continue
        if jid in already:
            results.append({"juror_user_id": jid, "status": "already_assigned"})
            continue
        row = {
            "application_id": application_id,
            "application_track": track,
            "juror_user_id": jid,
            "assigned_by": current_user["user_id"],
            "assigned_at": now,
        }
        sb.table("jury_assignments").insert(row).execute()
        try:
            write_audit(
                actor_user_id=current_user["user_id"],
                actor_role="leadership",
                action_type="juror.assigned",
                target_table="jury_assignments",
                target_id=f"{application_id}:{jid}",
                after={"application_track": track},
            )
        except Exception:  # noqa: BLE001
            pass
        already.add(jid)
        results.append({"juror_user_id": jid, "status": "created"})

    return {"application_id": application_id, "track": track, "results": results}


@router.delete(
    "/{application_id}/jurors/{juror_user_id}",
    dependencies=[Depends(require_capability("assign_jurors"))],
)
async def unassign_juror(
    application_id: str,
    juror_user_id: str,
    current_user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Hard-delete a juror's per-app assignment and cascade their pick.

    v2 guard: if the app already has a Gate-2 (Final Gate) admin decision, the
    assignment is frozen (409 app_already_decided). Otherwise the
    jury_assignments row is deleted AND the juror's jury_selections pick for
    the same (app, track) is cascaded away so a removed juror leaves no
    dangling pick.
    """
    track, _row = _resolve_app(application_id)
    sb = get_admin_client()

    # Freeze once a Final Gate decision exists for this app.
    decided = jury_query.gate2_decided_keys(sb, [(application_id, track)])
    if decided:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "app_already_decided",
                "message": "This application already has a Final Gate decision; assignments are frozen.",
            },
        )

    try:
        res = (
            sb.table("jury_assignments")
            .delete()
            .eq("application_id", application_id)
            .eq("application_track", track)
            .eq("juror_user_id", juror_user_id)
            .execute()
        )
        deleted_rows = res.data or []
    except Exception as exc:
        log.exception(
            "unassign_juror delete failed",
            extra={
                "application_id": application_id,
                "track": track,
                "juror_user_id": juror_user_id,
            },
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": "unassign_failed", "message": str(exc)[:200]},
        ) from exc

    # Cascade: drop this juror's pick for the same (app, track) so removing a
    # juror doesn't leave a dangling selection in the pick matrix.
    try:
        sb.table("jury_selections").delete() \
            .eq("application_id", application_id) \
            .eq("application_track", track) \
            .eq("juror_user_id", juror_user_id).execute()
    except Exception:  # noqa: BLE001
        log.warning(
            "unassign_juror: jury_selections cascade failed (swallowed)",
            extra={
                "application_id": application_id,
                "track": track,
                "juror_user_id": juror_user_id,
            },
        )

    write_audit(
        actor_user_id=current_user["user_id"],
        actor_role="leadership",
        action_type="juror.unassigned",
        target_table="jury_assignments",
        target_id=application_id,
        before={"track": track, "juror_user_id": juror_user_id},
    )

    return {
        "ok": True,
        "application_id": application_id,
        "track": track,
        "juror_user_id": juror_user_id,
        "deleted": bool(deleted_rows),
    }


__all__ = ["router"]
