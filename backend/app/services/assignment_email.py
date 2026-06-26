"""Best-effort 'you've been assigned applications' emails. Never raises."""
from __future__ import annotations

import logging

from .email_service import frontend_url, get_email_service
from .user_lookup import get_contact

log = logging.getLogger(__name__)


def track_label(track: str | None) -> str:
    """Display label for emails: the sip track is branded 'VIP'."""
    return {"tir": "TIR", "sip": "VIP"}.get((track or "").lower(), (track or "").upper())


def _fetch_app_names(sb, assignments: list[dict]) -> dict[tuple[str, str], str]:
    """Map (application_id, track) -> applicant display name, batched per track."""
    out: dict[tuple[str, str], str] = {}
    for track in ("tir", "sip"):
        ids = [a["application_id"] for a in assignments if a.get("application_track") == track]
        if not ids:
            continue
        try:
            rows = (
                sb.table(f"{track}_applications").select("id, basic_full_name, basic_org_name")
                .in_("id", ids).execute().data
            ) or []
            for r in rows:
                out[(r["id"], track)] = r.get("basic_org_name") or r.get("basic_full_name") or ""
        except Exception:  # noqa: BLE001
            log.warning("_fetch_app_names failed for track %s", track, exc_info=True)
    return out


def notify_reviewers_assigned(sb, assignments: list[dict]) -> None:
    """Send one batched email per reviewer for the just-created assignment rows.

    `assignments`: list of {reviewer_user_id, application_id, application_track}.
    Best-effort: any failure is logged and swallowed.
    """
    if not assignments:
        return
    try:
        by_rev: dict[str, list[dict]] = {}
        for a in assignments:
            by_rev.setdefault(a["reviewer_user_id"], []).append(a)
        names = _fetch_app_names(sb, assignments)
        svc = get_email_service()
        inbox = frontend_url("/reviewer")
        for uid, items in by_rev.items():
            contact = get_contact(sb, uid)
            if not contact or not contact.get("email"):
                continue
            apps = [
                {
                    "applicant_name": names.get((it["application_id"], it["application_track"])) or it["application_id"][:8],
                    "track_label": track_label(it.get("application_track")),
                    "application_id_short": (it.get("application_id") or "")[:8],
                }
                for it in items
            ]
            try:
                svc.send_reviewer_assigned(
                    to=contact["email"], reviewer_name=contact.get("name") or contact["email"],
                    apps=apps, inbox_url=inbox,
                )
            except Exception:  # noqa: BLE001
                log.warning("send_reviewer_assigned failed for %s", uid, exc_info=True)
    except Exception:  # noqa: BLE001
        log.warning("notify_reviewers_assigned failed", exc_info=True)
