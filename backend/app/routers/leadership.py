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

Guarded by `require_capability("view_stats")`. The `leadership` and `admin`
roles both have this capability in `rbac.ROLE_CAPABILITIES`.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends

from ..rbac import require_capability
from ..services import stats

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
    # One SELECT per track of just `basic_org`, classified into buckets.
    industry_totals: dict[str, int] = {}
    industry_labels: dict[str, str] = {}
    for track in stats.TRACKS:
        for org in stats.fetch_org_texts(track):
            bucket_id, label = stats.classify_industry(org)
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
