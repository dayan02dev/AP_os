"""Best-effort 'you've been assigned applications' emails. Never raises."""
from __future__ import annotations

import logging

from . import applications_query, stats
from .email_service import frontend_url, get_email_service
from .reviewer_query import DECIDED_STATUSES
from .user_lookup import get_contact

log = logging.getLogger(__name__)

_IN_CHUNK = 100  # keep the PostgREST URL short
_COLUMNS = "id, basic_full_name, basic_org, display_seq, moved_to_track, status"


def track_label(track: str | None) -> str:
    """Display label for emails: the sip track is branded 'VIP'."""
    return {"tir": "TIR", "sip": "VIP"}.get((track or "").lower(), (track or "").upper())


def _fetch_app_names(sb, assignments: list[dict]) -> dict[tuple[str, str], dict]:
    """Map (application_id, native track) -> {name, track_label, display_id, status}.

    track_label uses the EFFECTIVE track (moved-to-sip rows show 'VIP');
    display_id uses the native track + display_seq."""
    out: dict[tuple[str, str], dict] = {}
    for track in ("tir", "sip"):
        ids = list(dict.fromkeys(
            a["application_id"] for a in assignments if a.get("application_track") == track
        ))
        if not ids:
            continue
        rows: list[dict] = []
        for i in range(0, len(ids), _IN_CHUNK):
            chunk = ids[i : i + _IN_CHUNK]
            try:
                rows += (
                    sb.table(f"{track}_applications").select(_COLUMNS)
                    .in_("id", chunk).execute().data
                ) or []
            except Exception:  # noqa: BLE001
                log.warning("_fetch_app_names failed for track %s", track, exc_info=True)
        projects: dict = {}
        if track == "tir":
            try:
                projects = applications_query.fetch_project_names_for([("tir", r["id"]) for r in rows])
            except Exception:  # noqa: BLE001
                log.warning("project name lookup failed", exc_info=True)
        for r in rows:
            name = (
                (projects.get(("tir", r["id"])) if track == "tir" else None)
                or r.get("basic_org")
                or r.get("basic_full_name")
                or ""
            )
            out[(r["id"], track)] = {
                "name": name,
                "track_label": track_label(r.get("moved_to_track") or track),
                "display_id": stats.compose_display_id(track, r.get("display_seq")),
                "status": r.get("status"),
            }
    return out


def notify_reviewers_assigned(sb, assignments: list[dict], *, batch_name: str | None = None) -> int:
    """Send one batched email per reviewer for the just-created assignment rows.

    `assignments`: list of {reviewer_user_id, application_id, application_track}.
    Apps already decided (rejected/jury_review/offered/onboarded) are left out;
    a reviewer with nothing left gets no email. Returns the number of emails
    sent successfully. Best-effort: any failure is logged and swallowed.
    """
    if not assignments:
        return 0
    sent = 0
    try:
        by_rev: dict[str, list[dict]] = {}
        for a in assignments:
            by_rev.setdefault(a["reviewer_user_id"], []).append(a)
        info = _fetch_app_names(sb, assignments)
        svc = get_email_service()
        inbox = frontend_url("/reviewer")
        for uid, items in by_rev.items():
            apps = []
            for it in items:
                meta = info.get((it["application_id"], it["application_track"])) or {}
                if meta.get("status") in DECIDED_STATUSES:
                    continue
                apps.append({
                    "applicant_name": meta.get("name") or it["application_id"][:8],
                    "track_label": meta.get("track_label") or track_label(it.get("application_track")),
                    "display_id": meta.get("display_id")
                    or stats.compose_display_id(it.get("application_track"), None),
                })
            if not apps:
                continue
            contact = get_contact(sb, uid)
            if not contact or not contact.get("email"):
                continue
            try:
                svc.send_reviewer_assigned(
                    to=contact["email"], reviewer_name=contact.get("name") or contact["email"],
                    apps=apps, inbox_url=inbox, batch_name=batch_name,
                )
                sent += 1
            except Exception:  # noqa: BLE001
                log.warning("send_reviewer_assigned failed for %s", uid, exc_info=True)
    except Exception:  # noqa: BLE001
        log.warning("notify_reviewers_assigned failed", exc_info=True)
    return sent
