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
import re

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


# DEPRECATED 2026-05-20 — the leadership list endpoint now reads industry
# from ai_screening.industry_category_id (joined to industry_categories).
# Kept for one release so any in-flight callers don't break; delete after
# 100% of apps have industry_category_id populated.
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
    text = _row_classify_text(source) if isinstance(source, dict) else str(source)
    if not text.strip():
        return OTHER_BUCKET
    s = text.lower()
    for bucket_id, label, keywords in INDUSTRY_BUCKETS:
        for kw in keywords:
            if kw in s:
                return (bucket_id, label)
    return OTHER_BUCKET


# ─── Stage label derivation (spec §4) ────────────────────────────────────
#
# Used by the leadership Applications table's "Stage" column. TIR applicants
# pick `solution_stage` from a closed enum; SIP applicants pick `sip_traction`.
# We collapse both to a short label that fits the table cell while keeping
# the raw value available for hover (frontend reads `raw` into a title attr).

# TIR: solution_stage → short label (spec §4a)
_TIR_STAGE_MAP: dict[str, str] = {
    "Still exploring":                              "Exploring",
    "Literature / research stage":                  "Research",
    "Simulations completed":                        "Simulation",
    "Lab demos / proof of concept":                 "Lab demo",
    "Prototype built":                              "Prototype",
    "Pilot-ready product":                          "Pilot-ready",
    "Deployed in real setting with real users":     "Deployed",
}

# SIP: sip_traction → short label (spec §4b)
_SIP_STAGE_MAP: dict[str, str] = {
    "Pre-revenue — building toward our first pilot":          "Pre-revenue",
    "Active pilots (paid or unpaid) with design partners":    "Active pilots",
    "Paying pilots — customers have paid for early access":   "Paying pilots",
    "Live paying customers — repeat revenue":                 "Live revenue",
}


def derive_stage_label(row: dict | None) -> dict | None:
    """Return ``{"raw": <original>, "label": <short>}`` or None.

    Per-track maps; falls back to using ``raw`` as ``label`` when the raw
    text isn't in the map (better than dropping the cell entirely). Returns
    None only when no source field is populated.

    For SIP, if `sip_traction` is missing, falls back to `sip_trl`.
    """
    if not row:
        return None
    track = (row.get("track") or "").lower()

    if track == "tir":
        raw = row.get("solution_stage")
        if not raw:
            return None
        return {"raw": raw, "label": _TIR_STAGE_MAP.get(raw, raw)}

    if track == "sip":
        raw = row.get("sip_traction")
        if raw:
            return {"raw": raw, "label": _SIP_STAGE_MAP.get(raw, raw)}
        trl = row.get("sip_trl")
        if trl:
            return {"raw": trl, "label": str(trl)[:24]}
        return None

    # Unknown / missing track — try both fields opportunistically.
    raw = row.get("solution_stage") or row.get("sip_traction")
    if not raw:
        return None
    return {
        "raw": raw,
        "label": _TIR_STAGE_MAP.get(raw, _SIP_STAGE_MAP.get(raw, raw)),
    }


# ─── Project name derivation (spec §2) ──────────────────────────────────

# Case-insensitive filler prefixes stripped from the start of the derived
# name so the cell focuses on what the venture actually does.
_PROJECT_FILLER_PREFIXES: tuple[str, ...] = (
    "we are building ",
    "we're building ",
    "we are developing ",
    "we're developing ",
    "we are creating ",
    "we're creating ",
    "we are working on ",
    "we're working on ",
    "our solution is ",
    "our product is ",
    "my solution is ",
    "my product is ",
    "the solution is ",
    "this is ",
    "to ",
    "a ",
    "an ",
    "the ",
)

# Leading non-letter junk: ">>>", "***", "1.", "1)", bullet dashes, etc.
# Anchored so it only fires on prefix garbage — we don't want to strip
# legit dashes in the middle of a name.
_LEADING_NOISE_RE = re.compile(r"^[\s>#*\-•\d().:;]+")

# Document-style labels people sometimes prefix to the answer field:
# "Solution: ...", "Answer: ...", "Q11: ...", "Section 2:". Strip the
# label so the descriptive sentence underneath becomes the candidate.
_LABEL_PREFIX_RE = re.compile(
    r"^(?:solution|answer|response|description|problem|q\s*\d+|section\s*\d+)\s*[:\-]\s*",
    re.IGNORECASE,
)

# Subject-verb preamble: "<1-3 word subject> is/are/builds/aims-to/etc.
# [purpose phrase] [article]". Strips brand-name preambles like
# "Foucault is a", "Lino is designed to", "Olive Orange is an", so the
# 4-word window lands on the actual product description.
_SUBJECT_VERB_RE = re.compile(
    r"""
    ^
    (?:[A-Za-z][\w\-']*)            # subject word 1
    (?:\s+[A-Za-z][\w\-']*){0,2}    # optionally 2 more subject words
    \s+
    (?:                              # linking / action verb
        is | are | was | were |
        will\s+be | has\s+been | have\s+been |
        provides? | offers? | delivers? | enables? |
        builds? | creates? | develops? | designs? |
        aims\s+to | seeks\s+to | strives\s+to |
        focuses\s+on | works\s+on
    )
    \s+
    (?:                              # optional purpose phrase / article
        designed\s+to\s+ | built\s+to\s+ | meant\s+to\s+ |
        going\s+to\s+ | here\s+to\s+ | able\s+to\s+ |
        a\s+ | an\s+ | the\s+ | that\s+ | which\s+
    )?
    """,
    re.IGNORECASE | re.VERBOSE,
)

# Max words shown in the table cell. Leadership wants a 3-4 word
# scan-able label, not a full sentence (spec §2 v2).
_PROJECT_MAX_WORDS = 4


def _strip_filler_prefix(text: str) -> str:
    """Drop a leading filler prefix (case-insensitive) if any matches."""
    lower = text.lower()
    for filler in _PROJECT_FILLER_PREFIXES:
        if lower.startswith(filler):
            return text[len(filler):].lstrip()
    return text


def _strip_all_filler(text: str) -> str:
    """Iteratively strip stacked filler prefixes."""
    prev = None
    while prev != text:
        prev = text
        text = _strip_filler_prefix(text)
    return text


def _strip_subject_verb_preamble(text: str) -> str:
    """If the sentence starts with a short '<Subject> is/aims-to/etc.'
    preamble, drop it so the descriptive noun phrase becomes the head.

    Only fires when the remainder still contains a real word — otherwise
    we'd over-strip "Pet healthcare is needed" down to "needed".
    """
    m = _SUBJECT_VERB_RE.match(text)
    if not m:
        return text
    rest = text[m.end():].strip()
    if not rest or not any(c.isalpha() for c in rest):
        return text
    # If what's left is a single word or starts with another preamble verb,
    # the strip probably went too deep — keep the original.
    if len(rest.split()) < 2:
        return text
    return rest


def derive_project_name(row: dict | None) -> str | None:
    """Short 3-4 word project name for the leadership Applications table.

    Goal: the cell should describe what the project *does*, not echo the
    brand-name preamble. So "Foucault is a full-stack defense platform"
    becomes "Full-stack defense platform", not "Foucault is a full-stack".

    Algorithm:
      1. Source ``solution_describe``; fall back to ``basic_org``.
      2. Take the first sentence.
      3. Strip leading noise (">>>", "*", "1.", etc.) and label prefixes
         ("Solution:", "Q11:").
      4. Iteratively strip filler ("We're building ", "A ", "The ", "To ").
      5. Strip a short "<Subject> is/are/builds/aims-to [a/an/the]"
         preamble if one is present.
      6. Strip filler again (handles "Lino is designed to a foo" → "foo").
      7. Take the first 4 words. Capitalize. Append ``…`` if truncated.
    """
    if not row:
        return None
    text = (row.get("solution_describe") or "").strip()
    if not text:
        org = (row.get("basic_org") or "").strip()
        return org or None

    # Step 2: first sentence
    first = text
    for sep in (". ", "? ", "! ", "\n"):
        first = first.split(sep)[0]
    first = first.strip().rstrip(".?!,;:")

    # Step 3: leading noise + label prefix
    first = _LEADING_NOISE_RE.sub("", first).strip()
    first = _LABEL_PREFIX_RE.sub("", first).strip()

    # Step 4: strip filler — iterate so "Our solution is a robot" → "robot"
    first = _strip_all_filler(first)

    # Step 5: strip a brand-name preamble like "Foucault is a"
    first = _strip_subject_verb_preamble(first)

    # Step 6: strip filler again after preamble strip
    first = _strip_all_filler(first)

    if not first:
        return None

    # Step 7: first 4 words
    words = first.split()
    truncated = len(words) > _PROJECT_MAX_WORDS
    capped = " ".join(words[:_PROJECT_MAX_WORDS])
    # Strip trailing punctuation introduced by partial truncation.
    capped = capped.rstrip(",.;:- ")
    if not capped:
        return None

    # If after truncation we're left with something that doesn't look like
    # a word (e.g. "1" because the sentence started with a list marker),
    # fall back to basic_org so the cell isn't an opaque single character.
    has_letter = any(c.isalpha() for c in capped)
    if not has_letter:
        org = (row.get("basic_org") or "").strip()
        return org or None

    if truncated:
        capped = f"{capped}…"

    return capped[0].upper() + capped[1:]


# ─── Display ID derivation (spec §5) ────────────────────────────────────


def compose_display_id(track: str, display_seq: int | str | None) -> str:
    """Render the human-readable per-track ID, e.g. ``TIR-26013``.

    ``display_seq`` is the integer from the ``{track}_display_seq`` sequence
    (populated by migration 017). Returns ``<TRACK>-?????`` when the seq is
    missing — rows where the migration hasn't been applied yet will show
    this placeholder.
    """
    prefix = (track or "?").upper()
    if display_seq is None or display_seq == "":
        return f"{prefix}-?????"
    try:
        return f"{prefix}-{int(display_seq)}"
    except (TypeError, ValueError):
        return f"{prefix}-?????"


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
