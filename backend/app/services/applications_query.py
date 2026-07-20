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


def also_in_track(email: str | None, current_track: str) -> str | None:
    """Return the OTHER track's code ('sip' | 'tir') if the same applicant — by
    normalized `basic_email` — has a non-draft application there; else None.

    Cross-track match key is the lower-cased, trimmed email. Powers the
    "Also in VIP / Also in TIR" pill on the reviewer & admin detail screens.
    Best-effort: any lookup error → None (the pill simply doesn't show)."""
    norm = (email or "").strip().lower()
    if not norm:
        return None
    other = "sip" if current_track == "tir" else "tir"
    try:
        rows = (
            get_admin_client()
            .table(f"{other}_applications")
            .select("id,status,basic_email")
            .ilike("basic_email", norm)
            .neq("status", "draft")
            .limit(50)
            .execute()
            .data
        ) or []
    except Exception:  # noqa: BLE001
        log.warning("also_in_track lookup failed",
                    extra={"current_track": current_track})
        return None
    # ilike is a case-insensitive DB pre-filter, but SQL LIKE treats `_`/`%` in
    # the email as wildcards — so confirm an EXACT normalized match in Python
    # before claiming a cross-track submission (avoids false-positive pills).
    for r in rows:
        if (r.get("basic_email") or "").strip().lower() == norm:
            return other
    return None


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
    "solution_describe,solution_core_tech,problem_describe,"
    "display_seq,moved_to_track"
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


def fetch_app_ids_by_project_name(track: str, needle: str, *, cap: int = 1000) -> list[str]:
    """Application ids on `track` whose ai_screening.project_name matches `needle`.

    The leadership/admin "Project" column shows `ai_screening.project_name`,
    so search must cover it — but it lives on a different table. We resolve the
    matching application ids here so the caller can fold them into its OR
    filter. Best-effort: returns [] on any error (search degrades to the
    name/email/org match rather than 500ing).
    """
    needle = (needle or "").strip()
    if not needle:
        return []
    try:
        res = (
            get_admin_client()
            .table("ai_screening")
            .select("application_id")
            .eq("application_track", track)
            .ilike("project_name", f"%{needle}%")
            .limit(cap)
            .execute()
        )
        return [r["application_id"] for r in (res.data or []) if r.get("application_id")]
    except Exception as exc:
        log.warning(
            "applications_query.fetch_app_ids_by_project_name failed",
            extra={"track": track, "err": str(exc)},
        )
        return []


def _other_track(track: str) -> str:
    return "sip" if track == "tir" else "tir"


def _query_track_table(
    track: str,
    *,
    status: str | None = None,
    search: str | None = None,
    limit: int = FETCH_CAP,
) -> list[dict[str, Any]]:
    """Raw single-table fetch of non-draft rows on `track` with DB-applicable
    filters, each stamped with its NATIVE ``track``. No track-move overlay —
    callers compose the effective-track view from these."""
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
            # If the search input is purely digits, we ALSO match against
            # `display_seq` so leadership can paste "26013" (or "TIR-26013"
            # after the frontend strips the prefix) and find the row.
            needle = f"%{search}%"
            or_parts = [
                f"basic_full_name.ilike.{needle}",
                f"basic_email.ilike.{needle}",
                f"basic_org.ilike.{needle}",
            ]
            digits = search.strip().lstrip("-+")
            if digits.isdigit():
                or_parts.append(f"display_seq.eq.{digits}")
            # Also match the AI-derived project name (the "Project" column the
            # user actually sees and searches by). project_name lives on the
            # ai_screening table, so we pre-resolve matching application ids and
            # fold them into the OR via `id.in.(…)` — PostgREST parses the
            # nested parens inside or(...).
            project_ids = fetch_app_ids_by_project_name(track, search)
            if project_ids:
                or_parts.append(f"id.in.({','.join(project_ids)})")
            q = q.or_(",".join(or_parts))
        res = q.execute()
        rows = res.data or []
    except Exception as exc:
        log.warning(
            "applications_query._query_track_table failed",
            extra={"track": track, "err": str(exc)},
        )
        return []

    for r in rows:
        r["track"] = track
    return rows


def fetch_apps_for_track(
    track: str,
    *,
    status: str | None = None,
    search: str | None = None,
    limit: int = FETCH_CAP,
) -> list[dict[str, Any]]:
    """Return non-draft applications whose EFFECTIVE track is `track`.

    Track-move overlay (2026-07-20): a moved application is treated as the
    OTHER track everywhere it's listed/filtered/counted, while the row stays in
    its physical (native) table. So the effective membership of `track` is:

      - native rows in ``{track}_applications`` NOT moved away
        (``moved_to_track`` is falsy), plus
      - rows in the OTHER table MOVED INTO this track
        (``moved_to_track == track``).

    Each returned row keeps ``r["track"]`` = its NATIVE track so the caller's
    child-table lookups (reviews, ai_screening, decisions — all keyed by the
    native ``application_track``) stay correct. The caller derives the display/
    effective track as ``r.get("moved_to_track") or r["track"]``.

    Partitioning on ``moved_to_track`` happens in Python so this is backend-
    agnostic (works with the in-memory test double, whose ``.is_``/``.neq`` are
    no-ops). ``status``/``search`` are still pushed to PostgREST.
    """
    other = _other_track(track)
    native = [
        r for r in _query_track_table(track, status=status, search=search, limit=limit)
        if not r.get("moved_to_track")
    ]
    moved_in = [
        r for r in _query_track_table(other, status=status, search=search, limit=limit)
        if r.get("moved_to_track") == track
    ]
    return native + moved_in


def effective_track(row: dict[str, Any]) -> str | None:
    """Display/filter track for a row under the track-move overlay:
    ``moved_to_track`` when the app has been moved, else its native ``track``."""
    return row.get("moved_to_track") or row.get("track")


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


def fetch_project_names_for(
    pairs: list[tuple[str, str]],
) -> dict[tuple[str, str], str | None]:
    """Bulk-load the AI-extracted `project_name` for `(track, id)` pairs.

    The leadership list prefers this founder-stated name over the
    solution_describe heuristic. One query per track; missing pairs (or
    rows with a NULL project_name, e.g. stub-scored apps) map to None so
    the caller can fall back to ``stats.derive_project_name``.
    """
    out: dict[tuple[str, str], str | None] = {(t, a): None for t, a in pairs}
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
                .select("application_id,project_name")
                .eq("application_track", track)
                .in_("application_id", ids)
                .execute()
            )
            for row in res.data or []:
                aid = row.get("application_id")
                name = row.get("project_name")
                if aid is None:
                    continue
                out[(track, aid)] = name or None
        except Exception as exc:
            log.warning(
                "applications_query.fetch_project_names_for failed",
                extra={"track": track, "err": str(exc)},
            )
            continue

    return out


# ─── Industry join helper ──────────────────────────────────────────────


def fetch_industry_for_pairs(
    pairs: list[tuple[str, str]],
) -> dict[tuple[str, str], dict[str, str] | None]:
    """Bulk-load `industry_category_id → label` for the given pairs.

    Returns a dict keyed by `(track, application_id)` → `{"id", "label"}`
    or None when the row is unscreened, missing, or has industry_category_id
    NULL. Two queries per call total: one `ai_screening` projection per
    track plus a single `industry_categories` lookup to resolve labels.
    """
    out: dict[tuple[str, str], dict[str, str] | None] = {(t, a): None for t, a in pairs}
    if not pairs:
        return out

    by_track: dict[str, list[str]] = {t: [] for t in stats.TRACKS}
    for t, a in pairs:
        if t in by_track:
            by_track[t].append(a)

    raw: dict[tuple[str, str], str | None] = {}
    for track, ids in by_track.items():
        if not ids:
            continue
        try:
            res = (
                get_admin_client()
                .table("ai_screening")
                .select("application_id,industry_category_id")
                .eq("application_track", track)
                .in_("application_id", ids)
                .execute()
            )
            for row in res.data or []:
                aid = row.get("application_id")
                cid = row.get("industry_category_id")
                if aid:
                    raw[(track, aid)] = cid
        except Exception as exc:
            log.warning(
                "applications_query.fetch_industry_for_pairs failed",
                extra={"track": track, "err": str(exc)},
            )

    needed_ids = {cid for cid in raw.values() if cid}
    labels: dict[str, str] = {}
    if needed_ids:
        try:
            res = (
                get_admin_client()
                .table("industry_categories")
                .select("id,label")
                .in_("id", list(needed_ids))
                .execute()
            )
            for row in res.data or []:
                labels[row["id"]] = row["label"]
        except Exception as exc:
            log.warning(
                "applications_query.fetch_industry_for_pairs labels failed",
                extra={"err": str(exc)},
            )

    for (track, aid), cid in raw.items():
        if cid and cid in labels:
            out[(track, aid)] = {"id": cid, "label": labels[cid]}
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


# ─── Attachment path → bucket resolution ────────────────────────────────
#
# A leadership reviewer downloading an attachment must NOT be able to sign an
# arbitrary storage path. We rebuild the set of paths that genuinely belong to
# an application by walking its file-bearing JSONB fields, and we pick the
# bucket from the *field the path came from* (never by parsing the path string)
# — mirroring the column→bucket convention the upload routers and migrations
# established. The bucket also depends on the track because TIR and SIP write
# the same logical field to differently-named buckets (e.g. milestone files).
#
# Each entry: (field_name, kind) where kind is "array" (list of file objects)
# or "single" (one file object). Buckets are resolved per-track below.
_TIR_FILE_FIELDS: list[tuple[str, str]] = [
    ("evidence_files", "array"),
    ("evidence_deck", "single"),            # legacy single-deck upload
    ("execution_milestone_files", "array"),
]
_SIP_FILE_FIELDS: list[tuple[str, str]] = [
    ("execution_milestone_files", "array"),
    ("sip_traction_files", "array"),
    ("sip_patents_files", "array"),
    ("sip_pitch_deck", "single"),
    ("sip_cap_table_file", "single"),
]

# (track, field) → bucket. Source of truth: migration 010 (renamed the TIR
# buckets created in 002/004/006 to tir-*; the old un-prefixed buckets survive
# only as empty husks) and 011 (SIP). TIR evidence/deck → "tir-evidence-files";
# TIR milestone → "tir-milestone-files". SIP milestone → "sip-milestone-files";
# all other SIP evidence (pitch deck, cap table, traction LOIs, patents) →
# "sip-evidence-files".
_FIELD_BUCKET: dict[tuple[str, str], str] = {
    ("tir", "evidence_files"): "tir-evidence-files",
    ("tir", "evidence_deck"): "tir-evidence-files",
    ("tir", "execution_milestone_files"): "tir-milestone-files",
    ("sip", "execution_milestone_files"): "sip-milestone-files",
    ("sip", "sip_traction_files"): "sip-evidence-files",
    ("sip", "sip_patents_files"): "sip-evidence-files",
    ("sip", "sip_pitch_deck"): "sip-evidence-files",
    ("sip", "sip_cap_table_file"): "sip-evidence-files",
}


def _path_of(entry: Any) -> str | None:
    """Pull the storage path out of one file object, tolerating both keys.

    Uploads write `path`; some legacy/imported rows carry `storage_path`.
    """
    if not isinstance(entry, dict):
        return None
    return entry.get("storage_path") or entry.get("path") or None


def collect_application_file_paths(
    track: str, app_row: dict[str, Any],
) -> dict[str, str]:
    """Return ``{storage_path: bucket}`` for every attachment on ``app_row``.

    Walks only the known file-bearing fields for ``track`` and resolves the
    bucket from the field the path came from. The download endpoint uses this
    as an allow-list: a requested path is signable iff it's a key in this map.
    """
    fields = _TIR_FILE_FIELDS if track == "tir" else _SIP_FILE_FIELDS
    out: dict[str, str] = {}
    for field, kind in fields:
        bucket = _FIELD_BUCKET.get((track, field))
        if bucket is None:
            continue
        value = app_row.get(field)
        if value is None:
            continue
        entries = [value] if kind == "single" else (value if isinstance(value, list) else [])
        for entry in entries:
            path = _path_of(entry)
            if path:
                out[path] = bucket
    return out


# Résumés are NOT stored inline on the application row (unlike evidence files);
# each application FKs one upload row via `resume_file_id`. TIR → tir_resume_uploads
# / tir-resumes; VIP(sip) → sip_resume_uploads / sip-resumes.
_RESUME_TABLE: dict[str, str] = {"tir": "tir_resume_uploads", "sip": "sip_resume_uploads"}
_RESUME_BUCKET: dict[str, str] = {"tir": "tir-resumes", "sip": "sip-resumes"}


def resolve_resume_file(track: str, app_row: dict[str, Any]) -> dict[str, Any] | None:
    """Resolve an application's ``resume_file_id`` into a file object.

    Returns a dict shaped for the frontend FileGridAnswer renderer
    (``original_filename`` / ``file_size_bytes`` / ``storage_path`` / ``mime_type``)
    plus ``bucket`` for the signed-URL allow-list — or ``None`` when the
    application has no résumé, or the upload row / its storage path is missing.
    """
    rid = app_row.get("resume_file_id")
    table = _RESUME_TABLE.get(track)
    if not rid or table is None:
        return None
    try:
        res = (
            get_admin_client()
            .table(table)
            .select("storage_path, original_filename, file_size_bytes, mime_type")
            .eq("id", str(rid))
            .limit(1)
            .execute()
        )
    except Exception:
        log.warning("resolve_resume_file: lookup failed",
                    extra={"track": track, "resume_file_id": str(rid)})
        return None
    rows = res.data or []
    if not rows:
        return None
    row = rows[0]
    path = row.get("storage_path")
    if not path:
        return None
    return {
        "original_filename": row.get("original_filename") or "resume",
        "file_size_bytes": row.get("file_size_bytes"),
        "storage_path": path,
        "mime_type": row.get("mime_type"),
        "bucket": _RESUME_BUCKET[track],
    }


def detach_application_from_review(
    sb: Any, application_id: str, track: str, *, remove_batch_link: bool,
) -> dict[str, int]:
    """Remove an application from active review.

    Deletes EVERY ``reviewer_assignments`` row for ``(application_id, track)`` —
    all reviewers, so a batch stays consistent — and, when ``remove_batch_link``,
    its ``application_batches`` row. ``reviews`` rows are intentionally kept
    (admin/leadership still see past scores). Best-effort per delete. Used when an
    app is unassigned from a batch or rejected at Gate-1.
    """
    assignments_removed = 0
    try:
        res = (
            sb.table("reviewer_assignments").delete()
            .eq("application_id", application_id)
            .eq("application_track", track)
            .execute()
        )
        assignments_removed = len(res.data or [])
    except Exception:
        log.warning("detach: reviewer_assignments delete failed",
                    extra={"application_id": application_id, "track": track})
    batch_links_removed = 0
    if remove_batch_link:
        try:
            res = (
                sb.table("application_batches").delete()
                .eq("application_id", application_id)
                .eq("application_track", track)
                .execute()
            )
            batch_links_removed = len(res.data or [])
        except Exception:
            log.warning("detach: application_batches delete failed",
                        extra={"application_id": application_id, "track": track})
    return {"assignments_removed": assignments_removed,
            "batch_links_removed": batch_links_removed}


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


def enrich_reviewers(
    reviewer_assignments: list[dict[str, Any]] | None,
    reviews: list[dict[str, Any]] | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Attach reviewer display names + a timestamp-derived status in place.

    Both `reviewer_assignments` and `reviews` carry only `reviewer_user_id`
    (a UUID). The detail UIs (leadership AppDrawer, leadership review-page
    Reviewers panel, admin application detail) want the reviewer's *name* and
    the *real* assignment status — not the vestigial `state` column, which is
    inserted as 'pending' and never advanced.

    Mutates and returns the same lists. Best-effort: a profiles-lookup failure
    leaves `reviewer_name` falling back to the short UUID; it never raises.

    For each assignment we add:
      - reviewer_name   = full_name | email | uid[:8]
      - reviewer_email
      - reviewer_status ∈ {pending, evaluated, declined}, derived from
        timestamps: declined_at → declined; (completed_at set OR a submitted
        review exists for that reviewer) → evaluated; else pending.
    For each review we add reviewer_name + reviewer_email.
    """
    reviewer_assignments = reviewer_assignments or []
    reviews = reviews or []

    ids = {
        a.get("reviewer_user_id")
        for a in reviewer_assignments
        if a.get("reviewer_user_id")
    } | {
        r.get("reviewer_user_id")
        for r in reviews
        if r.get("reviewer_user_id")
    }

    # uid -> {full_name, email}; one best-effort bulk fetch.
    profiles: dict[str, dict[str, Any]] = {}
    if ids:
        try:
            res = (
                get_admin_client()
                .table("profiles")
                .select("id,full_name,email")
                .in_("id", list(ids))
                .execute()
            )
            for p in res.data or []:
                profiles[p["id"]] = p
        except Exception as exc:
            log.warning(
                "applications_query.enrich_reviewers profiles fetch failed",
                extra={"err": str(exc)},
            )

    def _name(uid: str | None) -> str | None:
        if not uid:
            return None
        prof = profiles.get(uid) or {}
        return prof.get("full_name") or prof.get("email") or uid[:8]

    def _email(uid: str | None) -> str | None:
        if not uid:
            return None
        return (profiles.get(uid) or {}).get("email")

    # Reviewers who have a *submitted* review on this app (status derivation).
    submitted_ids = {
        r.get("reviewer_user_id")
        for r in reviews
        if r.get("reviewer_user_id") and r.get("submitted_at")
    }

    for a in reviewer_assignments:
        uid = a.get("reviewer_user_id")
        a["reviewer_name"] = _name(uid)
        a["reviewer_email"] = _email(uid)
        if a.get("declined_at"):
            a["reviewer_status"] = "declined"
        elif a.get("completed_at") or uid in submitted_ids:
            a["reviewer_status"] = "evaluated"
        else:
            a["reviewer_status"] = "pending"

    for r in reviews:
        uid = r.get("reviewer_user_id")
        r["reviewer_name"] = _name(uid)
        r["reviewer_email"] = _email(uid)

    return reviewer_assignments, reviews
