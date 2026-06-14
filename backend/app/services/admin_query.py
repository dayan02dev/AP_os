"""Admin-portal read service (Task 6).

The admin pipeline view is a superset of the leadership Applications list: it
adds the admin-portal joins introduced by migration 024 — the latest
`admin_decisions` row, the `application_admin_meta` hide/archive flags, and a
batch name from `application_batches` → `batches`.

Rather than duplicate the leadership list/detail query logic we reuse the
`applications_query` helpers (cross-track fetch, ai_screening / reviews /
status-history sub-fetches, track inference) and layer the admin-only joins on
top. Field names are kept consistent with the leadership detail where they
overlap (`ai_screening`, `reviews`, `reviewer_assignments`, `status_history`,
`application`) so the frontend can consume both.

Scale note: Phase 1 is hundreds of non-draft apps. Every join here is a bulk
`.in_()` keyed by `(application_id, application_track)` — one query per table
per track, no per-app loop. We post-filter in Python (hidden/archived/decision/
batch/search) for the same reason the leadership list does (PostgREST can't
express the cross-table predicates cleanly), see `applications_query.FETCH_CAP`.
"""

from __future__ import annotations

import logging
from typing import Any

from ..supabase_client import get_admin_client
from . import applications_query, stats

log = logging.getLogger(__name__)


# ─── Bulk join helpers ──────────────────────────────────────────────────


def _by_track(pairs: list[tuple[str, str]]) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {t: [] for t in stats.TRACKS}
    for t, a in pairs:
        if t in out:
            out[t].append(a)
    return out


def _fetch_latest_decisions(
    pairs: list[tuple[str, str]],
) -> dict[tuple[str, str], dict[str, Any]]:
    """Latest `admin_decisions` row per `(track, application_id)`.

    `decided_at desc` ordering is requested from PostgREST; we also reduce in
    Python (keep the max decided_at) so a fake/non-ordering backend still
    yields the latest. One query per track.
    """
    out: dict[tuple[str, str], dict[str, Any]] = {}
    if not pairs:
        return out
    for track, ids in _by_track(pairs).items():
        if not ids:
            continue
        try:
            res = (
                get_admin_client()
                .table("admin_decisions")
                .select("*")
                .eq("application_track", track)
                .in_("application_id", ids)
                .order("decided_at", desc=True)
                .execute()
            )
        except Exception as exc:
            log.warning("admin_query._fetch_latest_decisions failed",
                        extra={"track": track, "err": str(exc)})
            continue
        for row in res.data or []:
            aid = row.get("application_id")
            if aid is None:
                continue
            key = (track, aid)
            cur = out.get(key)
            if cur is None or (row.get("decided_at") or "") >= (cur.get("decided_at") or ""):
                out[key] = row
    return out


def _fetch_admin_meta(
    pairs: list[tuple[str, str]],
) -> dict[tuple[str, str], dict[str, Any]]:
    """`application_admin_meta` row per `(track, application_id)`."""
    out: dict[tuple[str, str], dict[str, Any]] = {}
    if not pairs:
        return out
    for track, ids in _by_track(pairs).items():
        if not ids:
            continue
        try:
            res = (
                get_admin_client()
                .table("application_admin_meta")
                .select("*")
                .eq("application_track", track)
                .in_("application_id", ids)
                .execute()
            )
        except Exception as exc:
            log.warning("admin_query._fetch_admin_meta failed",
                        extra={"track": track, "err": str(exc)})
            continue
        for row in res.data or []:
            aid = row.get("application_id")
            if aid is not None:
                out[(track, aid)] = row
    return out


def _fetch_batches(
    pairs: list[tuple[str, str]],
) -> dict[tuple[str, str], dict[str, Any]]:
    """Resolve `(track, id) → {"id", "name"}` via application_batches → batches.

    Two extra queries total: one application_batches projection per track plus
    a single batches lookup to resolve names.
    """
    out: dict[tuple[str, str], dict[str, Any]] = {}
    if not pairs:
        return out
    link: dict[tuple[str, str], str] = {}
    for track, ids in _by_track(pairs).items():
        if not ids:
            continue
        try:
            res = (
                get_admin_client()
                .table("application_batches")
                .select("application_id,batch_id")
                .eq("application_track", track)
                .in_("application_id", ids)
                .execute()
            )
        except Exception as exc:
            log.warning("admin_query._fetch_batches links failed",
                        extra={"track": track, "err": str(exc)})
            continue
        for row in res.data or []:
            aid = row.get("application_id")
            bid = row.get("batch_id")
            if aid and bid:
                # application_batches has a unique constraint on
                # (application_id, application_track) (migration 024), so
                # there is at most one batch per app.
                link[(track, aid)] = bid

    needed = {bid for bid in link.values()}
    names: dict[str, str] = {}
    if needed:
        try:
            res = (
                get_admin_client()
                .table("batches")
                .select("id,name")
                .in_("id", list(needed))
                .execute()
            )
            for row in res.data or []:
                names[row["id"]] = row.get("name")
        except Exception as exc:
            log.warning("admin_query._fetch_batches names failed",
                        extra={"err": str(exc)})

    for key, bid in link.items():
        out[key] = {"id": bid, "name": names.get(bid)}
    return out


# ─── Pipeline list ──────────────────────────────────────────────────────


def fetch_pipeline(filters: dict[str, Any]) -> dict[str, Any]:
    """Admin pipeline list across both tracks with admin-portal joins.

    `filters` keys (all optional):
        track, status, industry, decision, batch_id, search,
        include_hidden (bool), include_archived (bool)

    Hidden and archived apps are excluded by default; pass include_hidden /
    include_archived to surface them. Returns ``{"applications": [...],
    "total": n}``.
    """
    track = filters.get("track")
    status = filters.get("status")
    search = filters.get("search")

    # 1. Cross-track fetch with DB-applicable filters (status/search/track).
    tracks = [track] if track in stats.TRACKS else list(stats.TRACKS)
    rows: list[dict[str, Any]] = []
    for t in tracks:
        rows.extend(
            applications_query.fetch_apps_for_track(
                t, status=status, search=search,
                limit=applications_query.FETCH_CAP,
            )
        )

    pairs = [(r["track"], r["id"]) for r in rows]

    # 2. Bulk joins — one query per table per track, no per-app loop.
    scores = applications_query.fetch_ai_scores_for(pairs)
    project_names = applications_query.fetch_project_names_for(pairs)
    industries = applications_query.fetch_industry_for_pairs(pairs)
    decisions = _fetch_latest_decisions(pairs)
    meta = _fetch_admin_meta(pairs)
    batches = _fetch_batches(pairs)

    # 3. Post-fetch filters (hidden/archived/decision/batch/industry/search).
    include_hidden = bool(filters.get("include_hidden"))
    include_archived = bool(filters.get("include_archived"))
    want_decision = filters.get("decision")
    want_batch = filters.get("batch_id")
    want_industry = filters.get("industry")
    needle = (search or "").strip().lower()

    out_items: list[dict[str, Any]] = []
    for r in rows:
        key = (r["track"], r["id"])
        m = meta.get(key) or {}
        is_hidden = bool(m.get("is_hidden"))
        is_archived = bool(m.get("is_archived"))
        if is_hidden and not include_hidden:
            continue
        if is_archived and not include_archived:
            continue

        dec_row = decisions.get(key)
        decision = (dec_row or {}).get("decision")
        if want_decision and decision != want_decision:
            continue

        batch = batches.get(key)
        if want_batch and (batch or {}).get("id") != want_batch:
            continue

        ind = industries.get(key)
        if want_industry and (ind or {}).get("id") != want_industry:
            continue

        # search is already pushed to PostgREST per-track for real Supabase,
        # but the fake/no-op backend ignores it — keep a Python pass so the
        # filter is honoured regardless of backend.
        if needle:
            hay = " ".join([
                str(r.get("basic_full_name") or ""),
                str(r.get("basic_email") or ""),
                str(r.get("basic_org") or ""),
                str(r.get("display_seq") or ""),
                stats.compose_display_id(r.get("track"), r.get("display_seq")),
            ]).lower()
            if needle not in hay:
                continue

        name = (
            project_names.get(key)
            or stats.derive_project_name(r)
            or r.get("basic_org")
            or r.get("basic_full_name")
        )

        out_items.append({
            "id":               r["id"],
            "applicationId":    stats.compose_display_id(r["track"], r.get("display_seq")),
            "track":            r["track"],
            "name":             name,
            "founder":          r.get("basic_full_name"),
            "industry":         (ind or {}).get("label"),
            "stage":            stats.derive_stage_label({**r, "track": r["track"]}),
            "ai_score_overall": scores.get(key),
            "status":           r.get("status"),
            "decision":         decision,
            "isHidden":         is_hidden,
            "isArchived":       is_archived,
            "batch":            (batch or {}).get("name"),
            "submitted_at":     r.get("submitted_at"),
        })

    # Sort newest-submitted first (NULLs last), matching the leadership list.
    out_items.sort(
        key=lambda i: (0, i["submitted_at"]) if i.get("submitted_at") else (1, ""),
        reverse=True,
    )

    return {"applications": out_items, "total": len(out_items)}


# ─── Detail ─────────────────────────────────────────────────────────────


def fetch_detail(track: str, application_id: str) -> dict[str, Any] | None:
    """Full admin detail for one application, or None if not found.

    Reuses the leadership detail assembly (app row, ai_screening, reviews,
    reviewer_assignments, status_history) and adds the latest admin_decisions
    row (`decision`), the admin meta (`meta`), and the batch (`batch`).
    """
    found = applications_query.find_application_with_track(application_id)
    if found is None:
        return None
    found_track, app_row = found
    # The resolved track from find_application_with_track is authoritative;
    # the URL hint is not trusted (callers may pass an incorrect track).
    track = found_track

    ai_screening = applications_query.fetch_ai_screening_for(application_id, track)
    reviews = applications_query.fetch_reviews_for(application_id, track)
    reviewer_assignments = applications_query.fetch_reviewer_assignments_for(
        application_id, track,
    )
    status_history = applications_query.fetch_status_history_for(
        application_id, track,
    )

    key = (track, application_id)
    decision = _fetch_latest_decisions([key]).get(key)
    meta = _fetch_admin_meta([key]).get(key)
    batch = _fetch_batches([key]).get(key)

    # Industry label (single lookup) — mirrors the leadership detail shape.
    industry_obj = None
    if ai_screening and ai_screening.get("industry_category_id"):
        ind_id = ai_screening["industry_category_id"]
        try:
            res = (
                get_admin_client()
                .table("industry_categories")
                .select("label")
                .eq("id", ind_id)
                .limit(1)
                .execute()
            )
            if res.data:
                industry_obj = {"id": ind_id, "label": res.data[0]["label"]}
        except Exception:
            industry_obj = {"id": ind_id, "label": ind_id}

    app_row_with_track = {**app_row, "track": track}
    return {
        "id":                   application_id,
        "track":                track,
        "display_seq":          app_row.get("display_seq"),
        "display_id":           stats.compose_display_id(track, app_row.get("display_seq")),
        "project_name":         (ai_screening or {}).get("project_name")
                                or stats.derive_project_name(app_row),
        "founder": {
            "name":             app_row.get("basic_full_name"),
            "affiliation":      app_row.get("basic_org"),
        },
        "industry":             industry_obj,
        "stage":                stats.derive_stage_label(app_row_with_track),
        "application":          app_row,
        "ai_screening":         ai_screening,
        "reviews":              reviews,
        "reviewer_assignments": reviewer_assignments,
        "status_history":       status_history,
        # Admin-portal additions.
        "decision":             decision,
        "meta":                 meta,
        "batch":                batch,
    }
