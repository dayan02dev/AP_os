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
# Keyword buckets matched case-insensitively. First-match wins, so order
# the buckets by the strongest signal first. Phase 2 will replace this
# with a stored `industry` column populated at submit-time, but for now
# we read the wizard text fields and run a keyword pass over the joined
# text.
#
# Important: `basic_org` alone is too sparse — it's typically just an
# institution name (IIT Bombay, NIT Surathkal, Independent) that carries
# no industry signal. We concatenate basic_org + solution_describe +
# solution_core_tech + problem_describe so the keywords match against
# actual domain text. This is what fixed the "everything falls into
# Other" misclassification on the staging dashboard.
# Bucket order is intentional: most-specific signals first, broadest
# catch-alls last. "industrial" / "manufactur" are very broad and would
# steal hits from semi / robotics / defense if they ran first.
INDUSTRY_BUCKETS: list[tuple[str, str, list[str]]] = [
    ("health",   "Healthcare / MedTech",
        ["health", "medic", "medtech", "clinic", "patient", "diagnos",
         "biotech", "pharma", "vaccine", "therapeut", "surgery", "surgical",
         "wearable", "afib", "ecg", "mri", "ct scan", "imaging", "dengue",
         "cancer", "tumor", "tumour", "icu", "hospital", "microfluidic"]),
    ("semi",     "Semiconductor / Hardware",
        ["semiconduct", "chip ", " chip,", "fpga", "asic", "soc ",
         "wafer", " fab ", "pcb", "embedded system", "mems",
         "gyroscope", "gyro for", "transceiver", "rfic"]),
    ("robotics", "Robotics & Automation",
        ["robot", "drone", "uav", "rover", "automat", "autonom",
         "manipulat", "actuator", "slam", "lidar"]),
    ("defense",  "Defense & Aerospace",
        ["defence", "defense", "aerospace", "military", "missile",
         "satellite", "satellites", "spacecraft", "rocket", "launch vehicle",
         "gnss", "anti-jam", "radar", "sonar", "isr"]),
    ("ai",       "Artificial Intelligence / Foundational Models",
        ["ai ", " ai,", " ai.", "llm", "language model", "neural",
         "ml ", " ml,", " ml.", "machine learning", "foundation model",
         "foundational model", "generative", "agentic", "copilot",
         "rag stack", "transformer", "deep learning", "computer vision",
         "nlp ", "speech recognition"]),
    ("industry", "Advanced Manufacturing / Industry 5.0",
        ["manufactur", "factory", "industrial", "assembly", "fabricat",
         "tool-tracking", "tool tracking", "machining", "cnc", "additive",
         "3d print", "supply chain", "industry 4.0", "industry 5.0"]),
]

OTHER_BUCKET: tuple[str, str] = ("other", "Other / Frontier")

# Wizard text fields that feed the industry classifier. Ordered by signal
# strength: solution_describe usually names the application domain most
# explicitly; basic_org is the weakest signal but still useful for the few
# cases where the org name itself contains a keyword.
_CLASSIFY_FIELDS: tuple[str, ...] = (
    "solution_describe",
    "solution_core_tech",
    "problem_describe",
    "basic_org",
)


def _row_classify_text(row: dict) -> str:
    """Join the wizard text fields the classifier reads."""
    return " ".join(str(row.get(f) or "") for f in _CLASSIFY_FIELDS)


def classify_industry(source: str | dict | None) -> tuple[str, str]:
    """Map free-text wizard data to an industry bucket.

    Accepts:
      - dict: a row from tir_applications / sip_applications. We
        concatenate the wizard text fields and run the keyword pass over
        the joined text. This is the path the leadership routes use.
      - str: legacy single-string input (backward-compat for unit tests
        and any caller that already has a flat string).
      - None: returns ``OTHER_BUCKET``.

    Returns ``(bucket_id, label)``. Defaults to ``OTHER_BUCKET`` when no
    keyword matches or the joined text is empty.
    """
    if source is None:
        return OTHER_BUCKET
    if isinstance(source, dict):
        text = _row_classify_text(source)
    else:
        text = str(source)
    if not text.strip():
        return OTHER_BUCKET
    s = text.lower()
    for bucket_id, label, keywords in INDUSTRY_BUCKETS:
        for kw in keywords:
            if kw in s:
                return (bucket_id, label)
    return OTHER_BUCKET


# ─── Stage label derivation ─────────────────────────────────────────────
#
# Used by the leadership Applications table's "Stage" column. SIP applicants
# pick a `sip_traction` value from a closed enum; TIR has `solution_stage`.
# We collapse both to a short label that fits the table cell.
_SIP_TRACTION_TO_STAGE: dict[str, str] = {
    "Pre-revenue — building toward our first pilot":          "Pre-revenue",
    "Active pilots (paid or unpaid) with design partners":    "Pilot",
    "Paying pilots — customers have paid for early access":   "Early revenue",
    "Live paying customers — repeat revenue":                 "Live revenue",
}

_SIP_TRL_TO_STAGE: dict[str, str] = {
    "TRL 3 or earlier — research stage":                  "Research",
    "TRL 4 — lab-validated prototype":                    "Prototype",
    "TRL 5 — pilot-tested in a relevant environment":     "Pilot",
    "TRL 6+ — demonstrated in operational setting":       "Operational",
}


def derive_stage_label(row: dict | None) -> str | None:
    """Short stage label for the leadership Applications table.

    Resolution order:
      1. SIP `sip_traction` (revenue-stage enum)
      2. SIP `sip_trl` (technology readiness fallback)
      3. TIR `solution_stage` (free text — truncated)
      4. None — frontend renders "—"
    """
    if not row:
        return None
    traction = row.get("sip_traction")
    if traction and traction in _SIP_TRACTION_TO_STAGE:
        return _SIP_TRACTION_TO_STAGE[traction]
    trl = row.get("sip_trl")
    if trl and trl in _SIP_TRL_TO_STAGE:
        return _SIP_TRL_TO_STAGE[trl]
    sol_stage = row.get("solution_stage")
    if sol_stage:
        s = str(sol_stage).strip()
        return s[:16] + ("…" if len(s) > 16 else "")
    return None


# ─── Project name derivation ────────────────────────────────────────────


def derive_project_name(row: dict | None) -> str | None:
    """Short project name for the leadership Applications table.

    Takes the first sentence (or first 60 chars) of `solution_describe`.
    Falls back to `basic_org` so the cell isn't blank. Returns None only
    when nothing is available — the frontend then renders "—".
    """
    if not row:
        return None
    text = (row.get("solution_describe") or "").strip()
    if text:
        first = text.split(".")[0].split("\n")[0].strip()
        if len(first) > 60:
            return first[:57] + "…"
        return first or None
    org = (row.get("basic_org") or "").strip()
    return org or None


# ─── Display ID derivation ──────────────────────────────────────────────


def compose_display_id(track: str, app_id: str | None) -> str:
    """Stable short identifier for the table + emails (e.g. ``TIR-26225``).

    Last 5 decimal digits of the uuid's first 8 hex chars interpreted as
    a number. Deterministic per row.
    """
    prefix = (track or "?").upper()
    if not app_id:
        return f"{prefix}-?????"
    try:
        n = int(str(app_id).replace("-", "")[:8], 16) % 100_000
        return f"{prefix}-{n:05d}"
    except (ValueError, TypeError):
        return f"{prefix}-{str(app_id)[:5]}"


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
            .limit(10_000)
            .execute()
        )
        rows = res.data or []
        return [float(r["score_overall"]) for r in rows if r.get("score_overall") is not None]
    except Exception as exc:
        log.warning("stats.fetch_ai_score_overalls failed", extra={"err": str(exc)})
        return []


# ─── Industry source rows ──────────────────────────────────────────────


def fetch_classification_rows(track: str) -> list[dict]:
    """Return the wizard text fields from non-draft apps on `track`.

    Used by the dashboard's industry breakdown. The returned dicts are
    fed to ``classify_industry()`` which concatenates the fields and runs
    the keyword pass. We project only the four classifier fields so the
    payload stays small even with thousands of rows. These four columns
    exist on both tir_applications and sip_applications (see migrations
    005 / 011), so a single projection is safe across tracks.
    """
    try:
        res = (
            get_admin_client()
            .table(_track_table(track))
            .select("basic_org,solution_describe,solution_core_tech,problem_describe")
            .neq("status", "draft")
            .limit(10_000)
            .execute()
        )
        return res.data or []
    except Exception as exc:
        log.warning(
            "stats.fetch_classification_rows failed",
            extra={"track": track, "err": str(exc)},
        )
        return []


def fetch_org_texts(track: str) -> list[str]:
    """Backward-compat: returns basic_org strings only.

    Kept for callers that haven't migrated to fetch_classification_rows
    yet. Internally just projects basic_org from fetch_classification_rows.
    Prefer the multi-field version for new code.
    """
    return [r["basic_org"] for r in fetch_classification_rows(track) if r.get("basic_org")]
