"""Applicant-facing decision emails (best-effort).

Which events mail the applicant:

  gate 1   rejected     → gracious decline           applicant_decision_rejected
           jury_review  → "you've advanced" update   applicant_decision_advanced
  gate 2   rejected     → the same decline as gate 1
           offered      → selection mail             applicant_selected_tir / _vip
           waitlisted, on_hold → nothing (neither is a final answer)
  IC sign  the first signature that completes a VIP application's current IC
           documents while it is still in jury_review → the VIP selection mail.
           The Final Gate is retired, so on the Accepted tab that signature is
           the moment an application becomes selected (routers/ic_documents.py).

``track`` is always the NATIVE track, i.e. the table that holds the row. The
programme a mail names follows the EFFECTIVE track (``moved_to_track`` when an
admin moved the application), so applicants hear from the programme they are
now in. VIP is the applicant-facing name of the ``sip`` track.

Modeled on assignment_email.notify_reviewers_assigned — any failure is logged
and swallowed so the decision, status change or signature always commits.
"""
from __future__ import annotations

import logging

from .email_service import get_email_service

log = logging.getLogger(__name__)

_OUTCOME = {"rejected": "rejected", "jury_review": "advanced"}
# Gate-2 decisions that mail the applicant; waitlisted / on_hold stay silent.
_GATE2_NOTIFY = ("offered", "rejected")


def program_label(track: str) -> str:
    """Programme name used in applicant copy: the sip track is VIP, never SIP."""
    return "VIP" if track == "sip" else "TIR"


def _recipient(sb, track: str, application_id: str, caller: str,
               extra_cols: str = "") -> tuple[dict | None, str]:
    """(application row, applicant email); (None, "") when either is missing."""
    cols = "basic_full_name,basic_email,moved_to_track" + (f",{extra_cols}" if extra_cols else "")
    rows = (
        sb.table(f"{track}_applications")
        .select(cols)
        .eq("id", application_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        log.warning("%s: app %s/%s not found", caller, track, application_id)
        return None, ""
    email = (rows[0].get("basic_email") or "").strip()
    if not email:
        log.warning("%s: no email for %s/%s", caller, track, application_id)
        return None, ""
    return rows[0], email


def _effective_track(row: dict, track: str) -> str:
    return row.get("moved_to_track") or track


def _send_decision(row: dict, email: str, track: str, application_id: str, outcome: str) -> None:
    get_email_service().send_applicant_decision(
        to=email, applicant_name=row.get("basic_full_name") or "there", outcome=outcome,
        application_ref=application_id[:8],
        program_label=program_label(_effective_track(row, track)),
    )


def _send_selection(sb, row: dict, email: str, track: str, application_id: str) -> None:
    get_email_service().send_applicant_selected(
        to=email,
        applicant_name=row.get("basic_full_name") or "there",
        track=_effective_track(row, track),
        venture=_venture_name(sb, track, application_id),
    )


def notify_applicant_decided(sb, *, track: str, application_id: str, decision: str) -> None:
    """Gate-1 mail: ``rejected`` → decline, ``jury_review`` → advanced."""
    outcome = _OUTCOME.get(decision)
    if outcome is None:
        return  # not an applicant-notifying decision
    try:
        row, email = _recipient(sb, track, application_id, "notify_applicant_decided")
        if row is None:
            return
        _send_decision(row, email, track, application_id, outcome)
    except Exception:  # noqa: BLE001
        log.warning("notify_applicant_decided failed for %s/%s", track, application_id, exc_info=True)


def notify_applicant_gate2(sb, *, track: str, application_id: str, decision: str) -> None:
    """Gate-2 mail: ``rejected`` → the gate-1 decline, ``offered`` → the
    selection mail of the application's effective track (TIR or VIP).

    The decision has already committed by the time this runs, so nothing here
    may raise.
    """
    if decision not in _GATE2_NOTIFY:
        return
    try:
        row, email = _recipient(sb, track, application_id, "notify_applicant_gate2")
        if row is None:
            return
        if decision == "rejected":
            _send_decision(row, email, track, application_id, "rejected")
            return
        _send_selection(sb, row, email, track, application_id)
    except Exception:  # noqa: BLE001
        log.warning("notify_applicant_gate2 failed for %s/%s", track, application_id, exc_info=True)


def notify_vip_selected(sb, *, track: str, application_id: str) -> None:
    """VIP selection mail once a signature has completed the application's IC
    documents for the first time (routers/ic_documents.py detects that).

    Sent only while the application is still in jury_review and only when its
    effective track is sip: TIR's acceptance mails were sent by hand, so this
    path stays silent for TIR. Best-effort — the signature is already recorded.
    """
    try:
        row, email = _recipient(sb, track, application_id, "notify_vip_selected",
                                extra_cols="status")
        if row is None or row.get("status") != "jury_review":
            return
        if _effective_track(row, track) != "sip":
            return
        _send_selection(sb, row, email, track, application_id)
    except Exception:  # noqa: BLE001
        log.warning("notify_vip_selected failed for %s/%s", track, application_id, exc_info=True)


def _venture_name(sb, track: str, application_id: str) -> str:
    """AI-derived project name, used only to personalise the selection mail.
    Any failure yields '' — a missing venture name must never block the email."""
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
