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

from fastapi import HTTPException, status

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
