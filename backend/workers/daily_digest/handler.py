"""EventBridge-scheduled Lambda: daily 08:00-IST digest of the previous IST day's
submitted reviews, emailed to all admin-role users. Skips empty days. Best-effort."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from app.services.digest_summary import summarize_reviews
from app.services.digest_window import ist_date_label, previous_ist_day_utc_range
from app.services.email_service import get_email_service
from app.services.user_lookup import get_admin_emails, get_contact
from app.supabase_client import get_admin_client

log = logging.getLogger(__name__)
logging.getLogger().setLevel(logging.INFO)


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _parse(ts: str) -> datetime | None:
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except Exception:  # noqa: BLE001
        return None


def lambda_handler(event: dict, context: Any) -> dict:
    start, end = previous_ist_day_utc_range(_now_utc())
    sb = get_admin_client()
    rows = sb.table("reviews").select(
        "reviewer_user_id, application_id, application_track, recommendation, submitted_at,"
        " score_problem, score_solution, score_tech, score_founders, score_commitment"
    ).execute().data or []

    in_window = []
    for r in rows:
        sub = r.get("submitted_at")
        if not sub:
            continue
        dt = _parse(sub)
        if dt is not None and start <= dt < end:
            in_window.append(r)

    if not in_window:
        log.info("daily_digest: no reviews in window %s..%s — skipping", start, end)
        return {"sent": False, "reviews": 0}

    name_by_uid = {}
    for uid in {r["reviewer_user_id"] for r in in_window}:
        c = get_contact(sb, uid)
        if c:
            name_by_uid[uid] = c["name"]
    reviewers = summarize_reviews(in_window, name_by_uid)

    recipients = get_admin_emails(sb)
    if not recipients:
        log.warning("daily_digest: no admin recipients — skipping send")
        return {"sent": False, "reviews": len(in_window)}

    try:
        get_email_service().send_daily_digest(
            to=recipients,
            date_label=ist_date_label(start),
            total_reviews=len(in_window),
            reviewers=reviewers,
        )
    except Exception:  # noqa: BLE001
        log.warning("daily_digest: send failed", exc_info=True)
        return {"sent": False, "reviews": len(in_window)}

    log.info("daily_digest: sent %d reviews to %d admins", len(in_window), len(recipients))
    return {"sent": True, "reviews": len(in_window), "recipients": len(recipients)}
