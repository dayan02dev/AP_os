"""Applicant-facing decision email (best-effort).

Fires when a gate-1 decision moves an application to an applicant-visible
outcome: ``rejected`` → gracious decline; ``jury_review`` → "advanced to jury".
Modeled on assignment_email.notify_reviewers_assigned — any failure is logged
and swallowed so the decision + status change always commit.
"""
from __future__ import annotations

import logging

from .email_service import get_email_service

log = logging.getLogger(__name__)

_OUTCOME = {"rejected": "rejected", "jury_review": "advanced"}


def notify_applicant_decided(sb, *, track: str, application_id: str, decision: str) -> None:
    outcome = _OUTCOME.get(decision)
    if outcome is None:
        return  # not an applicant-notifying decision
    try:
        table = f"{track}_applications"
        rows = (
            sb.table(table)
            .select("basic_full_name,basic_email")
            .eq("id", application_id)
            .limit(1)
            .execute()
            .data
            or []
        )
        if not rows:
            log.warning("notify_applicant_decided: app %s/%s not found", track, application_id)
            return
        email = (rows[0].get("basic_email") or "").strip()
        if not email:
            log.warning("notify_applicant_decided: no email for %s/%s", track, application_id)
            return
        name = rows[0].get("basic_full_name") or "there"
        program_label = "VIP" if track == "sip" else "TIR"
        get_email_service().send_applicant_decision(
            to=email, applicant_name=name, outcome=outcome,
            application_ref=application_id[:8], program_label=program_label,
        )
    except Exception:  # noqa: BLE001
        log.warning("notify_applicant_decided failed for %s/%s", track, application_id, exc_info=True)


# Gate-2 decisions used to notify the applicant of nothing at all. Two of the
# four now do: `offered` sends a track-specific selection email, and `rejected`
# reuses the SAME gracious decline gate-1 already sends — the applicant should
# not be able to tell which round declined them. `waitlisted` and `on_hold` stay
# silent, as they did before, because neither is a final answer.
_GATE2_SILENT = ("waitlisted", "on_hold")


def notify_applicant_gate2(sb, *, track: str, application_id: str, decision: str) -> None:
    """Applicant-facing gate-2 email. Best-effort: the decision has already
    committed by the time this runs, so nothing here may raise."""
    if decision in _GATE2_SILENT:
        return
    if decision not in ("offered", "rejected"):
        return
    try:
        table = f"{track}_applications"
        rows = (
            sb.table(table)
            .select("basic_full_name,basic_email")
            .eq("id", application_id)
            .limit(1)
            .execute()
            .data
            or []
        )
        if not rows:
            log.warning("notify_applicant_gate2: app %s/%s not found", track, application_id)
            return
        email = (rows[0].get("basic_email") or "").strip()
        if not email:
            log.warning("notify_applicant_gate2: no email for %s/%s", track, application_id)
            return
        name = rows[0].get("basic_full_name") or "there"

        if decision == "rejected":
            get_email_service().send_applicant_decision(
                to=email, applicant_name=name, outcome="rejected",
                application_ref=application_id[:8],
                program_label="VIP" if track == "sip" else "TIR",
            )
            return

        get_email_service().send_applicant_selected(
            to=email, applicant_name=name, track=track,
            venture=_venture_name(sb, track, application_id),
        )
    except Exception:  # noqa: BLE001
        log.warning("notify_applicant_gate2 failed for %s/%s", track, application_id, exc_info=True)


def _venture_name(sb, track: str, application_id: str) -> str:
    """AI-derived project name, used only to personalise the greeting. Any
    failure yields '' — a missing venture name must never block the email."""
    try:
        rows = (
            sb.table("ai_screening")
            .select("project_name")
            .eq("application_id", application_id)
            .eq("application_track", track)
            .limit(1)
            .execute()
            .data
            or []
        )
        return (rows[0].get("project_name") or "").strip() if rows else ""
    except Exception:  # noqa: BLE001
        return ""
