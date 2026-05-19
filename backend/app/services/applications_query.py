"""Cross-track application query helpers (Task 18).

Read-side support for the leadership dashboard's Applications tab. The
polymorphic application model lives across two tables (`tir_applications`,
`sip_applications`) keyed by `(application_id, application_track)`. These
helpers do the heavy lifting of:

  - listing rows across both tracks with DB-applicable filters (status,
    track, search) pre-applied
  - inferring a track for a given application UUID (needed by the detail
    endpoint, which doesn't take track in the URL)
  - bulk-loading `ai_screening` rows so the list response can attach
    `ai_score_overall` per row in one round-trip

`services.stats` is for analytics math (count(*), industry classification,
score averages). These list/detail helpers belong here so the stats module
stays single-purpose. We re-import `TRACKS` and the table-name helper from
stats to avoid duplicating that one-liner.

Scale assumption
----------------
Phase 1 is hundreds of applications. We fetch up to FETCH_CAP rows per
track, then post-filter (industry, AI score range) in Python, then paginate.
This avoids a complex cross-table join in PostgREST and keeps the code
readable. When the corpus exceeds a few thousand non-draft apps we should
revisit and push the AI score filter to PostgREST via a two-step query
(filter `ai_screening` first → `.in_("id", …)` on applications), and store
`industry` as a column at submit-time.
"""

from __future__ import annotations

import logging
from typing import Any

from ..supabase_client import get_admin_client
from . import stats

log = logging.getLogger(__name__)


# Maximum rows we'll pull per track before in-Python filtering. Phase 1
# scale is hundreds of apps; 5000 leaves four orders of magnitude of
# headroom while still capping pathological responses.
FETCH_CAP = 5000


def track_table(track: str) -> str:
    """Public alias for `stats._track_table` — that helper is module-private
    by convention (leading underscore) and we don't want to reach across the
    fence. Same validation/formatting; keep them in sync."""
    if track not in stats.TRACKS:
        raise ValueError(f"unknown track: {track!r}")
    return f"{track}_applications"


# ─── List query ─────────────────────────────────────────────────────────


# Columns the list endpoint needs. Keep narrow — the detail endpoint
# selects `*`. This projection keeps payloads small for the list view.
#
# The base columns exist on both tracks. The stage column differs:
#   - TIR uses `solution_stage` (set in the wizard, no SIP equivalent)
#   - SIP uses `sip_traction` + `sip_trl` (TIR equivalents don't exist)
# We pick the right superset per track via _list_columns_for_track so a
# missing-column error doesn't 400 PostgREST.
_BASE_LIST_COLUMNS = (
    "id,status,basic_full_name,basic_email,basic_org,"
    "submitted_at,created_at,"
    "solution_describe,solution_core_tech,problem_describe"
)
_TIR_EXTRA_COLUMNS = ",solution_stage"
_SIP_EXTRA_COLUMNS = ",sip_traction,sip_trl"

# Backward-compat alias — some callers (and tests) reference LIST_COLUMNS
# as the canonical column list. Keep it pointing at the union so a code
# reader sees the full surface in one place.
LIST_COLUMNS = _BASE_LIST_COLUMNS + _TIR_EXTRA_COLUMNS + _SIP_EXTRA_COLUMNS


def _list_columns_for_track(track: str) -> str:
    """Return the column projection appropriate for the given track."""
    if track == "tir":
        return _BASE_LIST_COLUMNS + _TIR_EXTRA_COLUMNS
    if track == "sip":
        return _BASE_LIST_COLUMNS + _SIP_EXTRA_COLUMNS
    return _BASE_LIST_COLUMNS


def fetch_apps_for_track(
    track: str,
    *,
    status: str | None = None,
    search: str | None = None,
    limit: int = FETCH_CAP,
) -> list[dict[str, Any]]:
    """Return non-draft applications on `track` with DB-applicable filters.

    `status` and `search` are pushed to PostgREST. Industry and AI-score
    filtering happens in Python over the returned rows because:
      - industry is keyword-classified, not a stored column
      - AI score lives on a different table; pushing it down here would
        require a cross-table join that PostgREST doesn't express cleanly.

    Adds `track` to each row so the caller can build the merged list without
    a second pass.
    """
    try:
        q = (
            get_admin_client()
            .table(track_table(track))
            .select(_list_columns_for_track(track))
            .neq("status", "draft")
            .limit(limit)
        )
        if status:
            q = q.eq("status", status)
        if search:
            # Case-insensitive substring across the three free-text identity
            # fields. PostgREST `.or_()` takes a comma-joined filter string.
            needle = f"%{search}%"
            q = q.or_(
                f"basic_full_name.ilike.{needle},"
                f"basic_email.ilike.{needle},"
                f"basic_org.ilike.{needle}"
            )
        res = q.execute()
        rows = res.data or []
    except Exception as exc:
        log.warning(
            "applications_query.fetch_apps_for_track failed",
            extra={"track": track, "err": str(exc)},
        )
        return []

    for r in rows:
        r["track"] = track
    return rows


def fetch_ai_scores_for(
    pairs: list[tuple[str, str]],
) -> dict[tuple[str, str], float | None]:
    """Bulk-load `score_overall` for a list of `(track, application_id)` pairs.

    One query per track (two total) — we filter by `.in_("application_id",
    [...])` and by `.eq("application_track", track)`. Returns a dict keyed by
    `(track, id)`; missing pairs map to `None` so the caller can `.get()`
    without a fallback.
    """
    out: dict[tuple[str, str], float | None] = {(t, a): None for t, a in pairs}
    if not pairs:
        return out

    by_track: dict[str, list[str]] = {t: [] for t in stats.TRACKS}
    for t, a in pairs:
        if t in by_track:
            by_track[t].append(a)

    for track, ids in by_track.items():
        if not ids:
            continue
        try:
            res = (
                get_admin_client()
                .table("ai_screening")
                .select("application_id,score_overall")
                .eq("application_track", track)
                .in_("application_id", ids)
                .execute()
            )
            for row in res.data or []:
                aid = row.get("application_id")
                score = row.get("score_overall")
                if aid is None:
                    continue
                out[(track, aid)] = float(score) if score is not None else None
        except Exception as exc:
            log.warning(
                "applications_query.fetch_ai_scores_for failed",
                extra={"track": track, "err": str(exc)},
            )
            # Leave those pairs as None — partial join is better than 500.
            continue

    return out


# ─── Detail query ───────────────────────────────────────────────────────


def find_application_with_track(
    application_id: str,
) -> tuple[str, dict[str, Any]] | None:
    """Locate an application UUID across both track tables.

    Returns `(track, row)` for the first table that has it. Returns `None` if
    neither table has a row with that id. We hit tir first because the legacy
    corpus is tir-only; in steady state both probes are cheap (PK lookup).

    Errors on either probe are swallowed and logged — if the tir probe fails
    transiently we still try sip. The router upgrades a final `None` into a
    404 so a real "missing" looks the same as "both probes errored".
    """
    for track in stats.TRACKS:
        try:
            res = (
                get_admin_client()
                .table(track_table(track))
                .select("*")
                .eq("id", application_id)
                .limit(1)
                .execute()
            )
            rows = res.data or []
            if rows:
                return track, rows[0]
        except Exception as exc:
            log.warning(
                "applications_query.find_application_with_track probe failed",
                extra={"track": track, "id": application_id, "err": str(exc)},
            )
            continue
    return None


def fetch_ai_screening_for(
    application_id: str, track: str,
) -> dict[str, Any] | None:
    """Return the `ai_screening` row for `(application_id, track)` or None."""
    try:
        res = (
            get_admin_client()
            .table("ai_screening")
            .select("*")
            .eq("application_id", application_id)
            .eq("application_track", track)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        return rows[0] if rows else None
    except Exception as exc:
        log.warning(
            "applications_query.fetch_ai_screening_for failed",
            extra={"track": track, "id": application_id, "err": str(exc)},
        )
        return None


def fetch_reviews_for(
    application_id: str, track: str,
) -> list[dict[str, Any]]:
    """Return reviews for `(application_id, track)` ordered submitted_at desc."""
    try:
        res = (
            get_admin_client()
            .table("reviews")
            .select("*")
            .eq("application_id", application_id)
            .eq("application_track", track)
            .order("submitted_at", desc=True)
            .execute()
        )
        return res.data or []
    except Exception as exc:
        log.warning(
            "applications_query.fetch_reviews_for failed",
            extra={"track": track, "id": application_id, "err": str(exc)},
        )
        return []


def fetch_reviewer_assignments_for(
    application_id: str, track: str,
) -> list[dict[str, Any]]:
    """Return assignments for `(application_id, track)` ordered assigned_at desc."""
    try:
        res = (
            get_admin_client()
            .table("reviewer_assignments")
            .select("*")
            .eq("application_id", application_id)
            .eq("application_track", track)
            .order("assigned_at", desc=True)
            .execute()
        )
        return res.data or []
    except Exception as exc:
        log.warning(
            "applications_query.fetch_reviewer_assignments_for failed",
            extra={"track": track, "id": application_id, "err": str(exc)},
        )
        return []


def fetch_status_history_for(
    application_id: str, track: str,
) -> list[dict[str, Any]]:
    """Return application_status_log rows for `(application_id, track)`
    ordered changed_at desc."""
    try:
        res = (
            get_admin_client()
            .table("application_status_log")
            .select("*")
            .eq("application_id", application_id)
            .eq("application_track", track)
            .order("changed_at", desc=True)
            .execute()
        )
        return res.data or []
    except Exception as exc:
        log.warning(
            "applications_query.fetch_status_history_for failed",
            extra={"track": track, "id": application_id, "err": str(exc)},
        )
        return []
