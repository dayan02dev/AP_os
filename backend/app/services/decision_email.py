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
        get_email_service().send_applicant_decision(
            to=email, applicant_name=name, outcome=outcome, application_ref=application_id[:8],
        )
    except Exception:  # noqa: BLE001
        log.warning("notify_applicant_decided failed for %s/%s", track, application_id, exc_info=True)
