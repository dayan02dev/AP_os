"""Read queries for the jury v2 portal endpoints. All reads use the admin
client (RLS-bypassing) because authorization is already enforced at the route
layer via require_capability + per-request juror_user_id matching.

Ported from the old jury build and stripped of ALL scoring/consensus
machinery: jurors PICK applications to mentor (jury_selections) — they do not
score them. There is therefore no weighted overall, no reviewer-consensus
panel, and no review status. jury_assignments v2 has no ``declined_at`` column
(every assignment row is active), so there is no declined filter.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from ..supabase_client import get_admin_client
from . import applications_query, review_presenter
from .founder_check.render import merge_sections as _merge_founder_sections

log = logging.getLogger(__name__)


def _compose_app_identifier(track: str, app_id: str, submitted_at: str | None) -> str:
    prefix = (track or "").upper()
    year = datetime.now().year
    if submitted_at:
        try:
            year = int(submitted_at[:4])
        except (ValueError, TypeError):
            pass
    tail = (app_id or "")[:8] or "unknown"
    return f"{prefix}-{year}-{tail}"


def _display_id(track: str, app_row: dict) -> str:
    seq = app_row.get("display_seq")
    prefix = "TIR" if track == "tir" else "SIP"
    return f"{prefix}-{seq}" if seq is not None else _compose_app_identifier(
        track, app_row.get("id", ""), app_row.get("submitted_at"))


def _founder_names(track: str, app_row: dict) -> list[str]:
    names = [app_row.get("basic_full_name") or ""]
    extra = app_row.get("basic_teammates") if track == "tir" else app_row.get("sip_founders")
    for t in (extra or []):
        n = (t or {}).get("name") or (t or {}).get("fullName")
        if n:
            names.append(n)
    return [n for n in names if n]


def _ai_block(ai_row: dict | None) -> dict | None:
    if not ai_row:
        return None
    conf = ai_row.get("confidence")
    return {
        "overall":  ai_row.get("score_overall"),
        "conf":     round(conf * 100) if isinstance(conf, (int, float)) else None,
        "problem":  ai_row.get("score_problem"),
        "solution": ai_row.get("score_completeness"),  # ai_screening naming (mig 016)
        "tech":     ai_row.get("score_tech"),
        "founders": ai_row.get("score_founders"),
        "commit":   ai_row.get("score_commitment"),
    }


def fetch_jury_queue(juror_user_id: str) -> list[dict]:
    """One canonical record per assignment for this juror. Each row carries a
    ``picked`` flag (+ ``pickNote``) resolved from the juror's own
    jury_selections. AI scores are included unconditionally."""
    from . import stats  # local import avoids any circular-import risk

    sb = get_admin_client()
    try:
        assignments = (sb.table("jury_assignments").select("*")
                       .eq("juror_user_id", juror_user_id).execute().data) or []
    except Exception as exc:
        log.warning("jury_queue: assignments fetch failed",
                    extra={"juror": juror_user_id, "err": str(exc)})
        return []
    # jury_assignments v2 has NO declined_at column — every row is active.
    assignments = [a for a in assignments if a.get("juror_user_id") == juror_user_id]
    if not assignments:
        return []

    all_ids = [a["application_id"] for a in assignments]
    ids_by_track: dict[str, list[str]] = {}
    for a in assignments:
        ids_by_track.setdefault(a["application_track"], []).append(a["application_id"])

    # Application rows: {(id, track): row}
    apps_by_key: dict[tuple[str, str], dict] = {}
    for track, ids in ids_by_track.items():
        if not ids:
            continue
        table = "tir_applications" if track == "tir" else "sip_applications"
        try:
            app_rows = (sb.table(table).select("*").in_("id", ids).execute().data) or []
        except Exception as exc:
            log.warning("jury_queue: app fetch failed",
                        extra={"juror": juror_user_id, "track": track, "err": str(exc)})
            app_rows = []
        for row in app_rows:
            rid = row.get("id")
            if rid is not None:
                apps_by_key[(rid, track)] = row

    # AI screening rows: {(application_id, application_track): row}
    ai_by_key: dict[tuple[str, str], dict] = {}
    try:
        ai_rows = (sb.table("ai_screening").select("*")
                   .in_("application_id", all_ids).execute().data) or []
    except Exception as exc:
        log.warning("jury_queue: ai_screening fetch failed",
                    extra={"juror": juror_user_id, "err": str(exc)})
        ai_rows = []
    for row in ai_rows:
        ai_by_key.setdefault(
            (row.get("application_id"), row.get("application_track")), row)

    # This juror's picks: {(application_id, application_track): row}
    my_picks: dict[tuple[str, str], dict] = {}
    try:
        sel_rows = (sb.table("jury_selections").select("*")
                    .eq("juror_user_id", juror_user_id)
                    .in_("application_id", all_ids).execute().data) or []
    except Exception as exc:
        log.warning("jury_queue: jury_selections fetch failed",
                    extra={"juror": juror_user_id, "err": str(exc)})
        sel_rows = []
    for row in sel_rows:
        if row.get("juror_user_id") != juror_user_id:
            continue  # enforce ownership (the fake client's .eq is honored, prod re-checks)
        my_picks.setdefault(
            (row.get("application_id"), row.get("application_track")), row)
    my_pick_keys = set(my_picks.keys())

    try:
        cats = (sb.table("industry_categories").select("*").execute().data) or []
    except Exception as exc:
        log.warning("jury_queue: industry_categories fetch failed",
                    extra={"juror": juror_user_id, "err": str(exc)})
        cats = []
    cat_label = {c["id"]: c.get("label") for c in cats}

    out: list[dict] = []
    for a in assignments:
        track = a["application_track"]
        aid = a["application_id"]
        app_row = apps_by_key.get((aid, track))
        if not app_row:
            continue

        ai_row = ai_by_key.get((aid, track))

        industry = None
        if ai_row and ai_row.get("industry_category_id"):
            industry = cat_label.get(ai_row["industry_category_id"])

        stage_info = stats.derive_stage_label({**app_row, "track": track})
        stage = stage_info.get("label") if stage_info else None

        out.append({
            "id":            aid,
            "assignmentId":  a["id"],
            "applicationId": _display_id(track, app_row),
            "track":         track,
            "name":          (ai_row or {}).get("project_name")
                             or app_row.get("basic_org")
                             or app_row.get("basic_full_name") or "—",
            "founders":      _founder_names(track, app_row),
            "industry":      industry or "—",
            "stage":         stage or "—",
            "due":           a.get("due_at"),
            "ai":            _ai_block(ai_row),
            "picked":        (aid, track) in my_pick_keys,
            "pickNote":      my_picks.get((aid, track), {}).get("note"),
        })
    out.sort(key=lambda x: x.get("due") or "9999")
    return out


def fetch_application_for_juror(
    juror_user_id: str, track: str, application_id: str,
) -> dict | None:
    """Return the app payload visible to a juror.

    Returns None if the juror has no assignment for this app (the router
    converts None → 404). jury_assignments v2 has no declined_at — a matching
    assignment row is always active.
    """
    sb = get_admin_client()

    # Assignment check
    try:
        assignment_rows = (
            sb.table("jury_assignments")
            .select("*")
            .eq("application_id", application_id)
            .eq("application_track", track)
            .eq("juror_user_id", juror_user_id)
            .execute()
            .data
        )
    except Exception as exc:
        log.warning("jury_app_detail: assignment fetch failed",
                    extra={"application_id": application_id, "track": track,
                           "err": str(exc)})
        return None
    active = [
        a for a in (assignment_rows or [])
        if a.get("juror_user_id") == juror_user_id
        and a.get("application_id") == application_id
        and a.get("application_track") == track
    ]
    if not active:
        return None
    assignment = active[0]

    # Application body
    table = "tir_applications" if track == "tir" else "sip_applications"
    try:
        app_rows = sb.table(table).select("*").eq("id", application_id).limit(1).execute().data
    except Exception as exc:
        log.warning("jury_app_detail: app fetch failed",
                    extra={"application_id": application_id, "track": track,
                           "err": str(exc)})
        return None
    if not app_rows:
        return None
    application = app_rows[0]

    # My selection (pick) — if any
    try:
        sel_rows = (
            sb.table("jury_selections")
            .select("*")
            .eq("application_id", application_id)
            .eq("application_track", track)
            .eq("juror_user_id", juror_user_id)
            .execute()
            .data
        )
    except Exception as exc:
        log.warning("jury_app_detail: jury_selections fetch failed",
                    extra={"application_id": application_id, "track": track,
                           "juror": juror_user_id, "err": str(exc)})
        sel_rows = []
    my_selection = sel_rows[0] if sel_rows else None

    # AI screening
    ai_screening = None
    try:
        ai_rows = (
            sb.table("ai_screening")
            .select("*")
            .eq("application_id", application_id)
            .eq("application_track", track)
            .execute()
            .data
        )
    except Exception as exc:
        log.warning("jury_app_detail: ai_screening fetch failed",
                    extra={"application_id": application_id, "track": track,
                           "err": str(exc)})
        ai_rows = []
    if ai_rows:
        ai_screening = ai_rows[0]

    return {
        "application": application,
        "assignment": {
            "assignment_id": assignment["id"],
            "assigned_at": assignment.get("assigned_at"),
        },
        "my_selection": my_selection,
        "ai_screening": ai_screening,
    }


def fetch_jury_content(
    juror_user_id: str, track: str, application_id: str,
) -> dict | None:
    """Full presenter payload for the jury app view.

    Returns None if fetch_application_for_juror returns None (router → 404).
    Mirrors the reviewer content path: founder-check sections merged into
    ``aiSections``, résumé resolved onto the row for the FE ProfilePills, and
    the raw application passed through. No scoring, no reviewer consensus.
    """
    payload = fetch_application_for_juror(juror_user_id, track, application_id)
    if payload is None:
        return None

    app_row = payload["application"]
    app_row["resume_file"] = applications_query.resolve_resume_file(track, app_row)
    ai = payload.get("ai_screening") or {}
    field_map = (review_presenter.TIR_FIELD_MAP if track == "tir"
                 else review_presenter.SIP_FIELD_MAP)

    attachments = []
    sb = get_admin_client()
    for att in review_presenter.collect_attachment_paths(app_row, track):
        try:
            signed = (sb.storage.from_(att["bucket"])
                      .create_signed_url(att["storage_path"], 120))
            url = None
            if isinstance(signed, dict):
                url = signed.get("signedURL") or signed.get("signedUrl") or signed.get("url")
            if url:
                attachments.append({"kind": att["kind"], "name": att["name"], "url": url})
        except Exception:
            log.warning("jury_content: signed url failed",
                        extra={"path": att["storage_path"]})

    return {
        "id": application_id,
        "applicationId": _display_id(track, app_row),
        "track": track,
        "application": app_row,
        "name": ai.get("project_name") or app_row.get("basic_org")
                or app_row.get("basic_full_name") or "—",
        "aiSummary": ai.get("summary"),
        "aiSections": _merge_founder_sections(ai.get("sections"), ai.get("founder_check")),
        "ai": _ai_block(payload.get("ai_screening")),
        "fields": review_presenter.build_fields(app_row, field_map),
        "sections": review_presenter.build_sections(app_row, track),
        "attachments": attachments,
        "mySelection": payload.get("my_selection"),
        "assignment": payload.get("assignment"),
    }
