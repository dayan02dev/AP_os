"""Leadership-dashboard stats helpers (Task 16).

Pure SQL-aggregation helpers. The routers in `routers/leadership.py` compose
these into the bundled `GET /leadership/stats` response. Keeping aggregation
math out of Python (count(*) at the DB, AVG-style projection at the DB) means
this scales to thousands of applications without us iterating rows.

Industry classification is the lone exception — buckets are derived from
`basic_org` via a keyword match. That's string derivation, not stats math,
so it runs in Python over a single-column projection.

The polymorphic application model lives across two tables:
  - `tir_applications`  (renamed from `applications` in migration 010)
  - `sip_applications`  (added in migration 011)

AI scores live in `ai_screening` with a `(application_id, application_track)`
unique pair where `application_track ∈ {'tir','sip'}`.

Module constants (PHASE_1_STATUSES, FUNNEL_BUCKETS, INDUSTRY_BUCKETS) are
the canonical definitions consumed by the router — keep them declarative so
the route handler stays a thin compositor.
"""

from __future__ import annotations

import logging

from ..supabase_client import get_admin_client

log = logging.getLogger(__name__)


# ─── Canonical status set (spec §4.8, post-migration-014) ───────────────
#
# Tuple of (id, label) preserves the display order the dashboard expects.
# The router maps over this directly so adding a new status here automatically
# adds it to the response payload.
PHASE_1_STATUSES: list[tuple[str, str]] = [
    ("submitted",    "Submitted"),
    ("ai_screening", "AI screening"),
    ("under_review", "Under review"),
    ("evaluated",    "Evaluated"),
    ("shortlisted",  "Shortlisted"),
    ("interview",    "Interview"),
    ("offered",      "Offered"),
    ("onboarded",    "Onboarded"),
    ("rejected",     "Not selected"),
    ("waitlisted",   "Waitlisted"),
    ("withdrawn",    "Withdrawn"),
]

# Statuses that count as "submitted" for the totals.apps_submitted figure —
# everything except 'draft'.
NON_DRAFT_STATUSES: list[str] = [s for s, _ in PHASE_1_STATUSES]

# Funnel buckets: each entry collapses 0..n statuses into a single column.
# The dashboard renders these as the 5-step funnel (profiles → submitted →
# in_review → advanced → decided).
FUNNEL_BUCKETS: dict[str, list[str]] = {
    "submitted":  NON_DRAFT_STATUSES,
    "in_review":  ["ai_screening", "under_review"],
    "advanced":   ["shortlisted", "interview"],
    "decided":    ["offered", "onboarded"],
}

# Statuses that mean "advanced past review" for the totals card. Spec §4.8.
ADVANCED_PAST_REVIEW: list[str] = ["shortlisted", "interview", "offered", "onboarded"]

TRACKS: list[str] = ["tir", "sip"]


# ─── Industry classifier ────────────────────────────────────────────────
#
# Keyword buckets matched case-insensitively against the applicant's
# `basic_org` text. First-match wins, so order the buckets by the strongest
# signal first. Phase 2 will replace this with a stored `industry` column
# populated at submit-time, but for the leadership dashboard MVP a keyword
# pass over basic_org is good enough and lets us ship without a migration.
INDUSTRY_BUCKETS: list[tuple[str, str, list[str]]] = [
    ("robotics", "Robotics & Automation",
        ["robot", "drone", "uav", "rover", "automat"]),
    ("health",   "Healthcare / MedTech",
        ["health", "medic", "medtech", "clinic", "patient", "diagnos"]),
    ("industry", "Advanced Manufacturing / Industry 5.0",
        ["manufactur", "factory", "industrial", "assembly"]),
    ("defense",  "Defense & Aerospace",
        ["defence", "defense", "aerospace", "military", "missile"]),
    ("ai",       "Artificial Intelligence / Foundational Models",
        ["ai ", "llm", "language model", "neural", "ml ", "machine learning"]),
    ("semi",     "Semiconductor / Hardware",
        ["semiconduct", "chip", "fpga", "asic", "soc", "wafer"]),
]

OTHER_BUCKET: tuple[str, str] = ("other", "Other")


def classify_industry(org_text: str | None) -> tuple[str, str]:
    """Map a free-text organisation/sector description to a bucket.

    Returns ``(bucket_id, label)``. Defaults to ``OTHER_BUCKET`` if no keyword
    matches or the input is empty.
    """
    if not org_text:
        return OTHER_BUCKET
    s = org_text.lower()
    for bucket_id, label, keywords in INDUSTRY_BUCKETS:
        for kw in keywords:
            if kw in s:
                return (bucket_id, label)
    return OTHER_BUCKET


# ─── Count helpers (SQL aggregation only) ──────────────────────────────


def _track_table(track: str) -> str:
    """Map a track id to its applications table name."""
    if track not in TRACKS:
        raise ValueError(f"unknown track: {track!r}")
    return f"{track}_applications"


def count_apps_by_status(track: str, status: str) -> int:
    """count(*) of applications on `track` with the given status.

    Uses supabase-py's `.select("id", count="exact")` which translates to a
    PostgREST HEAD-style count, not a row scan. Returns 0 on query error so
    one failing cell doesn't take down the whole dashboard.
    """
    try:
        res = (
            get_admin_client()
            .table(_track_table(track))
            .select("id", count="exact")
            .eq("status", status)
            .execute()
        )
        return res.count or 0
    except Exception as exc:
        log.warning(
            "stats.count_apps_by_status failed",
            extra={"track": track, "status": status, "err": str(exc)},
        )
        return 0


def count_apps_total(track: str) -> int:
    """count(*) of all non-draft applications on `track`."""
    try:
        res = (
            get_admin_client()
            .table(_track_table(track))
            .select("id", count="exact")
            .neq("status", "draft")
            .execute()
        )
        return res.count or 0
    except Exception as exc:
        log.warning(
            "stats.count_apps_total failed",
            extra={"track": track, "err": str(exc)},
        )
        return 0


def count_profiles() -> int:
    """count(*) of profiles — proxy for total signed-up users."""
    try:
        res = (
            get_admin_client()
            .table("profiles")
            .select("id", count="exact")
            .execute()
        )
        return res.count or 0
    except Exception as exc:
        log.warning("stats.count_profiles failed", extra={"err": str(exc)})
        return 0


# ─── AI score aggregation ──────────────────────────────────────────────


def fetch_ai_score_overalls() -> list[float]:
    """Return the populated `score_overall` values from `ai_screening`.

    Single column projection; NULLs filtered server-side via PostgREST's
    `.not_.is_(col, "null")`. The mean is computed by the caller in one line
    — keeping the helper data-only keeps it testable.
    """
    try:
        res = (
            get_admin_client()
            .table("ai_screening")
            .select("score_overall")
            .not_.is_("score_overall", "null")
            .execute()
        )
        rows = res.data or []
        return [float(r["score_overall"]) for r in rows if r.get("score_overall") is not None]
    except Exception as exc:
        log.warning("stats.fetch_ai_score_overalls failed", extra={"err": str(exc)})
        return []


# ─── Industry source rows ──────────────────────────────────────────────


def fetch_org_texts(track: str) -> list[str]:
    """Return non-empty `basic_org` strings from non-draft apps on `track`.

    Single-column projection; classification happens in Python because keyword
    matching on free text isn't worth a stored-procedure round-trip.
    """
    try:
        res = (
            get_admin_client()
            .table(_track_table(track))
            .select("basic_org")
            .neq("status", "draft")
            .execute()
        )
        rows = res.data or []
        return [r["basic_org"] for r in rows if r.get("basic_org")]
    except Exception as exc:
        log.warning(
            "stats.fetch_org_texts failed",
            extra={"track": track, "err": str(exc)},
        )
        return []
