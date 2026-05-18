"""Application status state machine (spec §4.8).

Defines the set of *leadership-initiated* transitions that the writes
router (`leadership_actions.py`) is allowed to perform. Auto-transitions
that fire from the AI worker (submitted → ai_screening → under_review /
screening_failed) are NOT exposed here; the worker writes status directly.
Applicant-initiated transitions (draft → submitted) live in the wizard's
submit endpoint and are also not in this map.

Phase 1 deliberately excludes rewinds (e.g. evaluated → under_review).
Surfacing those is a Phase 1.5 escalation — the error message in
`assert_legal_transition` hints at this so future-me has a paper trail.

Leadership force-withdraw at any time is the one universal escape hatch:
every non-terminal post-submit status maps to `withdrawn`.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from fastapi import HTTPException, status

from ..supabase_client import get_admin_client

log = logging.getLogger(__name__)

# Per spec §4.8 — keys are *current* statuses; values are the set of
# statuses leadership is permitted to set via the writes router.
LEGAL_TRANSITIONS: dict[str, frozenset[str]] = {
    "submitted":        frozenset({"withdrawn"}),
    "ai_screening":     frozenset({"withdrawn"}),
    "screening_failed": frozenset({"withdrawn"}),
    "under_review":     frozenset({"evaluated", "withdrawn"}),
    "evaluated":        frozenset({"shortlisted", "rejected", "waitlisted", "withdrawn"}),
    "shortlisted":      frozenset({"withdrawn"}),
    "interview":        frozenset({"withdrawn"}),
    "offered":          frozenset({"withdrawn"}),
    "onboarded":        frozenset({"withdrawn"}),
    "rejected":         frozenset({"withdrawn"}),
    "waitlisted":       frozenset({"withdrawn"}),
    "withdrawn":        frozenset(),
}


def legal_next_states(from_status: str | None) -> list[str]:
    """Return the sorted list of statuses reachable from ``from_status`` via
    a leadership-initiated transition. Returns ``[]`` for unknown sources
    so callers can render "no legal action" instead of throwing."""
    if not from_status:
        return []
    return sorted(LEGAL_TRANSITIONS.get(from_status, frozenset()))


def assert_legal_transition(from_status: str | None, to_status: str) -> None:
    """Raise 422 ``illegal_transition`` if leadership can't perform this move.

    The error body carries the allowed list so the frontend can surface a
    helpful "you can do X or Y instead" message without needing to mirror
    the full map. (The modal still mirrors `LEGAL_TRANSITIONS` to populate
    its select options client-side — see `frontend/src/lib/statusMachine.js`.)
    """
    allowed = LEGAL_TRANSITIONS.get(from_status or "", frozenset())
    if to_status in allowed:
        return

    hint: str | None = None
    # Rewinds are the most likely thing a user attempts and gets surprised by;
    # name-check the source/target shape and surface the Phase 1.5 message.
    if from_status in {"evaluated", "shortlisted", "rejected", "waitlisted"} \
            and to_status in {"under_review", "submitted", "ai_screening"}:
        hint = "Rewinding a decision requires a Phase 1.5 escalation."

    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={
            "code": "illegal_transition",
            "from": from_status,
            "to": to_status,
            "allowed": sorted(allowed),
            **({"hint": hint} if hint else {}),
        },
    )


def auto_transition_to_evaluated_if_complete(
    application_id: str,
    track: str,
    just_completed_assignment_id: str | None = None,
) -> bool:
    """If every active assignment for this app is complete, move the app
    from ``under_review`` → ``evaluated``. Returns True iff the transition
    fired. Closes spec §14.4.

    ``just_completed_assignment_id`` is the assignment the caller just
    marked complete in the same request. We treat it as complete even if
    a fresh DB read still shows ``completed_at IS NULL`` — this avoids a
    read-your-writes race when Supabase replication lags, and (incidentally)
    makes the helper deterministic under the test fake which doesn't mutate
    its in-memory table on UPDATE.

    Idempotent. Best-effort: any DB failure is swallowed (logged) and the
    caller's primary write is preserved.
    """
    sb = get_admin_client()

    # Active assignments for this app
    try:
        rows = (
            sb.table("reviewer_assignments")
            .select("*")
            .eq("application_id", application_id)
            .eq("application_track", track)
            .execute()
            .data
        ) or []
    except Exception as exc:
        log.warning(
            "auto_transition: assignments fetch failed",
            extra={"application_id": application_id, "track": track,
                   "err": str(exc)},
        )
        return False

    active = [
        r for r in rows
        if r.get("declined_at") is None and r.get("reassigned_to") is None
    ]
    if not active:
        return False  # Leadership hasn't assigned anyone yet

    def _is_complete(r: dict) -> bool:
        if r.get("completed_at") is not None:
            return True
        return (
            just_completed_assignment_id is not None
            and r.get("id") == just_completed_assignment_id
        )

    if not all(_is_complete(r) for r in active):
        return False

    # All complete — transition iff current status is under_review.
    table = "tir_applications" if track == "tir" else "sip_applications"
    try:
        app_rows = (
            sb.table(table).select("*").eq("id", application_id).execute().data
        ) or []
    except Exception as exc:
        log.warning(
            "auto_transition: app row fetch failed",
            extra={"application_id": application_id, "track": track,
                   "err": str(exc)},
        )
        return False
    if not app_rows:
        return False
    current = app_rows[0].get("status")
    if current != "under_review":
        return False  # Already moved past or rewound; respect existing state.

    now_iso = datetime.now(UTC).isoformat()
    try:
        sb.table(table).update({"status": "evaluated"}).eq(
            "id", application_id,
        ).execute()
    except Exception as exc:
        log.warning(
            "auto_transition: status update failed",
            extra={"application_id": application_id, "track": track,
                   "err": str(exc)},
        )
        return False

    try:
        sb.table("application_status_log").insert({
            "application_id":    application_id,
            "application_track": track,
            "from_status":       "under_review",
            "to_status":         "evaluated",
            "changed_by":        None,  # system-driven
            "reason":            "all reviewers submitted",
            "changed_at":        now_iso,
        }).execute()
    except Exception as exc:
        log.warning(
            "auto_transition: status_log insert failed (swallowed)",
            extra={"application_id": application_id, "track": track,
                   "err": str(exc)},
        )

    return True
