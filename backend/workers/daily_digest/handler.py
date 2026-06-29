"""EventBridge-scheduled Lambda: daily 08:00-IST admin digest of every active
reviewer's progress (assigned / completed / pending). Emailed to all admins.
Best-effort."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from app.services.admin_query import fetch_roster
from app.services.email_service import get_email_service
from app.services.user_lookup import get_admin_emails
from app.supabase_client import get_admin_client

log = logging.getLogger(__name__)
logging.getLogger().setLevel(logging.INFO)

_IST = timezone(timedelta(hours=5, minutes=30))


def lambda_handler(event: dict, context: Any) -> dict:
    roster = fetch_roster() or {}
    reviewers = []
    total_pending = 0
    total_assigned = 0
    for r in roster.get("reviewers", []):
        assigned = int(r.get("assigned") or 0)
        completed = int(r.get("completed") or 0)
        pending = assigned - completed
        total_pending += max(0, pending)
        total_assigned += assigned
        reviewers.append({"name": r.get("name") or r.get("email") or "—",
                          "assigned": assigned, "completed": completed, "pending": pending})
    reviewers.sort(key=lambda x: x["pending"], reverse=True)

    sb = get_admin_client()
    recipients = get_admin_emails(sb)
    if not recipients:
        log.warning("daily_digest: no admin recipients — skipping")
        return {"sent": False, "reviewers": len(reviewers)}

    date_label = datetime.now(_IST).strftime("%d %b %Y")
    try:
        get_email_service().send_daily_digest(
            to=recipients, date_label=date_label, reviewers=reviewers,
            total_pending=total_pending, total_assigned=total_assigned,
        )
    except Exception:  # noqa: BLE001
        log.warning("daily_digest: send failed", exc_info=True)
        return {"sent": False, "reviewers": len(reviewers)}

    log.info("daily_digest: sent %d reviewers to %d admins", len(reviewers), len(recipients))
    return {"sent": True, "reviewers": len(reviewers), "recipients": len(recipients)}
