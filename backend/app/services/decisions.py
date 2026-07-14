"""Gate-1 admin decision service (Task 7).

A guarded write that:
  1. pre-validates the move (404 if app missing, 422 if illegal) with ZERO
     writes,
  2. records the decision in `admin_decisions` (gate1 row),
  3. moves the application status via the state machine, and
  4. appends a best-effort audit entry.

Ordering rationale — the decision row is written BEFORE the status moves,
the reverse of the original implementation. We first read the current status
and assert the transition is legal, so an illegal/missing app never gets a
decision row and never moves. Once that gate passes, we insert the decision
row; if that insert raises, the status has NOT moved yet, so the request is
cleanly retryable (no orphaned status, no orphaned row — let it propagate).
Only then do we call the state machine to move the status (it re-validates
defensively, which is harmless). If that post-insert status write fails, we
are left with a stray decision row but an unmoved status — recoverable, and
strictly better than the original failure mode (status moved with no
decision row, where the retry 422'd on an illegal same-status transition).
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from fastapi import HTTPException, status

from ..supabase_client import get_admin_client
from . import applications_query, decision_email, state_machine
from .audit import write_audit

log = logging.getLogger(__name__)


def record_decision(*, track, application_id, decision, rationale, decided_by, decided_by_role: str | None = None) -> dict:
    """Gate-1 decision: pre-validate, write admin_decisions row, then move status.

    The decision row is written before the status moves so any failure prior
    to the status change is cleanly retryable, and an illegal/missing app
    never writes a decision row. See module docstring for the full ordering
    rationale.
    """
    sb = get_admin_client()
    table = f"{track}_applications"

    # 1. Pre-validate with zero writes: 404 if missing, 422 if illegal move.
    rows = (
        sb.table(table).select("status").eq("id", application_id).limit(1).execute().data
        or []
    )
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "application_not_found"},
        )
    from_status = rows[0].get("status")
    state_machine.assert_legal_transition(from_status, decision)

    # 2. Write the decision row. If this raises, the status has NOT moved yet,
    #    so let it propagate — the whole request is retryable.
    sb.table("admin_decisions").insert({
        "application_id": application_id,
        "application_track": track,
        "gate_stage": "gate1",
        "decision": decision,
        "rationale": rationale,
        "decided_by": decided_by,
        "decided_at": datetime.now(UTC).isoformat(),
    }).execute()

    # 3. Move the status + log (re-validates defensively — fine).
    state_machine.apply_status_change(
        application_id, track,
        to_status=decision, changed_by=decided_by,
        reason=rationale or f"gate1: {decision}",
    )

    # On rejection OR admin approval (jury_review), remove the app from the
    # batch and every reviewer so it leaves all reviewer queues. Best-effort:
    # a cleanup failure must not undo the recorded decision. Reviews are
    # preserved by the helper.
    if decision in ("rejected", "jury_review"):
        try:
            applications_query.detach_application_from_review(
                sb, application_id, track, remove_batch_link=True,
            )
        except Exception:  # noqa: BLE001
            log.warning("decision cleanup failed",
                        extra={"application_id": application_id, "track": track,
                               "decision": decision})

    # 4. Best-effort audit.
    write_audit(
        actor_user_id=decided_by, actor_role=decided_by_role or "admin",
        action_type="gate1_decision",
        target_table=table, target_id=application_id,
        after={"decision": decision, "from_status": from_status},
    )

    # 5. Best-effort applicant notification (rejected / jury_review only).
    #    Swallows its own errors; guard again so a notify bug can't break the decision.
    if decision in ("rejected", "jury_review"):
        try:
            decision_email.notify_applicant_decided(
                sb, track=track, application_id=application_id, decision=decision,
            )
        except Exception:  # noqa: BLE001
            pass

    return {
        "application_id": application_id,
        "track": track,
        "decision": decision,
        "from_status": from_status,
    }


_GATE2_VALID = frozenset({"offered", "waitlisted", "on_hold", "rejected"})


def record_gate2_decision(
    *, track, application_id, decision, rationale, decided_by, decided_by_role: str | None = None
) -> dict:
    """Gate-2 decision: offered | waitlisted | on_hold | rejected.

    Validates the decision value (422 invalid_gate2_decision if not in set).
    Rationale is required unless decision is ``offered``. Only allowed on apps
    currently in ``jury_review`` (409 not_in_jury_review otherwise). Inserts an
    admin_decisions row with gate_stage='gate2', then moves status. Unlike
    gate-1, this path sends NO applicant email.
    """
    if decision not in _GATE2_VALID:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "invalid_gate2_decision",
                    "valid": sorted(_GATE2_VALID)},
        )
    if decision != "offered" and not (rationale or "").strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "rationale_required",
                    "message": "A rationale is required for gate-2 decisions other than 'offered'."},
        )

    sb = get_admin_client()
    table = f"{track}_applications"

    # Pre-validate: 404 if missing, 422 if illegal move.
    rows = (
        sb.table(table).select("status").eq("id", application_id).limit(1).execute().data
        or []
    )
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "application_not_found"},
        )
    from_status = rows[0].get("status")

    # Gate-2 is only allowed on apps that are currently in jury_review.
    if from_status != "jury_review":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "not_in_jury_review",
                "message": "Gate-2 decisions are only allowed on applications in jury_review.",
            },
        )

    state_machine.assert_legal_transition(from_status, decision)

    # Write the gate-2 decision row.
    sb.table("admin_decisions").insert({
        "application_id": application_id,
        "application_track": track,
        "gate_stage": "gate2",
        "decision": decision,
        "rationale": rationale,
        "decided_by": decided_by,
        "decided_at": datetime.now(UTC).isoformat(),
    }).execute()

    # Move status.
    state_machine.apply_status_change(
        application_id, track,
        to_status=decision, changed_by=decided_by,
        reason=rationale or f"gate2: {decision}",
    )

    # Best-effort audit.
    write_audit(
        actor_user_id=decided_by, actor_role=decided_by_role or "admin",
        action_type="gate2_decision",
        target_table=table, target_id=application_id,
        after={"decision": decision, "from_status": from_status},
    )
    return {
        "application_id": application_id,
        "track": track,
        "decision": decision,
        "from_status": from_status,
        "gate_stage": "gate2",
    }


def record_decision_safe(*, track, application_id, decision, rationale, decided_by, decided_by_role: str | None = None) -> dict:
    """record_decision wrapped to a per-id status string instead of raising."""
    if decision in ("rejected", "waitlisted", "on_hold") and not (rationale or "").strip():
        return {"application_id": application_id, "track": track, "status": "rationale_required"}
    try:
        record_decision(
            track=track, application_id=application_id, decision=decision,
            rationale=rationale, decided_by=decided_by,
            decided_by_role=decided_by_role,
        )
        return {"application_id": application_id, "track": track, "status": "decided"}
    except HTTPException as exc:
        code = (exc.detail or {}).get("code") if isinstance(exc.detail, dict) else None
        status_map = {
            "illegal_transition": "illegal_transition",
            "application_not_found": "not_found",
        }
        return {"application_id": application_id, "track": track,
                "status": status_map.get(code, "error")}
