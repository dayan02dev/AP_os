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
from datetime import UTC, datetime
from typing import Any

from ..supabase_client import get_admin_client
from . import applications_query, reviewer_query, stats
from .founder_check.render import merge_sections as _merge_founder_sections

log = logging.getLogger(__name__)


def _stage_label(row: dict) -> str | None:
    """Stage as a plain string for the UI. ``stats.derive_stage_label`` returns
    ``{"raw", "label"}`` (or None); the admin pipeline/detail tables render the
    value directly, so we must hand them the label string, never the dict
    (a dict child triggers React error #31)."""
    info = stats.derive_stage_label(row)
    return info.get("label") if info else None


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
) -> dict[tuple[str, str], list[dict[str, Any]]]:
    """Resolve `(track, id) → [{"id", "name"}, ...]` via application_batches →
    batches. An application may now belong to MANY batches (migration 034), so
    every membership is returned as a list.

    Two extra queries total: one application_batches projection per track plus
    a single batches lookup to resolve names.
    """
    out: dict[tuple[str, str], list[dict[str, Any]]] = {}
    if not pairs:
        return out
    links: dict[tuple[str, str], list[str]] = {}
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
                links.setdefault((track, aid), []).append(bid)

    needed = {b for bl in links.values() for b in bl}
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

    for key, bids in links.items():
        out[key] = [{"id": b, "name": names.get(b)} for b in bids]
    return out


# ─── Pipeline list ──────────────────────────────────────────────────────


def _fetch_review_stats(
    pairs: list[tuple[str, str]],
) -> dict[tuple[str, str], dict[str, Any]]:
    """Per (track, application_id): reviewer score + counts + recommendation tally.

    One paginated pass over `reviews` + `reviewer_assignments`, keyed by
    ``(track, application_id)`` to match ``fetch_pipeline``/the leadership list.

    Returns, per key that has ANY submitted review or active assignment:
        {"score":     weighted mean of submitted, fully-scored reviews (or None),
         "submitted": distinct reviewers with a submitted review,
         "assigned":  distinct active assignments (declined_at/reassigned_to NULL),
         "reco":      {"yes": n, "maybe": n, "no": n} over submitted reviews}

    `score` reuses the old weight-adjusted mean (drafts + any-missing-dimension
    reviews skipped). Counts/tally are independent of the score skip: every
    submitted review counts, even one whose weighted-overall can't compute.
    Reads are paginated (`_fetch_all`) so counts stay correct past PostgREST's
    ~1000-row default cap.
    """
    if not pairs:
        return {}
    sb = get_admin_client()
    want = set(pairs)  # {(track, id)}

    try:
        rp_rows = _fetch_all(lambda: sb.table("reviewer_profiles").select("*"))
    except Exception as exc:
        log.warning("admin_query._fetch_review_stats profiles failed",
                    extra={"err": str(exc)})
        rp_rows = []
    weight_of: dict[str, float] = {}
    for rp in rp_rows:
        rid = rp.get("reviewer_user_id")
        if rid:
            w = rp.get("weight")
            weight_of[rid] = float(w) if w is not None else 1.0

    try:
        reviews = _fetch_all(lambda: sb.table("reviews").select("*"))
    except Exception as exc:
        log.warning("admin_query._fetch_review_stats reviews failed",
                    extra={"err": str(exc)})
        return {}
    try:
        assigns = _fetch_all(lambda: sb.table("reviewer_assignments").select("*"))
    except Exception as exc:
        log.warning("admin_query._fetch_review_stats assignments failed",
                    extra={"err": str(exc)})
        assigns = []

    submitted: dict[tuple[str, str], set] = {}
    reco: dict[tuple[str, str], dict[str, int]] = {}
    num: dict[tuple[str, str], float] = {}
    den: dict[tuple[str, str], float] = {}
    for r in reviews:
        if not r.get("submitted_at"):
            continue
        key = (r.get("application_track"), r.get("application_id"))
        if key not in want:
            continue
        rid = r.get("reviewer_user_id")
        submitted.setdefault(key, set()).add(rid)
        rec = r.get("recommendation")
        bucket = reco.setdefault(key, {"yes": 0, "maybe": 0, "no": 0})
        if rec in bucket:
            bucket[rec] += 1
        wo = reviewer_query._weighted_overall(r)
        if wo is None:
            continue
        w = weight_of.get(rid, 1.0)
        num[key] = num.get(key, 0.0) + w * wo
        den[key] = den.get(key, 0.0) + w

    assigned: dict[tuple[str, str], set] = {}
    for a in assigns:
        if a.get("declined_at") is not None or a.get("reassigned_to") is not None:
            continue
        key = (a.get("application_track"), a.get("application_id"))
        if key not in want:
            continue
        assigned.setdefault(key, set()).add(a.get("reviewer_user_id"))

    out: dict[tuple[str, str], dict[str, Any]] = {}
    for key in want:
        sub = len(submitted.get(key, ()))
        asg = len(assigned.get(key, ()))
        if sub == 0 and asg == 0:
            continue
        score = round(num[key] / den[key], 1) if den.get(key) else None
        out[key] = {
            "score":     score,
            "submitted": sub,
            "assigned":  asg,
            "reco":      reco.get(key, {"yes": 0, "maybe": 0, "no": 0}),
        }
    return out


def _fetch_reviewer_scores(
    pairs: list[tuple[str, str]],
) -> dict[tuple[str, str], float | None]:
    """Back-compat: just the weighted score per app (omitting Nones), keyed
    (track, application_id). Existing callers/tests rely on this shape."""
    return {
        key: v["score"]
        for key, v in _fetch_review_stats(pairs).items()
        if v["score"] is not None
    }


def reco_verdict(reco: dict | None) -> str | None:
    """Aggregate a {yes,maybe,no} submitted-review tally into one verdict.

    Mirrors frontend RecoCell.aggregateReco — keep the two in sync.
    Strict majority (> half of all submitted reviews) -> "yes"/"no";
    anything else with >=1 review -> "maybe"; no reviews -> None.
    """
    t = reco or {}
    yes = int(t.get("yes") or 0)
    maybe = int(t.get("maybe") or 0)
    no = int(t.get("no") or 0)
    total = yes + maybe + no
    if total == 0:
        return None
    if yes * 2 > total:
        return "yes"
    if no * 2 > total:
        return "no"
    return "maybe"


def _parse_exclude_status(exclude_status: Any) -> set[str]:
    """Normalize the `exclude_status` filter into a set of status strings.

    Accepts a comma-separated string ("rejected,jury_review"), an iterable, or
    None/"" (→ empty set). Lets the Applications tab hide several statuses at
    once (rejected AND jury_review) while staying backward-compatible with the
    single-value callers."""
    if not exclude_status:
        return set()
    if isinstance(exclude_status, str):
        return {s.strip() for s in exclude_status.split(",") if s.strip()}
    return set(exclude_status)


def fetch_pipeline(filters: dict[str, Any]) -> dict[str, Any]:
    """Admin pipeline list across both tracks with admin-portal joins.

    `filters` keys (all optional):
        track, status, exclude_status, industry, decision, batch_id, search,
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
    review_stats = _fetch_review_stats(pairs)
    jury_metrics = _fetch_jury_v2_metrics(pairs)

    # Reviewer-flag aggregation: union of flags across all submitted reviews
    # per app. One query per track; keyed (track, application_id) to match
    # `scores`/`project_names`.
    flags_by_key: dict[tuple[str, str], list] = {}
    for track, ids in _by_track(pairs).items():
        if not ids:
            continue
        try:
            res = (
                get_admin_client()
                .table("reviews")
                .select("application_id,application_track,submitted_at,flags")
                .eq("application_track", track)
                .in_("application_id", ids)
                .execute()
            )
            for rv in res.data or []:
                if not rv.get("submitted_at"):
                    continue
                fl = rv.get("flags")
                if not isinstance(fl, list) or not fl:
                    continue
                aid = rv.get("application_id")
                if aid is None:
                    continue
                k = (track, aid)
                flags_by_key.setdefault(k, []).extend(fl)
        except Exception as exc:
            log.warning("admin_query.fetch_pipeline flags fetch failed",
                        extra={"track": track, "err": str(exc)})

    # 3. Post-fetch filters (hidden/archived/decision/batch/industry/search).
    include_hidden = bool(filters.get("include_hidden"))
    include_archived = bool(filters.get("include_archived"))
    exclude_set = _parse_exclude_status(filters.get("exclude_status"))
    want_decision = filters.get("decision")
    want_batch = filters.get("batch_id")
    want_industry = filters.get("industry")
    needle = (search or "").strip().lower()

    # Jury recommendation filter: when set, keep only apps recommended for that
    # juror and attach the {score, reason}; the result is later sorted by score
    # desc instead of submitted_at. Unset → pipeline behaves exactly as before.
    recommended_for = filters.get("recommended_for")
    rec_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    if recommended_for:
        try:
            rec_rows = _fetch_all(
                lambda: get_admin_client().table("jury_recommendations")
                .select("*").eq("juror_user_id", recommended_for)
            )
        except Exception as exc:
            log.warning("fetch_pipeline: jury_recommendations fetch failed",
                        extra={"err": str(exc)})
            rec_rows = []
        for rr in rec_rows:
            if rr.get("juror_user_id") != recommended_for:
                continue
            rec_by_key[(rr.get("application_track"), rr.get("application_id"))] = {
                "score":  rr.get("score"),
                "reason": rr.get("reason"),
            }

    out_items: list[dict[str, Any]] = []
    for r in rows:
        key = (r["track"], r["id"])
        if recommended_for and key not in rec_by_key:
            continue
        m = meta.get(key) or {}
        is_hidden = bool(m.get("is_hidden"))
        is_archived = bool(m.get("is_archived"))
        if is_hidden and not include_hidden:
            continue
        if is_archived and not include_archived:
            continue
        if exclude_set and r.get("status") in exclude_set:
            continue

        dec_row = decisions.get(key)
        decision = (dec_row or {}).get("decision")
        if want_decision and decision != want_decision:
            continue

        batch_list = batches.get(key) or []
        if want_batch and not any(b.get("id") == want_batch for b in batch_list):
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

        if r.get("track") == "sip":
            name = r.get("basic_org") or r.get("basic_full_name")
        else:
            name = (
                project_names.get(key)
                or stats.derive_project_name(r)
                or r.get("basic_org")
                or r.get("basic_full_name")
            )

        # `r["track"]` is the NATIVE track (used for every child-table key
        # above); `eff` is the effective/display track under the track-move
        # overlay (moved_to_track wins).
        eff = applications_query.effective_track(r)
        item = {
            "id":               r["id"],
            "applicationId":    stats.compose_display_id(eff, r.get("display_seq")),
            "track":            eff,
            "native_track":     r["track"],
            "name":             name,
            "founder":          r.get("basic_full_name"),
            "industry":         (ind or {}).get("label"),
            "stage":            _stage_label({**r, "track": r["track"]}),
            "ai_score_overall": scores.get(key),
            "status":           r.get("status"),
            "decision":         decision,
            "isHidden":         is_hidden,
            "isArchived":       is_archived,
            "batch":            (batch_list[0]["name"] if batch_list else None),
            "batches":          batch_list,
            "reviewer_score":   (review_stats.get(key) or {}).get("score"),
            "reviewers":        {
                                    "submitted": (review_stats.get(key) or {}).get("submitted", 0),
                                    "assigned":  (review_stats.get(key) or {}).get("assigned", 0),
                                } if review_stats.get(key) else None,
            "reco":             (review_stats.get(key) or {}).get("reco"),
            "submitted_at":     r.get("submitted_at"),
            "flags":            flags_by_key.get(key, []),
            "moved_to_track":   r.get("moved_to_track"),
            # Additive jury-v2 pick metrics (all rows; zero-valued off-gate2).
            **(jury_metrics.get(key) or {}),
        }
        if recommended_for:
            item["recommendation"] = rec_by_key.get(key)
        out_items.append(item)

    if recommended_for:
        # Best fit first when filtering by a juror's recommendations.
        out_items.sort(
            key=lambda i: (i.get("recommendation") or {}).get("score") or 0,
            reverse=True,
        )
    else:
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
    app_row["resume_file"] = applications_query.resolve_resume_file(track, app_row)

    ai_screening = applications_query.fetch_ai_screening_for(application_id, track)
    reviews = applications_query.fetch_reviews_for(application_id, track)
    reviewer_assignments = applications_query.fetch_reviewer_assignments_for(
        application_id, track,
    )
    # Attach reviewer display names + a timestamp-derived status so the admin
    # application detail shows the reviewer's name and "Evaluated" instead of
    # the UUID prefix and a stuck "pending".
    reviewer_assignments, reviews = applications_query.enrich_reviewers(
        reviewer_assignments, reviews,
    )
    status_history = applications_query.fetch_status_history_for(
        application_id, track,
    )

    key = (track, application_id)
    decision = _fetch_latest_decisions([key]).get(key)
    meta = _fetch_admin_meta([key]).get(key)
    batch_list = _fetch_batches([key]).get(key) or []

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
    also_track = applications_query.also_in_track(app_row.get("basic_email"), track)
    # `track` is native (drove every child fetch above); `eff` is the display
    # track under the track-move overlay.
    eff = applications_query.effective_track(app_row_with_track)
    return {
        "id":                   application_id,
        "track":                eff,
        "native_track":         track,
        "also_in_track":        also_track,
        "moved_to_track":       app_row.get("moved_to_track"),
        "display_seq":          app_row.get("display_seq"),
        "display_id":           stats.compose_display_id(eff, app_row.get("display_seq")),
        "project_name":         (ai_screening or {}).get("project_name")
                                or stats.derive_project_name(app_row),
        "founder": {
            "name":             app_row.get("basic_full_name"),
            "affiliation":      app_row.get("basic_org"),
        },
        "industry":             industry_obj,
        "stage":                _stage_label(app_row_with_track),
        "application":          app_row,
        "ai_screening":         ai_screening,
        "aiSections":           _merge_founder_sections(
                                    (ai_screening or {}).get("sections"),
                                    (ai_screening or {}).get("founder_check")),
        "reviews":              reviews,
        "reviewer_assignments": reviewer_assignments,
        "status_history":       status_history,
        # Admin-portal additions.
        "decision":             decision,
        "meta":                 meta,
        "batch":                (batch_list[0] if batch_list else None),
        "batches":              batch_list,
    }


# ─── Task 11: Reviewer roster ────────────────────────────────────────────


def _reviewer_user_ids() -> list[str]:
    """Distinct user_ids holding the 'reviewer' role."""
    try:
        rows = (
            get_admin_client()
            .table("user_roles")
            .select("user_id,role")
            .eq("role", "reviewer")
            .execute()
            .data
        ) or []
    except Exception as exc:
        log.warning("roster: user_roles fetch failed", extra={"err": str(exc)})
        return []
    # Fake .eq() filters; real PostgREST narrows server-side. Enforce in Python
    # either way and dedupe.
    return sorted({r["user_id"] for r in rows if r.get("role") == "reviewer"})


_ROSTER_PAGE = 1000


def _fetch_all(make_query, *, page: int = _ROSTER_PAGE) -> list[dict]:
    """Read EVERY row from a PostgREST query, paging past the ~1000-row default cap.

    `make_query` is a thunk returning a FRESH query builder on each call — a builder's
    .range() can't be safely re-applied, so every page rebuilds the query (same pattern
    as iter_assignment_rows). Loops until a short page signals the end.
    """
    rows: list[dict] = []
    offset = 0
    while True:
        chunk = (make_query().range(offset, offset + page - 1).execute().data) or []
        rows.extend(chunk)
        if len(chunk) < page:
            break
        offset += page
    return rows


def fetch_roster() -> dict[str, Any]:
    """Reviewer roster with per-reviewer workload + consistency metrics.

    All sub-tables are bulk-fetched once and grouped in Python (no per-reviewer
    N+1). Consistency compares the reviewer's weighted overall (reviewer_query.
    _weighted_overall) against ai_screening.score_overall for the same app:
        consistency = round(1 - mean(|reviewer - ai|)/10, 2), clamped 0..1,
        None when no submitted review has a matching ai_overall.
    """
    sb = get_admin_client()
    reviewer_ids = _reviewer_user_ids()
    if not reviewer_ids:
        return {"reviewers": []}
    id_set = set(reviewer_ids)

    id_list = list(id_set)

    def _fetch(table: str) -> list[dict]:
        try:
            return _fetch_all(lambda: sb.table(table).select("*"))
        except Exception as exc:
            log.warning("roster: fetch failed", extra={"table": table, "err": str(exc)})
            return []

    def _fetch_in(table: str, col: str) -> list[dict]:
        # Filter by the (few) reviewer ids, and PAGE past PostgREST's 1000-row
        # default cap — reviewer_assignments alone is >3000 rows, so a single
        # select("*") silently dropped most reviewers' assignments (roster showed
        # "No assignments" / wrong batch for the newest reviewers).
        if not id_list:
            return []
        try:
            return _fetch_all(lambda: sb.table(table).select("*").in_(col, id_list))
        except Exception as exc:
            log.warning("roster: fetch_in failed", extra={"table": table, "err": str(exc)})
            return []

    profiles = {p["id"]: p for p in _fetch_in("profiles", "id")}
    rp_rows = {
        p["reviewer_user_id"]: p
        for p in _fetch_in("reviewer_profiles", "reviewer_user_id")
    }

    # Assignments grouped per reviewer.
    assignments_by_rev: dict[str, list[dict]] = {rid: [] for rid in reviewer_ids}
    for a in _fetch_in("reviewer_assignments", "reviewer_user_id"):
        rid = a.get("reviewer_user_id")
        if rid in id_set:
            assignments_by_rev[rid].append(a)

    # Reviews grouped per reviewer (submitted only matter for consistency).
    reviews_by_rev: dict[str, list[dict]] = {rid: [] for rid in reviewer_ids}
    reviewed_keys: set[tuple[str, str]] = set()
    for r in _fetch_in("reviews", "reviewer_user_id"):
        rid = r.get("reviewer_user_id")
        if rid in id_set:
            reviews_by_rev[rid].append(r)
            reviewed_keys.add((r.get("application_id"), r.get("application_track")))

    # ai_screening keyed by (application_id, application_track) for the apps that
    # these reviewers have reviewed.
    ai_by_key: dict[tuple[str, str], dict] = {}
    for row in _fetch("ai_screening"):
        key = (row.get("application_id"), row.get("application_track"))
        if key in reviewed_keys:
            ai_by_key.setdefault(key, row)

    # Batch membership: (application_id, application_track) → batch name. Built
    # once via application_batches → batches, used to group each reviewer's
    # assigned apps by the batch they belong to (apps with no batch are omitted
    # from the per-reviewer `batches` list).
    batch_names: dict[str, str | None] = {
        b["id"]: b.get("name") for b in _fetch("batches") if b.get("id")
    }
    app_batch_name: dict[tuple[str, str], str | None] = {}
    for link in _fetch("application_batches"):
        aid = link.get("application_id")
        track = link.get("application_track")
        bid = link.get("batch_id")
        if aid and track and bid in batch_names:
            app_batch_name[(aid, track)] = batch_names.get(bid)

    # Rejected apps: excluded from every reviewer's active/assigned/batches so
    # a Gate-1 rejection (which detaches the app — see decisions.record_decision
    # / applications_query.detach_application_from_review) can never re-appear
    # in the roster via a not-yet-cleaned-up row.
    rejected_keys: set[tuple[str, str]] = set()
    for tbl, trk in (("tir_applications", "tir"), ("sip_applications", "sip")):
        for row in _fetch_all(lambda t=tbl: sb.table(t).select("id,status")):
            if row.get("status") == "rejected" and row.get("id"):
                rejected_keys.add((row["id"], trk))

    out: list[dict[str, Any]] = []
    for rid in reviewer_ids:
        prof = profiles.get(rid) or {}
        rp = rp_rows.get(rid) or {}

        active = [
            a for a in assignments_by_rev[rid]
            if a.get("declined_at") is None and a.get("reassigned_to") is None
            and (a.get("application_id"), a.get("application_track")) not in rejected_keys
        ]
        # Progress = WORK DONE. `completed` = distinct apps this reviewer has
        # submitted a review for; `assigned` = |active assignments ∪ reviewed|.
        # Counts reviews even for apps the reviewer was later unassigned from
        # (the reassignment churn), and never exceeds 100%. Independent of the
        # unreliable reviewer_assignments.completed_at.
        submitted_keys = {
            (r.get("application_id"), r.get("application_track"))
            for r in reviews_by_rev[rid]
            if r.get("submitted_at")
            and (r.get("application_id"), r.get("application_track")) not in rejected_keys
        }
        active_keys = {
            (a.get("application_id"), a.get("application_track")) for a in active
        }
        completed = len(submitted_keys)
        assigned = len(active_keys | submitted_keys)

        # Group this reviewer's active assignments by batch name. Apps with no
        # batch membership are omitted (they still count in `assigned`).
        batch_counts: dict[str, int] = {}
        for a in active:
            key = (a.get("application_id"), a.get("application_track"))
            name = app_batch_name.get(key)
            if name is None:
                continue
            batch_counts[name] = batch_counts.get(name, 0) + 1
        unbatched = sum(
            1 for a in active
            if app_batch_name.get((a.get("application_id"), a.get("application_track"))) is None
        )
        batches = [
            {"name": name, "count": count}
            for name, count in sorted(batch_counts.items())
        ]
        if unbatched:
            batches.append({"name": "Unbatched", "count": unbatched})

        # Consistency over submitted reviews with a matching ai_overall.
        diffs: list[float] = []
        last_activity: str | None = None
        for r in reviews_by_rev[rid]:
            sub = r.get("submitted_at")
            if sub and (last_activity is None or sub > last_activity):
                last_activity = sub
            if not sub:
                continue
            mine = reviewer_query._weighted_overall(r)
            ai_row = ai_by_key.get((r.get("application_id"), r.get("application_track")))
            ai_overall = (ai_row or {}).get("score_overall")
            if mine is None or ai_overall is None:
                continue
            diffs.append(abs(mine - ai_overall))

        # Fallback 1: max assigned_at from reviewer_assignments (covers reviewers
        # who have been assigned but not yet submitted any review).
        if last_activity is None:
            for a in assignments_by_rev[rid]:
                assigned_at = a.get("assigned_at")
                if assigned_at and (last_activity is None or assigned_at > last_activity):
                    last_activity = assigned_at

        # Fallback 2: reviewer_profiles.updated_at if still no activity.
        if last_activity is None:
            rp_updated = rp.get("updated_at")
            if rp_updated:
                last_activity = rp_updated
        if diffs:
            consistency = round(1 - (sum(diffs) / len(diffs)) / 10, 2)
            consistency = max(0.0, min(1.0, consistency))
        else:
            consistency = None

        weight = rp.get("weight")
        out.append({
            "user_id":      rid,
            "name":         prof.get("full_name") or prof.get("email") or rid,
            "email":        prof.get("email"),
            "weight":       float(weight) if weight is not None else 1.0,
            "domains":      rp.get("expertise_domains") or [],
            "batch":        rp.get("batch_id"),
            "assigned":     assigned,
            "completed":    completed,
            "progress":     f"{completed} / {assigned}",
            "consistency":  consistency,
            "lastActivity": last_activity,
            "batches":      batches,
        })

    return {"reviewers": out}


def fetch_reviewer_applications(user_id: str) -> dict[str, Any]:
    """Applications actively assigned to one reviewer, enriched for the admin
    "Manage Applications" drawer. Active = declined_at IS NULL AND
    reassigned_to IS NULL. Returns ``{"applications": [...]}`` with each row:
    ``{id, track, project, industry, status, batch, reviewStatus, assignment_id}``.
    ``batch`` is None when the app belongs to no batch (UI → "Random allotment").
    """
    sb = get_admin_client()
    try:
        rows = (
            sb.table("reviewer_assignments")
            .select("*")
            .eq("reviewer_user_id", user_id)
            .execute()
            .data
        ) or []
    except Exception as exc:
        log.warning("reviewer apps: assignments fetch failed", extra={"err": str(exc)})
        return {"applications": []}

    active = [
        a for a in rows
        if a.get("reviewer_user_id") == user_id
        and a.get("declined_at") is None
        and a.get("reassigned_to") is None
    ]
    pairs = [(a["application_track"], a["application_id"]) for a in active]
    if not pairs:
        return {"applications": []}

    project_names = applications_query.fetch_project_names_for(pairs)
    industries = applications_query.fetch_industry_for_pairs(pairs)
    batches = _fetch_batches(pairs)

    # App rows (status + project fallback), one query per track.
    app_rows: dict[tuple[str, str], dict] = {}
    for track, ids in _by_track(pairs).items():
        if not ids:
            continue
        try:
            data = (
                sb.table(applications_query.track_table(track))
                .select("*").in_("id", ids).execute().data
            ) or []
        except Exception:
            data = []
        for r in data:
            app_rows[(track, r["id"])] = r

    # Which of these apps has this reviewer already SUBMITTED a review for?
    submitted: set[tuple[str, str]] = set()
    try:
        for r in (
            sb.table("reviews").select("*").eq("reviewer_user_id", user_id).execute().data
        ) or []:
            if r.get("reviewer_user_id") == user_id and r.get("submitted_at"):
                submitted.add((r.get("application_track"), r.get("application_id")))
    except Exception:
        pass

    out: list[dict[str, Any]] = []
    for a in active:
        key = (a["application_track"], a["application_id"])
        r = app_rows.get(key) or {}
        if a["application_track"] == "sip":
            project = r.get("basic_org") or r.get("basic_full_name")
        else:
            project = (
                project_names.get(key)
                or stats.derive_project_name(r)
                or r.get("basic_org")
                or r.get("basic_full_name")
            )
        out.append({
            "id":            a["application_id"],
            "track":         a["application_track"],
            "project":       project,
            "industry":      (industries.get(key) or {}).get("label"),
            "status":        r.get("status"),
            "batch":         next((b["name"] for b in (batches.get(key) or [])), None),
            "reviewStatus":  "submitted" if key in submitted else "pending",
            "assignment_id": a.get("id"),
        })
    out.sort(key=lambda i: (i.get("project") or "").lower())
    return {"applications": out}


# ─── Task 8: Jury roster v2 + juror applications + pipeline metrics ───────
#
# Jury v2 is pick-based (jury_selections), NOT scoring — there are no
# jury_reviews / weighted overalls / consistency. jury_assignments v2 has no
# ``declined_at`` column (every row is active). Every bulk read pages through
# ``_fetch_all`` so the ~1000-row PostgREST cap can never silently truncate a
# juror's assignments/picks (the bug that bit the reviewer roster twice).


def _jury_user_ids() -> list[str]:
    """Distinct user_ids holding the 'jury' role (re-filtered in Python because
    the fake `.eq()` is a no-op)."""
    sb = get_admin_client()
    try:
        rows = _fetch_all(
            lambda: sb.table("user_roles").select("user_id,role").eq("role", "jury")
        )
    except Exception as exc:
        log.warning("jury roster: user_roles fetch failed", extra={"err": str(exc)})
        return []
    return sorted({r["user_id"] for r in rows if r.get("role") == "jury"})


def fetch_jury_roster() -> dict[str, Any]:
    """Jury roster (pick-based) plus outstanding invites.

    Returns ``{"jurors": [...], "pending_invites": [...]}``. Each juror row:
    ``{user_id, name, email, weight, domains, linkedin_url, enrichmentStatus,
    matchedAt, assigned, picks("n / 3"), picksSubmitted, lastActivity, invite}``.
    ``pending_invites`` lists invited-but-not-answered rows only (accepted +
    declined excluded).
    """
    sb = get_admin_client()
    juror_ids = _jury_user_ids()

    profiles = (
        {p["id"]: p for p in _fetch_all(
            lambda: sb.table("profiles").select("*").in_("id", juror_ids))}
        if juror_ids else {}
    )
    jprofiles = (
        {p["juror_user_id"]: p for p in _fetch_all(
            lambda: sb.table("jury_profiles").select("*").in_("juror_user_id", juror_ids))}
        if juror_ids else {}
    )
    assignments = _fetch_all(lambda: sb.table("jury_assignments").select("*")) if juror_ids else []
    selections = _fetch_all(lambda: sb.table("jury_selections").select("*")) if juror_ids else []
    invites = _fetch_all(lambda: sb.table("jury_invites").select("*"))
    invite_by_id = {i["id"]: i for i in invites if i.get("id") is not None}

    out: list[dict[str, Any]] = []
    for jid in juror_ids:
        prof = profiles.get(jid) or {}
        jp = jprofiles.get(jid) or {}
        assigned = [a for a in assignments if a.get("juror_user_id") == jid]
        picks = [s for s in selections if s.get("juror_user_id") == jid]
        last = max((s.get("submitted_at") or "" for s in picks), default="") or None
        inv = invite_by_id.get(jp.get("invite_id"))
        weight = jp.get("weight")
        out.append({
            "user_id":          jid,
            "name":             prof.get("full_name") or prof.get("email") or jid,
            "email":            prof.get("email"),
            "weight":           float(weight) if weight is not None else 1.0,
            "domains":          jp.get("expertise_domains") or [],
            "linkedin_url":     jp.get("linkedin_url"),
            "enrichmentStatus": jp.get("enrichment_status") or "pending",
            "matchedAt":        jp.get("matched_at"),
            "assigned":         len(assigned),
            "picks":            f"{len(picks)} / 3",
            "picksSubmitted":   len(picks),
            "lastActivity":     last,
            "invite":           {"status": inv["status"]} if inv else None,
        })

    pending = [
        {"name": i.get("name"), "email": i.get("email"), "sent_at": i.get("sent_at")}
        for i in invites if i.get("status") == "invited"
    ]
    return {"jurors": out, "pending_invites": pending}


def fetch_juror_applications(user_id: str) -> dict[str, Any]:
    """Applications assigned to one juror, enriched for the admin drawer.

    Ported from the reviewer analog with two v2 edits: there is no active/
    declined filter (jury_assignments v2 has no ``declined_at`` — every row is
    active), and ``reviewStatus`` becomes ``picked`` (a bool resolved from
    ``jury_selections``). Returns ``{"applications": [...]}`` with each row
    ``{id, track, project, industry, status, batch, picked, assignment_id}``.
    """
    sb = get_admin_client()
    try:
        rows = _fetch_all(
            lambda: sb.table("jury_assignments").select("*").eq("juror_user_id", user_id)
        )
    except Exception as exc:
        log.warning("juror apps: assignments fetch failed", extra={"err": str(exc)})
        return {"applications": []}

    active = [a for a in rows if a.get("juror_user_id") == user_id]
    pairs = [(a["application_track"], a["application_id"]) for a in active]
    if not pairs:
        return {"applications": []}

    project_names = applications_query.fetch_project_names_for(pairs)
    industries = applications_query.fetch_industry_for_pairs(pairs)
    batches = _fetch_batches(pairs)

    # App rows (status + project fallback), one paged query per track.
    app_rows: dict[tuple[str, str], dict] = {}
    for track, ids in _by_track(pairs).items():
        if not ids:
            continue
        try:
            data = _fetch_all(
                lambda tb=track, idl=ids:
                sb.table(applications_query.track_table(tb)).select("*").in_("id", idl)
            )
        except Exception:
            data = []
        for r in data:
            app_rows[(track, r["id"])] = r

    # Which of these apps has this juror already PICKED (jury_selections)?
    picked_keys: set[tuple[str, str]] = set()
    try:
        for s in _fetch_all(
            lambda: sb.table("jury_selections").select("*").eq("juror_user_id", user_id)
        ):
            if s.get("juror_user_id") == user_id:
                picked_keys.add((s.get("application_track"), s.get("application_id")))
    except Exception:
        pass

    out: list[dict[str, Any]] = []
    for a in active:
        key = (a["application_track"], a["application_id"])
        r = app_rows.get(key) or {}
        if a["application_track"] == "sip":
            project = r.get("basic_org") or r.get("basic_full_name")
        else:
            project = (
                project_names.get(key)
                or stats.derive_project_name(r)
                or r.get("basic_org")
                or r.get("basic_full_name")
            )
        out.append({
            "id":            a["application_id"],
            "track":         a["application_track"],
            "project":       project,
            "industry":      (industries.get(key) or {}).get("label"),
            "status":        r.get("status"),
            "batch":         (batches.get(key) or {}).get("name"),
            "picked":        key in picked_keys,
            "assignment_id": a.get("id"),
        })
    out.sort(key=lambda i: (i.get("project") or "").lower())
    return {"applications": out}


def _fetch_jury_v2_metrics(
    pairs: list[tuple[str, str]],
) -> dict[tuple[str, str], dict[str, Any]]:
    """Per ``(track, application_id)`` jury metrics for the admin pipeline.

    Returns for every pair a dict of ``jury_assigned`` (int),
    ``jury_assigned_names`` (list), ``picked_by`` (``[{juror_user_id, name,
    note}]``), ``picks_ready`` (bool: has assignments AND every assigned juror
    has a full ≥3 pick-set) and ``gate2_decision`` (latest gate-2 decision or
    None). All bulk reads page via ``_fetch_all``.
    """
    sb = get_admin_client()
    if not pairs:
        return {}
    ids = sorted({p[1] for p in pairs})
    assigns = _fetch_all(lambda: sb.table("jury_assignments").select("*").in_("application_id", ids))

    juror_ids = sorted(
        {a.get("juror_user_id") for a in assigns if a.get("juror_user_id")}
    )
    # Juror-scoped pick read (not app-scoped) so `picks_ready` reflects a
    # juror's FULL 3-set even when the pipeline query is filtered to a subset
    # of apps. `picked_by` still filters to this app below, so it's unaffected.
    sels = _fetch_all(
        lambda: sb.table("jury_selections").select("*").in_("juror_user_id", juror_ids)
    ) if juror_ids else []
    names = {
        p["id"]: (p.get("full_name") or p.get("email") or p["id"])
        for p in (_fetch_all(lambda: sb.table("profiles").select("*").in_("id", juror_ids))
                  if juror_ids else [])
    }

    # Total picks per juror (a juror who submitted their 3-set is "ready" for
    # every app they are assigned to).
    picks_per_juror: dict[str, int] = {}
    for s in sels:
        jid = s.get("juror_user_id")
        if jid:
            picks_per_juror[jid] = picks_per_juror.get(jid, 0) + 1

    decisions = _fetch_all(lambda: sb.table("admin_decisions").select("*").in_("application_id", ids))
    gate2: dict[tuple[str, str], Any] = {}
    for d in sorted(decisions, key=lambda x: x.get("decided_at") or ""):
        if d.get("gate_stage") == "gate2":
            gate2[(d.get("application_track"), d.get("application_id"))] = d.get("decision")

    out: dict[tuple[str, str], dict[str, Any]] = {}
    for track, app_id in pairs:
        a_rows = [a for a in assigns
                  if a.get("application_id") == app_id and a.get("application_track") == track]
        s_rows = [s for s in sels
                  if s.get("application_id") == app_id and s.get("application_track") == track]
        assigned_jids = [a.get("juror_user_id") for a in a_rows]
        out[(track, app_id)] = {
            "jury_assigned": len(a_rows),
            "jury_assigned_names": [names.get(j, j) for j in assigned_jids],
            "picked_by": [
                {"juror_user_id": s.get("juror_user_id"),
                 "name": names.get(s.get("juror_user_id"), s.get("juror_user_id")),
                 "note": s.get("note")}
                for s in s_rows
            ],
            "picks_ready": bool(a_rows) and all(
                picks_per_juror.get(j, 0) >= 3 for j in assigned_jids),
            "gate2_decision": gate2.get((track, app_id)),
        }
    return out


# ─── Task 13: Reviewer-calibration analytics ────────────────────────────


def fetch_calibration() -> dict[str, Any]:
    """Per-reviewer calibration metrics: n_reviews, avg_score, avg_variance_vs_ai.

    Bulk-fetches all reviewers, their submitted reviews, and ai_screening rows
    in three queries (no per-reviewer N+1). Returns:
        {
            "reviewers": [
                {
                    "user_id": str,
                    "name": str,
                    "n_reviews": int,            # submitted reviews only
                    "avg_score": float | None,   # mean weighted_overall (round 2)
                    "avg_variance_vs_ai": float | None,  # mean |weighted − ai| (round 2)
                }
            ]
        }
    """
    sb = get_admin_client()
    reviewer_ids = _reviewer_user_ids()
    if not reviewer_ids:
        return {"reviewers": []}
    id_set = set(reviewer_ids)

    def _fetch(table: str) -> list[dict]:
        try:
            return (sb.table(table).select("*").execute().data) or []
        except Exception as exc:
            log.warning("calibration: fetch failed", extra={"table": table, "err": str(exc)})
            return []

    profiles = {p["id"]: p for p in _fetch("profiles") if p.get("id") in id_set}

    # Submitted reviews grouped per reviewer.
    reviews_by_rev: dict[str, list[dict]] = {rid: [] for rid in reviewer_ids}
    reviewed_keys: set[tuple[str, str]] = set()
    for r in _fetch("reviews"):
        rid = r.get("reviewer_user_id")
        if rid in id_set and r.get("submitted_at"):
            reviews_by_rev[rid].append(r)
            reviewed_keys.add((r.get("application_id"), r.get("application_track")))

    # ai_screening keyed by (application_id, application_track) for apps reviewed.
    ai_by_key: dict[tuple[str, str], dict] = {}
    for row in _fetch("ai_screening"):
        key = (row.get("application_id"), row.get("application_track"))
        if key in reviewed_keys:
            ai_by_key.setdefault(key, row)

    out: list[dict[str, Any]] = []
    for rid in reviewer_ids:
        prof = profiles.get(rid) or {}
        submitted = reviews_by_rev[rid]

        scores: list[float] = []
        variances: list[float] = []
        for r in submitted:
            w = reviewer_query._weighted_overall(r)
            if w is None:
                continue
            scores.append(w)
            ai_row = ai_by_key.get((r.get("application_id"), r.get("application_track")))
            ai_overall = (ai_row or {}).get("score_overall")
            if ai_overall is not None:
                variances.append(abs(w - ai_overall))

        avg_score = round(sum(scores) / len(scores), 2) if scores else None
        avg_variance = round(sum(variances) / len(variances), 2) if variances else None

        out.append({
            "user_id":           rid,
            "name":              prof.get("full_name") or prof.get("email") or rid,
            "n_reviews":         len(submitted),
            "avg_score":         avg_score,
            "avg_variance_vs_ai": avg_variance,
        })

    return {"reviewers": out}


# ─── Task 12: Audit log ─────────────────────────────────────────────────


def fetch_audit(filters: dict[str, Any]) -> list[dict[str, Any]]:
    """Fetch and merge audit_log_v2 + application_status_log into a common shape.

    Common shape per entry: {ts, actor, action, target, detail}

    Filters (applied in Python for fake-friendliness):
        actor   — substring/eq match on actor field
        action  — eq match (also matches status rows where action starts with value)
        from    — ts >= from
        to      — ts <= to
    """
    sb = get_admin_client()

    # Fetch audit_log_v2
    try:
        v2_rows = (sb.table("audit_log_v2").select("*").execute().data) or []
    except Exception as exc:
        log.warning("fetch_audit: audit_log_v2 fetch failed", extra={"err": str(exc)})
        v2_rows = []

    # Fetch application_status_log
    try:
        sl_rows = (sb.table("application_status_log").select("*").execute().data) or []
    except Exception as exc:
        log.warning("fetch_audit: application_status_log fetch failed", extra={"err": str(exc)})
        sl_rows = []

    entries: list[dict[str, Any]] = []

    for row in v2_rows:
        target_table = row.get("target_table") or ""
        target_id = row.get("target_id") or ""
        target = f"{target_table}:{target_id}" if target_id else target_table
        # Summarise detail from after/before/reason
        after = row.get("after")
        before = row.get("before")
        reason = row.get("reason")
        if after:
            detail = str(after)
        elif before:
            detail = str(before)
        elif reason:
            detail = str(reason)
        else:
            detail = ""
        entries.append({
            "ts":     row.get("created_at") or "",
            "actor":  row.get("actor_user_id") or "",
            "action": row.get("action_type") or "",
            "target": target,
            "detail": detail,
        })

    for row in sl_rows:
        from_status = row.get("from_status") or ""
        to_status = row.get("to_status") or ""
        track = row.get("application_track") or ""
        app_id = row.get("application_id") or ""
        entries.append({
            "ts":     row.get("changed_at") or "",
            "actor":  row.get("changed_by") or "",
            "action": f"status:{from_status}->{to_status}",
            "target": f"{track}_applications:{app_id}" if app_id else f"{track}_applications",
            "detail": row.get("reason") or "",
        })

    # Apply filters in Python
    actor_filter = filters.get("actor")
    action_filter = filters.get("action")
    from_filter = filters.get("from")
    to_filter = filters.get("to")

    filtered: list[dict[str, Any]] = []
    for e in entries:
        if actor_filter and actor_filter not in (e["actor"] or ""):
            continue
        if action_filter and not (e["action"] == action_filter or e["action"].startswith(action_filter)):
            continue
        if from_filter and e["ts"] < from_filter:
            continue
        if to_filter and e["ts"] > to_filter:
            continue
        filtered.append(e)

    # Sort newest first
    filtered.sort(key=lambda e: e["ts"], reverse=True)
    return filtered


def fetch_unassigned_apps(track: str | None = None) -> list[dict[str, Any]]:
    """Non-draft applications with NO active reviewer_assignment.

    Used by the rebalance endpoint. `track` restricts to one track; otherwise
    both are considered. Returns ``[{"application_id", "application_track"}]``.
    """
    sb = get_admin_client()
    tracks = [track] if track in stats.TRACKS else list(stats.TRACKS)

    # Active-assignment keys to exclude.
    assigned_keys: set[tuple[str, str]] = set()
    try:
        for a in (sb.table("reviewer_assignments").select("*").execute().data) or []:
            if a.get("declined_at") is None and a.get("reassigned_to") is None:
                assigned_keys.add((a.get("application_id"), a.get("application_track")))
    except Exception as exc:
        log.warning("rebalance: assignments fetch failed", extra={"err": str(exc)})

    out: list[dict[str, Any]] = []
    for t in tracks:
        table = "tir_applications" if t == "tir" else "sip_applications"
        try:
            rows = (sb.table(table).select("id,status").execute().data) or []
        except Exception as exc:
            log.warning("rebalance: app fetch failed",
                        extra={"track": t, "err": str(exc)})
            rows = []
        for r in rows:
            if (r.get("status") or "draft") == "draft":
                continue
            aid = r.get("id")
            if aid is None or (aid, t) in assigned_keys:
                continue
            out.append({"application_id": aid, "application_track": t})
    return out


def bulk_assign_reviewer_apps(
    user_id: str, items: list[dict[str, Any]], assigned_by: str,
) -> dict[str, Any]:
    """Assign many applications to one reviewer. Per-item status:
    created | already_assigned | not_a_reviewer | invalid_track | error.
    Mirrors leadership_actions.assign_reviewers semantics in bulk.
    """
    sb = get_admin_client()
    if user_id not in _reviewer_user_ids():
        return {"results": [
            {"application_id": it.get("application_id"), "track": it.get("track"),
             "status": "not_a_reviewer"} for it in items
        ]}

    existing: set[tuple[str, str]] = set()
    try:
        for a in (sb.table("reviewer_assignments").select("*")
                  .eq("reviewer_user_id", user_id).execute().data) or []:
            if a.get("reviewer_user_id") == user_id:
                existing.add((a.get("application_id"), a.get("application_track")))
    except Exception as exc:
        log.warning("bulk_assign: existing fetch failed", extra={"err": str(exc)})

    now = datetime.now(UTC).isoformat()
    results: list[dict[str, Any]] = []
    for it in items:
        aid = it.get("application_id")
        track = it.get("track")
        if track not in ("tir", "sip"):
            results.append({"application_id": aid, "track": track, "status": "invalid_track"})
            continue
        if (aid, track) in existing:
            results.append({"application_id": aid, "track": track, "status": "already_assigned"})
            continue
        try:
            sb.table("reviewer_assignments").insert({
                "application_id": aid,
                "application_track": track,
                "reviewer_user_id": user_id,
                "assigned_by": assigned_by,
                "assigned_at": now,
                "state": "pending",
                "due_at": None,
            }).execute()
            existing.add((aid, track))
            results.append({"application_id": aid, "track": track, "status": "created"})
        except Exception as exc:
            log.warning("bulk_assign: insert failed",
                        extra={"application_id": aid, "err": str(exc)})
            results.append({"application_id": aid, "track": track, "status": "error"})
    return {"results": results}


_ASSIGNMENT_PAGE = 1000


def iter_assignment_rows(sb: Any, *, reviewer_ids=None, app_ids=None):
    """Yield every ``reviewer_assignments`` row, paginated.

    A plain ``select()`` is capped at ~1000 rows by PostgREST, so once the table
    grew past that the dedup snapshots in the batch/reviewer assign paths silently
    missed existing rows and re-inserted duplicates → unique-violation 500s. This
    pages through ``.range()`` so callers see the WHOLE table. Optionally narrows
    to specific reviewers (keeps the scan small; the URL stays short because the
    caller passes ≤50 reviewer ids).
    """
    offset = 0
    while True:
        q = sb.table("reviewer_assignments").select(
            "application_id,application_track,reviewer_user_id,declined_at,reassigned_to"
        )
        if reviewer_ids:
            q = q.in_("reviewer_user_id", list(reviewer_ids))
        if app_ids:
            q = q.in_("application_id", list(app_ids))
        page = (q.range(offset, offset + _ASSIGNMENT_PAGE - 1).execute().data) or []
        yield from page
        if len(page) < _ASSIGNMENT_PAGE:
            break
        offset += _ASSIGNMENT_PAGE


def assign_reviewers_to_batch(
    sb: Any,
    batch_id: str,
    reviewer_user_ids: list[str],
    *,
    assigned_by: str,
) -> dict[str, Any]:
    """Create one reviewer_assignment per (app in batch × reviewer), skipping any
    ``(application_id, application_track, reviewer_user_id)`` triple that already
    exists.

    Pure data operation: it does NOT send the reviewer-assigned email and does
    NOT write an audit row — the caller owns those side effects. This is shared
    by the admin batch-assign endpoint (which emails + audits) and the
    reviewer-invite flow (which suppresses the assignment email, since the
    invite credentials email already went out).

    Returns ``{"created", "reviewers", "applications", "created_rows"}`` so the
    caller can decide whether to notify on the newly-created rows.
    """
    # Apps in this batch. `.eq()` narrows on real PostgREST; the fake test client
    # no-ops `.eq()` for non-PK selects, so re-filter in Python on batch_id.
    link_rows = (
        sb.table("application_batches")
        .select("application_id,application_track,batch_id")
        .eq("batch_id", batch_id)
        .execute()
        .data
    ) or []
    apps = [
        (r["application_id"], r["application_track"])
        for r in link_rows
        if r.get("batch_id") == batch_id and r.get("application_id") and r.get("application_track")
    ]

    reviewer_ids = list(dict.fromkeys(reviewer_user_ids))  # dedupe, keep order

    # Record explicit batch<->reviewer membership (batch_reviewers, migration
    # 034) — the source of truth for the multi-batch fan-out. Idempotent.
    if reviewer_ids:
        _now_iso = datetime.now(UTC).isoformat()
        sb.table("batch_reviewers").upsert(
            [
                {
                    "batch_id": batch_id,
                    "reviewer_user_id": rid,
                    "added_by": assigned_by,
                    "added_at": _now_iso,
                }
                for rid in reviewer_ids
            ],
            on_conflict="batch_id,reviewer_user_id",
            ignore_duplicates=True,
        ).execute()

    # Existing assignments for these reviewers, read COMPLETELY (paginated).
    # A plain select('*') is capped at ~1000 rows by PostgREST; once the table
    # grew past the cap this snapshot missed existing triples and the insert
    # below re-created them → duplicate-key 500. Narrowing to reviewer_ids keeps
    # the scan small.
    app_keys = set(apps)
    reviewer_id_set = set(reviewer_ids)
    existing_pairs: set[tuple[str, str, str]] = set()
    for a in iter_assignment_rows(sb, reviewer_ids=reviewer_ids):
        key = (a.get("application_id"), a.get("application_track"))
        rid = a.get("reviewer_user_id")
        if key in app_keys and rid in reviewer_id_set:
            existing_pairs.add((a.get("application_id"), a.get("application_track"), rid))

    now = datetime.now(UTC).isoformat()
    rows = [
        {
            "application_id": aid,
            "application_track": track,
            "reviewer_user_id": rid,
            "assigned_by": assigned_by,
            "assigned_at": now,
            "state": "pending",
            "due_at": None,
        }
        for (aid, track) in apps
        for rid in reviewer_ids
        if (aid, track, rid) not in existing_pairs
    ]
    if rows:
        # Idempotent insert: ON CONFLICT DO NOTHING so a race (or any residual
        # dedup gap) can never raise a duplicate-key 500.
        sb.table("reviewer_assignments").upsert(
            rows,
            on_conflict="application_id,application_track,reviewer_user_id",
            ignore_duplicates=True,
        ).execute()

    from app.services import state_machine  # local import to avoid cycles
    for aid, atrack in {(r["application_id"], r["application_track"]) for r in rows}:
        state_machine.advance_to_under_review_on_assignment(aid, atrack)

    return {
        "created": len(rows),
        "reviewers": len(reviewer_ids),
        "applications": len(apps),
        "created_rows": rows,
    }


def bulk_remove_reviewer_apps(
    user_id: str, items: list[dict[str, Any]],
) -> dict[str, Any]:
    """Unassign many applications from one reviewer. Per-item status:
    removed | skipped_submitted | not_found | error.

    The assignment is ALWAYS deleted (even if the reviewer submitted a review).
    ``skipped_submitted`` is returned when a submitted review exists so the
    frontend can warn the user; the deletion still happens. The review row is
    preserved for audit purposes — only the reviewer_assignment is deleted.
    """
    sb = get_admin_client()

    # Pre-fetch submitted reviews for this reviewer so we can report per-item
    # whether a review existed (without blocking the deletion).
    submitted_pairs: set[tuple[str, str]] = set()
    try:
        for rv in (
            sb.table("reviews")
            .select("application_id,application_track,submitted_at")
            .eq("reviewer_user_id", user_id)
            .execute()
            .data
        ) or []:
            if rv.get("submitted_at"):
                submitted_pairs.add((rv.get("application_track"), rv.get("application_id")))
    except Exception as exc:
        log.warning("bulk_remove: reviews pre-fetch failed", extra={"err": str(exc)})

    results: list[dict[str, Any]] = []
    for it in items:
        aid = it.get("application_id")
        track = it.get("track")
        had_submitted = (track, aid) in submitted_pairs
        try:
            res = (sb.table("reviewer_assignments").delete()
                   .eq("application_id", aid)
                   .eq("application_track", track)
                   .eq("reviewer_user_id", user_id)
                   .execute())
            removed = bool(res.data)
            if not removed:
                status = "not_found"
            elif had_submitted:
                status = "skipped_submitted"
            else:
                status = "removed"
            results.append({"application_id": aid, "track": track, "status": status})
        except Exception as exc:
            log.warning("bulk_remove: delete failed",
                        extra={"application_id": aid, "err": str(exc)})
            results.append({"application_id": aid, "track": track, "status": "error"})
    return {"results": results}
