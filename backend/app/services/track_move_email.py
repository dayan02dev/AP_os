"""Applicant-facing 'your application was moved' email (best-effort).

Fires only when an application is MOVED to the other track (not on move-back).
Modeled on decision_email.notify_applicant_decided — any failure is logged and
swallowed so the track-move flag always commits."""
from __future__ import annotations

import logging

from .email_service import get_email_service

log = logging.getLogger(__name__)

_LABEL = {"tir": "TIR", "sip": "VIP"}


def notify_applicant_moved(sb, *, track: str, moved_to_track: str | None, application_id: str) -> None:
    if not moved_to_track:
        return  # move-back / not moved → no email
    try:
        table = f"{track}_applications"
        rows = (
            sb.table(table).select("basic_full_name,basic_email")
            .eq("id", application_id).limit(1).execute().data
            or []
        )
        if not rows:
            log.warning("notify_applicant_moved: app %s/%s not found", track, application_id)
            return
        email = (rows[0].get("basic_email") or "").strip()
        if not email:
            log.warning("notify_applicant_moved: no email for %s/%s", track, application_id)
            return
        get_email_service().send_track_moved(
            to=email,
            applicant_name=rows[0].get("basic_full_name") or "there",
            from_label=_LABEL.get(track, track.upper()),
            to_label=_LABEL.get(moved_to_track, moved_to_track.upper()),
            application_ref=application_id[:8],
        )
    except Exception:  # noqa: BLE001
        log.warning("notify_applicant_moved failed for %s/%s", track, application_id, exc_info=True)
