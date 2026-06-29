"""EventBridge-scheduled Lambda: daily 09:00-IST reminder to each reviewer with
pending applications. Skips reviewers with nothing pending or no email. Best-effort."""
from __future__ import annotations

import logging
from typing import Any

from app.services.admin_query import fetch_roster
from app.services.email_service import frontend_url, get_email_service

log = logging.getLogger(__name__)
logging.getLogger().setLevel(logging.INFO)


def lambda_handler(event: dict, context: Any) -> dict:
    roster = fetch_roster() or {}
    reviewers = roster.get("reviewers", [])
    inbox = frontend_url("/reviewer")
    svc = get_email_service()
    sent = 0
    skipped = 0
    for r in reviewers:
        email = (r.get("email") or "").strip()
        assigned = int(r.get("assigned") or 0)
        completed = int(r.get("completed") or 0)
        pending = assigned - completed
        if pending <= 0 or not email:
            skipped += 1
            continue
        try:
            svc.send_reviewer_reminder(
                to=email,
                reviewer_name=r.get("name") or email,
                pending_count=pending,
                completed_count=completed,
                inbox_url=inbox,
            )
            sent += 1
        except Exception:  # noqa: BLE001
            log.warning("reviewer_reminder: send failed for %s", email, exc_info=True)
            skipped += 1
    log.info("reviewer_reminder: sent=%d skipped=%d", sent, skipped)
    return {"sent": sent, "skipped": skipped}
