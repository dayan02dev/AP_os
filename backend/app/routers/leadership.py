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
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..rbac import require_capability
from ..services import applications_query, industry_categories, stats
from ..supabase_client import get_admin_client

log = logging.getLogger(__name__)

router = APIRouter(prefix="/leadership", tags=["leadership"])


@router.get(
    "/stats",
    dependencies=[Depends(require_capability("view_stats"))],
)
async def get_stats() -> dict:
    """Bundled leadership-dashboard stats.

    All aggregation happens at the DB (count(*) per status × track, plus a
    single column projection on `ai_screening.score_overall` for the mean).
    The only Python iteration is keyword classification of `basic_org` into
    industry buckets — that's string derivation, not stats math.
    """
    # ─── Status counts (per status × track, summed across tracks) ─────
    # Two count queries per status (one per track), summed in Python. That's
    # not "iterating rows", it's summing two integers per status cell.
    per_status_total: dict[str, int] = {}
    per_status_per_track: dict[str, dict[str, int]] = {}
    for status_id, _label in stats.PHASE_1_STATUSES:
        per_track = {
            track: stats.count_apps_by_status(track, status_id)
            for track in stats.TRACKS
        }
        per_status_per_track[status_id] = per_track
        per_status_total[status_id] = sum(per_track.values())

    status_counts = [
        {"id": status_id, "label": label, "n": per_status_total[status_id]}
        for status_id, label in stats.PHASE_1_STATUSES
    ]

    # ─── Totals card ──────────────────────────────────────────────────
    profiles_signed_up = stats.count_profiles()
    tir_count = stats.count_apps_total("tir")
    sip_count = stats.count_apps_total("sip")
    apps_submitted = tir_count + sip_count

    # Draft apps (started but not submitted) — feeds the funnel's "drafted"
    # stage. count_apps_total above counts non-draft, so we query draft
    # separately per track.
    drafted = sum(
        stats.count_apps_by_status(track, "draft") for track in stats.TRACKS
    )

    # Apps that have been AI-screened (have an ai_screening row), regardless
    # of whether their status was advanced past `submitted`. Drives the
    # funnel's "in review" stage off real data.
    screened = stats.count_ai_screening_rows()

    advanced_past_review = sum(
        per_status_total[s] for s in stats.ADVANCED_PAST_REVIEW
    )
    onboarded = per_status_total.get("onboarded", 0)

    # AI mean — one projection query, one Python mean. Returns None if no
    # screening rows exist yet so the frontend can render "–" instead of 0.
    scores = stats.fetch_ai_score_overalls()
    avg_ai_score: float | None = (sum(scores) / len(scores)) if scores else None

    totals = {
        "profiles_signed_up":   profiles_signed_up,
        "apps_submitted":       apps_submitted,
        "tir_count":            tir_count,
        "sip_count":            sip_count,
        "advanced_past_review": advanced_past_review,
        "onboarded":            onboarded,
        "avg_ai_score":         avg_ai_score,
    }

    # ─── Funnel ───────────────────────────────────────────────────────
    # Six-stage pipeline reach, all from real Supabase counts:
    #   profiles  — everyone signed up
    #   drafted   — apps still in `draft` (started, not submitted)
    #   submitted — non-draft apps (reached submit)
    #   in_review — apps with an ai_screening row (reached AI review). Uses
    #               the row count rather than status so it stays correct even
    #               when the screener wrote scores without advancing status.
    #   advanced  — shortlisted + interview (by status)
    #   decided   — offered + onboarded (by status)
    status_bucket = {
        bucket: sum(per_status_total.get(s, 0) for s in statuses)
        for bucket, statuses in stats.FUNNEL_BUCKETS.items()
    }
    funnel = {
        "profiles":  profiles_signed_up,
        "drafted":   drafted,
        "submitted": apps_submitted,
        "in_review": max(screened, status_bucket.get("in_review", 0)),
        "advanced":  status_bucket.get("advanced", 0),
        "decided":   status_bucket.get("decided", 0),
    }

    # Industry breakdown moved to GET /leadership/industry-categories so the
    # dashboard tab and the Applications tab share a single source (the
    # LLM-classified ai_screening.industry_category_id) instead of running
    # the keyword classifier here.
    return {
        "totals":            totals,
        "funnel":            funnel,
        "status_counts":     status_counts,
        # Full list of AI overall scores (0–10) across all screened apps so
        # the dashboard can render the score-distribution histogram from the
        # complete set, not a capped page of the applications list.
        "ai_score_overalls": scores,
    }


# ─── Applications list (Task 18) ────────────────────────────────────────


def _submitted_at_sort_key(row: dict[str, Any]) -> tuple[int, str]:
    """Sort helper: submitted_at desc, NULLs last.

    Returns `(0, iso_string)` for populated submissions and `(1, "")` for
    NULLs so a plain `reverse=True` pushes NULLs to the bottom. We compare
    ISO-8601 strings directly — they're lexicographically sortable when
    they share the same zone-offset (Supabase returns Zulu).
    """
    s = row.get("submitted_at")
    if not s:
        return (1, "")
    return (0, s)


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
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    """Cross-track paginated list with filters (spec §5.2).

    Filter strategy:
      - status / track / search → pushed to PostgREST per-track
      - industry → keyword-classified post-fetch (no stored column yet)
      - ai_score_min/max → joined per-row from ai_screening, then filtered
      - ai_score_bucket → integer 0..9, matches the dashboard histogram's
        floor()-bucketing exactly (bucket i = [i, i+1), bucket 9 = [9, 10]).
        Lets the histogram click-through filter the list with semantics
        that line up with the bar the user clicked.

    Phase 1 scale (~hundreds of apps) means a Python-side filter pass on a
    capped-fetch is simpler than a two-step PostgREST join. See FETCH_CAP
    in applications_query.py for the comment on when to revisit.
    """
    # ─ 1. Per-track fetch with DB-side filters ─────────────────────────
    tracks_to_query = [track] if track else list(stats.TRACKS)
    rows: list[dict[str, Any]] = []
    for t in tracks_to_query:
        rows.extend(
            applications_query.fetch_apps_for_track(
                t,
                status=status_,
                search=search,
                limit=applications_query.FETCH_CAP,
            )
        )

    # ─ 2. Industry source: LLM-classified ai_screening.industry_category_id ─
    # Replaces the old keyword classifier. Apps without an ai_screening row
    # (or whose industry_category_id is NULL) map to None → frontend "—".
    pairs_for_industry = [(r["track"], r["id"]) for r in rows]
    industries = applications_query.fetch_industry_for_pairs(pairs_for_industry)

    if industry:
        rows = [
            r
            for r in rows
            if (industries.get((r["track"], r["id"])) or {}).get("id") == industry
        ]

    # ─ 3. AI score join + filter ───────────────────────────────────────
    pairs = [(r["track"], r["id"]) for r in rows]
    scores = applications_query.fetch_ai_scores_for(pairs)
    project_names = applications_query.fetch_project_names_for(pairs)

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

    # ─ 4. Total = post-filter, pre-pagination count ─────────────────────
    total = len(rows)

    # ─ 5. Sort → paginate → shape response ─────────────────────────────
    rows.sort(key=_submitted_at_sort_key, reverse=True)
    page = rows[offset : offset + limit]

    applications = []
    for r in page:
        track = r["track"]
        applications.append({
            "id":               r["id"],
            "display_seq":      r.get("display_seq"),
            "display_id":       stats.compose_display_id(track, r.get("display_seq")),
            "track":            track,
            "status":           r.get("status"),
            "project_name":     project_names.get((track, r["id"]))
                                or stats.derive_project_name(r),
            "founder": {
                "name":         r.get("basic_full_name"),
                "affiliation":  r.get("basic_org"),
            },
            "industry":         industries.get((track, r["id"])),
            "stage":            stats.derive_stage_label(r),
            "ai_score_overall": scores.get((track, r["id"])),
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
    status_history = applications_query.fetch_status_history_for(
        application_id, track,
    )

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
    }


# ─── Industry categories endpoint ──────────────────────────────────────


@router.get(
    "/industry-categories",
    dependencies=[Depends(require_capability("view_stats"))],
)
async def get_industry_categories() -> dict[str, Any]:
    """Filter-pill + dashboard-tab data source for industry classification.

    Returns categories with counts (sorted desc by count, then is_seed
    desc as tiebreak; empty categories hidden), the 12-cap, and how many
    slots remain. The frontend reads this to render the filter pills and
    the dashboard tab's industry bar chart.
    """
    return industry_categories.categories_with_counts()
