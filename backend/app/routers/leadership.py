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
from ..services import applications_query, stats

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
    # Each funnel bucket is the sum of its constituent statuses. Reuses the
    # counts we already computed above — no extra DB calls.
    funnel = {
        "profiles": profiles_signed_up,
        **{
            bucket: sum(per_status_total.get(s, 0) for s in statuses)
            for bucket, statuses in stats.FUNNEL_BUCKETS.items()
        },
    }

    # ─── Industry breakdown ───────────────────────────────────────────
    # One SELECT per track of the wizard text fields. classify_industry()
    # joins them and matches against the keyword buckets — see stats.py.
    industry_totals: dict[str, int] = {}
    industry_labels: dict[str, str] = {}
    for track in stats.TRACKS:
        for row in stats.fetch_classification_rows(track):
            bucket_id, label = stats.classify_industry(row)
            industry_totals[bucket_id] = industry_totals.get(bucket_id, 0) + 1
            industry_labels.setdefault(bucket_id, label)

    industry_total_apps = sum(industry_totals.values())
    industries = [
        {
            "id":    bucket_id,
            "label": industry_labels[bucket_id],
            "n":     n,
            "pct":   round((n / industry_total_apps) * 100, 1) if industry_total_apps else 0.0,
        }
        for bucket_id, n in industry_totals.items()
    ]
    industries.sort(key=lambda b: b["n"], reverse=True)

    industry = {
        "industries": industries,
        "total":      industry_total_apps,
    }

    return {
        "totals":        totals,
        "funnel":        funnel,
        "status_counts": status_counts,
        "industry":      industry,
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
    search: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict[str, Any]:
    """Cross-track paginated list with filters (spec §5.2).

    Filter strategy:
      - status / track / search → pushed to PostgREST per-track
      - industry → keyword-classified post-fetch (no stored column yet)
      - ai_score_min/max → joined per-row from ai_screening, then filtered

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

    # ─ 2. Industry post-filter (classify wizard text → bucket) ─────────
    # Pass the full row so classify_industry can read solution_describe,
    # solution_core_tech, problem_describe AND basic_org. Using basic_org
    # alone misclassified almost everything as "Other" because basic_org
    # is usually an institution name without industry signal.
    classified: list[tuple[dict[str, Any], tuple[str, str]]] = [
        (r, stats.classify_industry(r)) for r in rows
    ]
    if industry:
        classified = [(r, ind) for r, ind in classified if ind[0] == industry]

    # ─ 3. AI score join + filter ───────────────────────────────────────
    # Pre-fetch all scores for the current candidate set in one round-trip
    # per track. Then filter by min/max if either bound was supplied.
    pairs = [(r["track"], r["id"]) for r, _ in classified]
    scores = applications_query.fetch_ai_scores_for(pairs)

    filter_ai = ai_score_min is not None or ai_score_max is not None
    if filter_ai:
        kept: list[tuple[dict[str, Any], tuple[str, str]]] = []
        for r, ind in classified:
            s = scores.get((r["track"], r["id"]))
            if s is None:
                # Apps with no AI screening can't match a numeric range. We
                # exclude them rather than treating None as 0 — that would
                # let an "ai_score_min=0" sweep up unscored apps which is
                # almost certainly not what the dashboard wants.
                continue
            if ai_score_min is not None and s < ai_score_min:
                continue
            if ai_score_max is not None and s > ai_score_max:
                continue
            kept.append((r, ind))
        classified = kept

    # ─ 4. Total = post-filter, pre-pagination count ─────────────────────
    total = len(classified)

    # ─ 5. Sort → paginate → shape response ─────────────────────────────
    classified.sort(key=lambda pair: _submitted_at_sort_key(pair[0]), reverse=True)
    page = classified[offset : offset + limit]

    applications = [
        {
            "id":               r["id"],
            "track":            r["track"],
            "status":           r.get("status"),
            "basic_full_name":  r.get("basic_full_name"),
            "basic_email":      r.get("basic_email"),
            "basic_org":        r.get("basic_org"),
            "submitted_at":     r.get("submitted_at"),
            "created_at":       r.get("created_at"),
            "industry":         {"id": ind[0], "label": ind[1]},
            "ai_score_overall": scores.get((r["track"], r["id"])),
            # Derived fields for the leadership Applications table — see
            # stats.py for the rules. The frontend renders "—" for None.
            "project_name":     stats.derive_project_name(r),
            "stage_label":      stats.derive_stage_label(r),
            "display_id":       stats.compose_display_id(r["track"], r["id"]),
        }
        for r, ind in page
    ]

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

    return {
        "id":                   application_id,
        "track":                track,
        "application":          app_row,
        "ai_screening":         ai_screening,
        "reviews":              reviews,
        "reviewer_assignments": reviewer_assignments,
        "status_history":       status_history,
    }
