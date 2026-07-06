"""Application status state machine (spec §4.8).

Defines the canonical set of legal status transitions. The leadership
status-change endpoint that used to consume this was removed; the map now
backs the first-review auto-transition and transition validation.
Auto-transitions that fire from the AI worker (submitted → ai_screening →
under_review / screening_failed) are NOT exposed here; the worker writes
status directly.
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
#
# Reject is reachable from every active (non-terminal) status: leadership/admin
# can directly reject an application at any point in the pipeline — including
# while it is still under review — without first walking it to `evaluated`.
# The only states that cannot be rejected are the terminal ones (onboarded,
# rejected, withdrawn).
LEGAL_TRANSITIONS: dict[str, frozenset[str]] = {
    "submitted":        frozenset({"under_review", "jury_review", "rejected", "withdrawn"}),
    "ai_screening":     frozenset({"jury_review", "rejected", "withdrawn"}),
    "screening_failed": frozenset({"jury_review", "rejected", "withdrawn"}),
    "under_review":     frozenset({"evaluated", "jury_review", "rejected", "withdrawn"}),
    "evaluated":        frozenset({"shortlisted", "on_hold", "jury_review", "rejected", "waitlisted", "withdrawn"}),
    "on_hold":          frozenset({"evaluated", "shortlisted", "jury_review", "rejected", "waitlisted", "withdrawn"}),
    "shortlisted":      frozenset({"jury_review", "rejected", "withdrawn"}),
    "jury_review":      frozenset({"rejected", "withdrawn"}),
    "interview":        frozenset({"rejected", "withdrawn"}),
    "offered":          frozenset({"rejected", "withdrawn"}),
    "onboarded":        frozenset({"withdrawn"}),
    "rejected":         frozenset({"withdrawn"}),
    "waitlisted":       frozenset({"rejected", "withdrawn"}),
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
    if from_status in {"evaluated", "shortlisted", "on_hold", "jury_review", "rejected", "waitlisted"} \
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


def auto_transition_to_evaluated_on_first_review(application_id: str, track: str) -> bool:
    """Fire under_review -> evaluated as soon as the FIRST review is submitted
    for this application. Idempotent; only fires when the current status is
    'under_review'. Returns True iff it fired."""
    sb = get_admin_client()
    try:
        reviews = (
            sb.table("reviews").select("id,status,submitted_at")
            .eq("application_id", application_id)
            .eq("application_track", track)
            .execute().data
        ) or []
    except Exception as exc:  # noqa: BLE001
        log.warning("first_review transition: reviews fetch failed",
                    extra={"application_id": application_id, "track": track, "err": str(exc)})
        return False
    has_submitted_review = any(
        r.get("status") == "submitted" or r.get("submitted_at") for r in reviews
    )
    if not has_submitted_review:
        return False
    table = "tir_applications" if track == "tir" else "sip_applications"
    app_rows = (
        sb.table(table).select("status").eq("id", application_id).limit(1).execute().data
        or []
    )
    if not app_rows or app_rows[0].get("status") != "under_review":
        return False
    apply_status_change(
        application_id, track,
        to_status="evaluated", changed_by=None, reason="first review submitted",
    )
    return True


def apply_status_change(
    application_id: str,
    track: str,
    *,
    to_status: str,
    changed_by: str | None,
    reason: str | None = None,
) -> str:
    """Guarded status write: assert legal transition, update app row, log to
    application_status_log. Returns previous status. 404 if app missing, 422 if illegal."""
    sb = get_admin_client()
    table = "tir_applications" if track == "tir" else "sip_applications"
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
    assert_legal_transition(from_status, to_status)
    now_iso = datetime.now(UTC).isoformat()
    sb.table(table).update({"status": to_status}).eq("id", application_id).execute()
    try:
        sb.table("application_status_log").insert({
            "application_id":    application_id,
            "application_track": track,
            "from_status":       from_status,
            "to_status":         to_status,
            "changed_by":        changed_by,
            "reason":            reason,
            "changed_at":        now_iso,
        }).execute()
    except Exception as exc:
        log.warning(
            "apply_status_change: status_log insert failed (swallowed)",
            extra={"application_id": application_id, "err": str(exc)},
        )
    return from_status


def advance_to_under_review_on_assignment(application_id: str, track: str) -> bool:
    """Guarded submitted -> under_review, fired when a reviewer is assigned.
    No-op (returns False) unless the app is currently 'submitted'. Idempotent."""
    sb = get_admin_client()
    table = "tir_applications" if track == "tir" else "sip_applications"
    rows = (
        sb.table(table).select("status").eq("id", application_id).limit(1).execute().data
        or []
    )
    if not rows or rows[0].get("status") != "submitted":
        return False
    apply_status_change(
        application_id, track,
        to_status="under_review", changed_by=None, reason="reviewer assigned",
    )
    return True
