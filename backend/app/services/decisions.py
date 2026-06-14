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

from datetime import UTC, datetime

from ..supabase_client import get_admin_client
from . import state_machine
from .audit import write_audit


def record_decision(*, track, application_id, decision, rationale, decided_by) -> dict:
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
        from fastapi import HTTPException, status
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

    # 4. Best-effort audit.
    write_audit(
        actor_user_id=decided_by, actor_role="admin",
        action_type="gate1_decision",
        target_table=table, target_id=application_id,
        after={"decision": decision, "from_status": from_status},
    )
    return {
        "application_id": application_id,
        "track": track,
        "decision": decision,
        "from_status": from_status,
    }
