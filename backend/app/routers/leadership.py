"""Leadership dashboard router (Task 16).

Single bundled endpoint:

    GET /leadership/stats   one round-trip → totals, funnel, status counts,
                            industry breakdown.

Why one endpoint instead of six (totals / funnel / status / industry / …):
the dashboard renders all of these on a single screen, and the row counts
are tiny (a few hundred apps at most through Phase 1). Bundling them keeps
the frontend simpler (one fetch, one loading state) and is well under the
Lambda warm-call budget — every helper is a count(*) or single-column
projection, no row scans.

Guarded by `require_capability("view_stats")` — granted to the `leadership`
role only (see `rbac.ROLE_CAPABILITIES`). Admins handle user provisioning,
not dashboard analytics; if an admin needs the dashboard, grant them the
`leadership` role as well.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from ..rbac import require_capability
from ..services import admin_query, applications_query, industry_categories, stats, vip_memo, vip_memo_export
from ..services.founder_check.render import merge_sections as _merge_founder_sections
from ..supabase_client import get_admin_client

log = logging.getLogger(__name__)

router = APIRouter(prefix="/leadership", tags=["leadership"])


@router.get(
    "/stats",
    dependencies=[Depends(require_capability("view_stats"))],
)
async def get_stats() -> dict:
    """Bundled leadership-dashboard stats.

    One projection of every application row (id/status/moved_to_track) feeds
    the status counts, totals, funnel and the gate-aware `pipeline_breakdown`,
    so every number on the dashboard is derived from the same set and sums to
    the same non-draft total. Status counts are RAW (no decision overlay) and
    bucketed by EFFECTIVE track.
    """
    apps = stats.fetch_app_status_rows()
    non_draft = [a for a in apps if a.get("status") and a.get("status") != "draft"]

    # ─── Status counts (per status × effective track) ─────────────────
    per_status_per_track: dict[str, dict[str, int]] = {}
    for a in non_draft:
        eff = a.get("moved_to_track") or a["track"]
        bucket = per_status_per_track.setdefault(a["status"], {})
        bucket[eff] = bucket.get(eff, 0) + 1
    per_status_total = {s: sum(v.values()) for s, v in per_status_per_track.items()}

    status_counts = [
        {"id": status_id, "label": label, "n": per_status_total.get(status_id, 0)}
        for status_id, label in stats.PHASE_1_STATUSES
    ]

    # Same numbers split by track (consumed by the admin tab badges).
    status_counts_by_track = [
        {"id": status_id, "label": label,
         **{track: per_status_per_track.get(status_id, {}).get(track, 0)
            for track in stats.TRACKS}}
        for status_id, label in stats.PHASE_1_STATUSES
    ]

    # ─── Gate-aware breakdown (contract C1) ──────────────────────────
    pipeline = stats.build_pipeline_breakdown(
        non_draft, stats.fetch_decision_rows(), stats.fetch_ic_rows(),
    )
    stages = pipeline["stages"]

    # ─── Totals card ──────────────────────────────────────────────────
    profiles_signed_up = stats.count_profiles()
    tir_count = pipeline["by_track"]["tir"]["total"]
    sip_count = pipeline["by_track"]["sip"]["total"]
    apps_submitted = pipeline["total"]
    drafted = len(apps) - len(non_draft)
    # Distinct applicants who started anything (draft or submitted) — the
    # funnel's narrowing "started" stage; `drafted` counts rows, and one user
    # can hold a TIR and a VIP draft.
    started = len({a.get("user_id") or (a["track"], a["id"]) for a in apps})

    # AI mean — one projection query, one Python mean. Returns None if no
    # screening rows exist yet so the frontend can render "–" instead of 0.
    scores = stats.fetch_ai_score_overalls()
    avg_ai_score: float | None = (sum(scores) / len(scores)) if scores else None
    ai_components = stats.fetch_ai_component_stats(
        {(a["track"], a["id"]) for a in non_draft}
    )

    totals = {
        "profiles_signed_up":   profiles_signed_up,
        "apps_submitted":       apps_submitted,
        "tir_count":            tir_count,
        "sip_count":            sip_count,
        "advanced_past_review": pipeline["gate1_selected"],
        "onboarded":            stages["onboarded"],
        "avg_ai_score":         avg_ai_score,
    }

    # ─── Funnel ───────────────────────────────────────────────────────
    #   in_review — apps currently under review (status under_review)
    #   advanced  — passed the 1st gate (pipeline gate1_selected)
    #   decided   — final selected + offered + onboarded
    funnel = {
        "profiles":  profiles_signed_up,
        "started":   started,
        "drafted":   drafted,
        "submitted": apps_submitted,
        "in_review": stages["under_review"],
        "advanced":  pipeline["gate1_selected"],
        "decided":   stages["final_selected"] + stages["offered"] + stages["onboarded"],
    }

    # Industry breakdown moved to GET /leadership/industry-categories so the
    # dashboard tab and the Applications tab share a single source (the
    # LLM-classified ai_screening.industry_category_id) instead of running
    # the keyword classifier here.
    return {
        "totals":            totals,
        "funnel":            funnel,
        "status_counts":     status_counts,
        "status_counts_by_track": status_counts_by_track,
        "pipeline_breakdown": pipeline,
        # Full list of AI overall scores (0–10) across all screened apps so
        # the dashboard can render the score-distribution histogram from the
        # complete set, not a capped page of the applications list.
        "ai_score_overalls": scores,
        **ai_components,
    }


# ─── Applications list (Task 18) ────────────────────────────────────────


def _submitted_at_sort_key(row: dict[str, Any]) -> tuple[int, str]:
    """Sort helper: submitted_at desc, NULLs last.

    Returns `(1, iso_string)` for populated submissions and `(0, "")` for
    NULLs so a plain `reverse=True` pushes NULLs to the bottom. We compare
    ISO-8601 strings directly — they're lexicographically sortable when
    they share the same zone-offset (Supabase returns Zulu).
    """
    s = row.get("submitted_at")
    if not s:
        return (0, "")
    return (1, s)


# Display-ID prefixes leadership pastes into search ("TIR-26013", "VIP-26701").
_DISPLAY_PREFIX_RE = re.compile(r"^(?:tir|vip|sip)\s*-\s*", re.IGNORECASE)
# Characters that are structural inside PostgREST's or=(...) filter. Each is
# swapped for `_` (ilike's single-char wildcard), so "Acme, Inc" still matches
# itself without splitting the or() into a bogus extra clause.
_SEARCH_UNSAFE_RE = re.compile(r'[,()"\\]')


def _normalize_search(search: str | None) -> str | None:
    """Trim, drop a TIR-/VIP-/SIP- display-ID prefix, and neutralise or()
    syntax characters. Returns None for an empty search."""
    if search is None:
        return None
    s = _DISPLAY_PREFIX_RE.sub("", search.strip())
    s = _SEARCH_UNSAFE_RE.sub("_", s).strip()
    return s or None


# Pipeline-stage status filters (contract C1 stage keys) → the raw status the
# DB pre-filter can use; the stage itself is resolved per row.
_STAGE_FILTERS: dict[str, str] = {
    "reviewed":       "evaluated",
    "gate1_rejected": "rejected",
    "final_rejected": "rejected",
    "final_pending":  "jury_review",
    "final_selected": "jury_review",
}

_RECO_RANK = {"yes": 3, "maybe": 2, "no": 1}
_STATUS_RANK = {s: i for i, (s, _label) in enumerate(stats.PHASE_1_STATUSES)}


def _latest_overall(decision_rows: list[dict]) -> dict[tuple[str, str], dict]:
    """Latest admin_decisions row per (native track, id), across gates."""
    out: dict[tuple[str, str], dict] = {}
    for row in decision_rows:
        key = (row.get("application_track"), row.get("application_id"))
        cur = out.get(key)
        if cur is None or (row.get("decided_at") or "") >= (cur.get("decided_at") or ""):
            out[key] = row
    return out


def _lower(v: Any) -> str | None:
    return v.strip().casefold() if isinstance(v, str) and v.strip() else None


@router.get(
    "/applications",
    dependencies=[Depends(require_capability("view_all_apps"))],
)
async def list_applications(
    track: str | None = Query(default=None, pattern="^(tir|sip)$"),
    status_: str | None = Query(default=None, alias="status"),
    industry: str | None = Query(default=None),
    ai_score_min: float | None = Query(default=None),
    ai_score_max: float | None = Query(default=None),
    ai_score_bucket: int | None = Query(default=None, ge=0, le=9),
    search: str | None = Query(default=None),
    recommendation: str | None = Query(default=None, pattern="^(yes|maybe|no|none|single)$"),
    sort: str | None = Query(
        default=None,
        pattern="^(id|project|founder|ai_score|status|submitted_at|industry|reco|stage|reviewer_score|reviewers)$",
    ),
    order: str = Query(default="asc", pattern="^(asc|desc)$"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    """Cross-track paginated list with filters (spec §5.2).

    Filter strategy:
      - status / track / search → pushed to PostgREST per-track
      - status may also be a pipeline-stage key (reviewed, gate1_rejected,
        final_rejected, final_pending, final_selected) — same rules as
        /leadership/stats pipeline_breakdown
      - industry → ai_screening.industry_category_id; "unclassified" = none
      - ai_score_min/max → joined per-row from ai_screening, then filtered
      - ai_score_bucket → integer 0..9, matches the dashboard histogram's
        floor()-bucketing exactly (bucket i = [i, i+1), bucket 9 = [9, 10]).
        Lets the histogram click-through filter the list with semantics
        that line up with the bar the user clicked.
      - sort/order → applied to the whole filtered set BEFORE pagination,
        nulls last in both directions (default: submitted_at desc).

    Phase 1 scale (~hundreds of apps) means a Python-side filter pass on a
    capped-fetch is simpler than a two-step PostgREST join. See FETCH_CAP
    in applications_query.py for the comment on when to revisit.
    """
    search = _normalize_search(search)
    if status_ in {"accepted", "rejected"}:
        db_status = None
    else:
        db_status = _STAGE_FILTERS.get(status_, status_)
    tracks_to_query = [track] if track else list(stats.TRACKS)
    rows: list[dict[str, Any]] = []
    for t in tracks_to_query:
        rows.extend(
            applications_query.fetch_apps_for_track(
                t,
                status=db_status,
                search=search,
                limit=applications_query.FETCH_CAP,
            )
        )

    # ─ 2. Industry source: LLM-classified ai_screening.industry_category_id ─
    # Replaces the old keyword classifier. Apps without an ai_screening row
    # (or whose industry_category_id is NULL) map to None → frontend "—",
    # and are what industry=unclassified selects.
    pairs_for_industry = [(r["track"], r["id"]) for r in rows]
    industries = applications_query.fetch_industry_for_pairs(pairs_for_industry)

    if industry:
        rows = [
            r
            for r in rows
            if (
                industries.get((r["track"], r["id"])) is None
                if industry == "unclassified"
                else (industries.get((r["track"], r["id"])) or {}).get("id") == industry
            )
        ]

    # Gate decisions + IC signing state → effective status and pipeline stage.
    decision_rows = stats.fetch_decision_rows()
    decisions = _latest_overall(decision_rows)
    by_gate = stats.latest_decisions_by_gate(decision_rows)
    signed = stats.ic_all_signed_keys(stats.fetch_ic_rows())
    stage_of = {(r["track"], r["id"]): stats.stage_for_app(r, by_gate, signed) for r in rows}

    if status_ in {"accepted", "rejected"}:
        wanted = status_
        rows = [
            r for r in rows
            if stats.effective_status(
                r.get("status"),
                decisions.get((r["track"], r["id"])),
            ) == wanted
        ]
    elif status_ in _STAGE_FILTERS:
        rows = [r for r in rows if stage_of.get((r["track"], r["id"])) == status_]
    pairs = [(r["track"], r["id"]) for r in rows]
    scores = applications_query.fetch_ai_scores_for(pairs)
    project_names = applications_query.fetch_project_names_for(pairs)
    review_stats = admin_query._fetch_review_stats(pairs)

    filter_ai = (
        ai_score_min is not None
        or ai_score_max is not None
        or ai_score_bucket is not None
    )
    if filter_ai:
        kept: list[dict[str, Any]] = []
        for r in rows:
            s = scores.get((r["track"], r["id"]))
            if s is None:
                # Apps with no AI screening can't match a numeric range.
                continue
            if ai_score_min is not None and s < ai_score_min:
                continue
            if ai_score_max is not None and s > ai_score_max:
                continue
            if ai_score_bucket is not None:
                # Mirror the frontend's Math.floor((s/10)*10) bucketing —
                # clamp 10.0 into bucket 9 so the top bar's click-through
                # finds perfect scores.
                bucket = int(s) if s < 10 else 9
                if bucket != ai_score_bucket:
                    continue
            kept.append(r)
        rows = kept

    # ─ 3b. Recommendation filter (aggregate verdict == `recommendation`).
    #      Below the 2-review threshold the verdict is None ("—"), split by
    #      review_count: "none" = 0 reviews, "single" = exactly 1 (LEAD-17).
    if recommendation:
        def _reco_bucket(r: dict[str, Any]) -> str:
            rs = review_stats.get((r["track"], r["id"])) or {}
            verdict = admin_query.reco_verdict(rs.get("reco"))
            if verdict:
                return verdict
            return "single" if rs.get("review_count", 0) == 1 else "none"

        rows = [r for r in rows if _reco_bucket(r) == recommendation]

    # ─ 4. Total = post-filter, pre-pagination count ─────────────────────
    total = len(rows)

    def _project_name(r: dict[str, Any]) -> str | None:
        # Same name the drawer shows (ai_screening.project_name first) for
        # both tracks; VIP rows fall back to org / founder name.
        name = project_names.get((r["track"], r["id"])) or stats.derive_project_name(r)
        if r["track"] == "sip":
            name = name or r.get("basic_org") or r.get("basic_full_name")
        return name

    def _status(r: dict[str, Any]) -> str | None:
        return stats.effective_status(r.get("status"), decisions.get((r["track"], r["id"])))

    # ─ 5. Sort (whole filtered set, nulls last) → paginate → shape ─────
    if sort is None:
        rows.sort(key=_submitted_at_sort_key, reverse=True)
    else:
        def _sort_value(r: dict[str, Any]) -> Any:
            key = (r["track"], r["id"])
            if sort == "id":
                seq = r.get("display_seq")
                return int(seq) if isinstance(seq, (int, str)) and str(seq).isdigit() else None
            if sort == "project":
                return _lower(_project_name(r))
            if sort == "founder":
                return _lower(r.get("basic_full_name"))
            if sort == "ai_score":
                return scores.get(key)
            if sort == "status":
                return _STATUS_RANK.get(_status(r))
            if sort == "industry":
                return _lower((industries.get(key) or {}).get("label"))
            if sort == "reco":
                return _RECO_RANK.get(
                    admin_query.reco_verdict((review_stats.get(key) or {}).get("reco")))
            if sort == "stage":
                return _lower((stats.derive_stage_label(r) or {}).get("label"))
            if sort == "reviewer_score":
                return (review_stats.get(key) or {}).get("score")
            if sort == "reviewers":
                rs = review_stats.get(key)
                return (rs.get("submitted", 0), rs.get("assigned", 0)) if rs else None
            return r.get("submitted_at") or None

        valued = [(_sort_value(r), r) for r in rows]
        present = [vr for vr in valued if vr[0] is not None]
        present.sort(key=lambda vr: vr[0], reverse=(order == "desc"))
        rows = [r for _v, r in present] + [r for v, r in valued if v is None]
    page = rows[offset : offset + limit]

    applications = []
    for r in page:
        # `track` is the NATIVE track — used for every child-table lookup
        # (ai_screening/reviews/industry are keyed by native application_track)
        # and for content-derived fields. `eff` is the effective/display track
        # under the track-move overlay (moved_to_track wins), used only for the
        # track label the portal shows (display_id stays native).
        track = r["track"]
        eff = applications_query.effective_track(r)
        rs = review_stats.get((track, r["id"])) or {}
        applications.append({
            "id":               r["id"],
            "display_seq":      r.get("display_seq"),
            # NATIVE prefix + native seq (an effective prefix collides with
            # the other track's real ID); moved apps get a marker client-side.
            "display_id":       stats.compose_display_id(track, r.get("display_seq")),
            "track":            eff,
            "native_track":     track,
            "moved_to_track":   r.get("moved_to_track"),
            "status":           _status(r),
            # Gate-aware stage (same rules as /stats pipeline_breakdown) and
            # the latest decision per gate.
            "pipeline_stage":   stage_of.get((track, r["id"])),
            "gate1_decision":   by_gate.get((track, r["id"], "gate1")),
            "gate2_decision":   by_gate.get((track, r["id"], "gate2")),
            "project_name":     _project_name(r),
            "founder": {
                "name":         r.get("basic_full_name"),
                "affiliation":  r.get("basic_org"),
            },
            "industry":         industries.get((track, r["id"])),
            "stage":            stats.derive_stage_label(r),
            "ai_score_overall": scores.get((track, r["id"])),
            "reviewer_score":   rs.get("score"),
            "reviewers":        {
                                    "submitted": rs.get("submitted", 0),
                                    "assigned":  rs.get("assigned", 0),
                                } if rs else None,
            # Reviews counted by reco_verdict, so a "—" reco can read "no
            # reviews" vs "1 review (needs 2)" — same field as the admin row.
            "review_count":     rs.get("review_count", 0),
            "reco":             rs.get("reco"),
            "submitted_at":     r.get("submitted_at"),
            "created_at":       r.get("created_at"),
            # Legacy fields the AppDrawer + existing tests still reference.
            "basic_full_name":  r.get("basic_full_name"),
            "basic_email":      r.get("basic_email"),
            "basic_org":        r.get("basic_org"),
        })

    return {
        "applications": applications,
        "total":        total,
        "limit":        limit,
        "offset":       offset,
    }


# ─── Application detail (Task 18) ───────────────────────────────────────


def _with_actor_names(history: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Attach ``changed_by_name`` (profiles.full_name, else email) to each
    status-log row so History shows a person, not a uuid. Best-effort: a
    lookup failure leaves the name None."""
    ids = sorted({h["changed_by"] for h in history if h.get("changed_by")})
    names: dict[str, str] = {}
    if ids:
        try:
            rows = (get_admin_client().table("profiles").select("id,full_name,email")
                    .in_("id", ids).execute().data) or []
            names = {r["id"]: r.get("full_name") or r.get("email") for r in rows if r.get("id")}
        except Exception as exc:
            log.warning("leadership: status-history actor lookup failed", extra={"err": str(exc)})
    for h in history:
        h["changed_by_name"] = names.get(h.get("changed_by")) if h.get("changed_by") else None
    return history


@router.get(
    "/applications/{application_id}",
    dependencies=[Depends(require_capability("view_app_detail"))],
)
async def get_application_detail(application_id: str) -> dict[str, Any]:
    """Single-app full detail across both tracks (spec §5.2).

    Track is inferred — the URL doesn't carry it because applicants don't
    type tracks. We probe `tir_applications` first, then `sip_applications`,
    and 404 if neither has the id. Each sub-fetch (ai_screening, reviews,
    reviewer_assignments, status_history) is independently failure-tolerant
    so a transient on one table degrades that key to `null`/`[]` rather than
    500ing the whole call.
    """
    found = applications_query.find_application_with_track(application_id)
    if found is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "application_not_found"},
        )
    track, app_row = found

    ai_screening = applications_query.fetch_ai_screening_for(application_id, track)
    reviews = applications_query.fetch_reviews_for(application_id, track)
    reviewer_assignments = applications_query.fetch_reviewer_assignments_for(
        application_id, track,
    )
    # Attach reviewer display names + a timestamp-derived status (not the
    # vestigial `state` column) so the AppDrawer / review-page Reviewers panel
    # show "Manish S Shetty · Evaluated" instead of "6fd9bcf5 · pending".
    # Reviewers whose assignment row was deleted after they submitted still
    # count as assigned (detached) — the list's rule (_fetch_review_stats).
    reviewer_assignments = applications_query.with_detached_reviewers(
        reviewer_assignments, reviews,
    )
    reviewer_assignments, reviews = applications_query.enrich_reviewers(
        reviewer_assignments, reviews,
    )
    status_history = _with_actor_names(applications_query.fetch_status_history_for(
        application_id, track,
    ))

    # Compute derived fields so the AppDrawer can render the new header
    # without re-implementing the helpers in the frontend.
    app_row_with_track = {**app_row, "track": track}
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

    if ai_screening is not None:
        ai_screening = {
            **ai_screening,
            "sections": _merge_founder_sections(
                ai_screening.get("sections"), ai_screening.get("founder_check")),
        }

    # `track` is native (drives the child fetches above); `eff` is the display
    # track under the track-move overlay.
    eff = applications_query.effective_track(app_row_with_track)
    return {
        "id":                   application_id,
        "track":                eff,
        "native_track":         track,
        "moved_to_track":       app_row.get("moved_to_track"),
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
    }

@router.post(
    "/applications/{application_id}/vip-memo",
    dependencies=[Depends(require_capability("view_app_detail"))],
)
async def generate_vip_memo(application_id: str) -> dict[str, Any]:
    """Generate the pilot memo for a VIP application."""
    if application_id not in vip_memo.PILOT_APPLICATION_IDS:
        raise HTTPException(status_code=404, detail={"code": "vip_memo_pilot_only"})
    payload = await get_application_detail(application_id)
    if payload.get("track") != "sip":
        raise HTTPException(status_code=404, detail={"code": "vip_memo_requires_sip"})
    memo = vip_memo.generate_memo(
        {**(payload.get("application") or {}), "id": application_id, "track": "sip"},
        payload.get("ai_screening"),
        payload.get("reviews") or [],
    )
    return {"application_id": application_id, "track": "sip", "memo": memo}

@router.post(
    "/applications/{application_id}/vip-memo/download",
    dependencies=[Depends(require_capability("view_app_detail"))],
)
async def download_vip_memo(
    application_id: str,
    format: str = Query("pdf", pattern="^(pdf|docx)$"),
) -> Response:
    result = await generate_vip_memo(application_id)
    memo = result["memo"]
    if format == "docx":
        body = vip_memo_export.render_docx(memo)
        return Response(body, media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                        headers={"Content-Disposition": f'attachment; filename="vip-memo-{application_id}.docx"'})
    body = vip_memo_export.render_pdf(memo)
    return Response(body, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="vip-memo-{application_id}.pdf"'})


# ─── Attachment signed-download URL (Phase 1.5) ─────────────────────────

# Short-lived so a leaked URL is useless within a couple of minutes; long
# enough that a click reliably resolves to a started download.
_SIGNED_URL_TTL_SECONDS = 120


@router.get(
    "/applications/{application_id}/files/signed-url",
    dependencies=[Depends(require_capability("view_app_detail"))],
)
async def get_application_file_signed_url(
    application_id: str,
    storage_path: str = Query(..., min_length=1),
) -> dict[str, Any]:
    """Return a short-lived signed download URL for one of an app's files.

    Security model (defence in depth):
      - Gated by the SAME capability as the application-detail read
        (`view_app_detail`), so only leadership/admin reach the handler.
      - We never sign an arbitrary path. We resolve the application, rebuild
        the allow-list of paths that genuinely belong to it (walking its
        file-bearing JSONB fields), and only sign if the requested path is in
        that set. The bucket is taken from the field the path came from — not
        from the path string — mirroring the upload routers' convention.
      - A path containing ``..`` is rejected outright (traversal guard).
      - Unknown / non-matching path → 404 (same shape as a missing app), so a
        probe can't distinguish "no such app" from "path not on this app".
    """
    if ".." in storage_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "invalid_storage_path"},
        )

    found = applications_query.find_application_with_track(application_id)
    if found is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "application_not_found"},
        )
    track, app_row = found

    allowed = applications_query.collect_application_file_paths(track, app_row)
    resume_file = applications_query.resolve_resume_file(track, app_row)
    if resume_file:
        allowed[resume_file["storage_path"]] = resume_file["bucket"]
    bucket = allowed.get(storage_path)
    if bucket is None:
        # Path isn't referenced by this application — refuse to sign it.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "file_not_found"},
        )

    try:
        signed = (
            get_admin_client()
            .storage.from_(bucket)
            .create_signed_url(storage_path, _SIGNED_URL_TTL_SECONDS)
        )
    except Exception as exc:
        # The file is referenced by the application but the object isn't in the
        # bucket (e.g. seeded rows whose uploads never happened) — Supabase
        # answers "Object not found". Surface that as a clean 404 so the UI can
        # say "file not available" instead of a generic gateway error.
        msg = str(exc).lower()
        if "not_found" in msg or "not found" in msg:
            log.info(
                "leadership signed-url: object missing in storage",
                extra={"application_id": application_id, "track": track, "bucket": bucket},
            )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "file_not_available"},
            ) from exc
        log.warning(
            "leadership signed-url generation failed",
            extra={
                "application_id": application_id,
                "track": track,
                "bucket": bucket,
                "err": str(exc),
            },
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": "signed_url_failed"},
        ) from exc

    # supabase-py returns {"signedURL": "..."} (older builds) or
    # {"signedUrl": "..."} — accept either, plus a top-level "url".
    url = None
    if isinstance(signed, dict):
        url = signed.get("signedURL") or signed.get("signedUrl") or signed.get("url")
    if not url:
        log.warning(
            "leadership signed-url returned no URL",
            extra={"application_id": application_id, "bucket": bucket},
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": "signed_url_failed"},
        )

    return {"url": url, "expires_in": _SIGNED_URL_TTL_SECONDS}


# ─── Industry categories endpoint ──────────────────────────────────────


@router.get(
    "/industry-categories",
    dependencies=[Depends(require_capability("view_stats"))],
)
async def get_industry_categories(
    track: str | None = Query(default=None, pattern="^(tir|sip)$"),
) -> dict[str, Any]:
    """Filter-pill + dashboard-tab data source for industry classification.

    Returns categories with counts (sorted desc by count, then is_seed
    desc as tiebreak; empty categories hidden), the 12-cap, and how many
    slots remain. The frontend reads this to render the filter pills and
    the dashboard tab's industry bar chart.

    `unclassified` counts non-draft apps with no industry (no ai_screening
    row or a NULL category) so the bars sum to `apps_total`; it is selected
    in the list with industry=unclassified.

    `track` (effective track) recounts every category over that track's
    non-draft apps — the same rows and industry lookup the list's
    track + industry filters use — so the Applications chips match the list.
    """
    out = industry_categories.categories_with_counts()
    if track:
        rows = applications_query.fetch_apps_for_track(
            track, limit=applications_query.FETCH_CAP)
        inds = applications_query.fetch_industry_for_pairs(
            [(r["track"], r["id"]) for r in rows])
        counts: dict[str, int] = {}
        for ind in inds.values():
            if ind and ind.get("id"):
                counts[ind["id"]] = counts.get(ind["id"], 0) + 1
        out["categories"] = [
            {**c, "count": counts.get(c["id"], 0)} for c in out.get("categories") or []
        ]
        out["total"] = sum(c["count"] for c in out["categories"])
        apps_total = len(rows)
    else:
        apps_total = sum(stats.count_apps_total(t) for t in stats.TRACKS)
    out["apps_total"] = apps_total
    out["unclassified"] = {
        "id": "unclassified",
        "label": "Unclassified",
        "count": max(0, apps_total - int(out.get("total") or 0)),
    }
    return out
