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
    ("screening_failed", "Screening failed"),
    ("under_review", "Under review"),
    ("evaluated",    "Evaluated"),
    ("on_hold",      "On hold"),
    ("shortlisted",  "Shortlisted"),
    ("jury_review",  "Jury review"),
    ("interview",    "Interview"),
    ("offered",      "Offered"),
    ("onboarded",    "Onboarded"),
    ("accepted",     "Accepted"),
    ("rejected",     "Rejected"),
    ("waitlisted",   "Waitlisted"),
    ("withdrawn",    "Withdrawn"),
]


def effective_status(
    application_status: str | None,
    admin_decision: str | dict | None = None,
) -> str | None:
    """Map the admin portal's latest decision to the shared display status.

    A shortlist (gate-1 `jury_review`) decision is the final round, NOT an
    acceptance — it used to be relabelled 'accepted', which hid every
    final-round app behind a label nothing on prod had earned. Only a real
    acceptance maps to 'accepted'. A raw status that is already past the
    decision (offered/onboarded/...) is never rolled back by an older decision.
    """
    if application_status in _POST_DECISION_STATUSES:
        return application_status
    decision = admin_decision
    if isinstance(decision, dict):
        decision = decision.get("decision")
    decision = str(decision or "").strip().lower()
    if decision in {"accepted", "approved", "selected"}:
        return "accepted"
    if decision in {"shortlisted", "jury_review"}:
        return "jury_review"
    if decision in {"rejected", "reject"}:
        return "rejected"
    return application_status


_POST_DECISION_STATUSES = frozenset({"offered", "onboarded", "waitlisted", "withdrawn", "on_hold"})


# Statuses that count as "submitted" for the totals.apps_submitted figure —
# everything except 'draft'.
NON_DRAFT_STATUSES: list[str] = [s for s, _ in PHASE_1_STATUSES]

# Funnel buckets: each entry collapses 0..n statuses into a single column.
# The dashboard renders these as the 5-step funnel (profiles → submitted →
# in_review → advanced → decided).
FUNNEL_BUCKETS: dict[str, list[str]] = {
    "submitted":  NON_DRAFT_STATUSES,
    "in_review":  ["ai_screening", "under_review"],
    "advanced":   ["shortlisted", "interview", "jury_review"],
    "decided":    ["offered", "onboarded"],
}

# Statuses that mean "advanced past review" for the totals card. Spec §4.8.
ADVANCED_PAST_REVIEW: list[str] = ["shortlisted", "interview", "jury_review", "offered", "onboarded"]

TRACKS: list[str] = ["tir", "sip"]


# ─── Gate-aware pipeline breakdown (contract C1) ────────────────────────
#
# Every non-draft application lands in exactly ONE stage, so the stages sum
# to the non-draft total. Built from the RAW status (no decision overlay),
# the latest admin_decisions row per (app, gate_stage), and the current
# (non-superseded) ic_documents:
#   final_rejected = rejected AND latest gate2 decision is 'rejected'
#   gate1_rejected = any other rejected (incl. rejected with no decision row)
#   final_selected = jury_review AND >=1 current IC doc AND all of them signed
#   final_pending  = any other jury_review
PIPELINE_STAGES: list[str] = [
    "submitted", "under_review", "reviewed", "gate1_rejected", "final_pending",
    "final_rejected", "final_selected", "offered", "onboarded", "on_hold",
    "waitlisted", "withdrawn",
]

# Stages that have passed the first gate.
GATE1_SELECTED_STAGES: tuple[str, ...] = (
    "final_pending", "final_rejected", "final_selected", "offered", "onboarded",
)

_STAGE_OF_STATUS: dict[str, str] = {
    "submitted": "submitted", "ai_screening": "submitted", "screening_failed": "submitted",
    "under_review": "under_review",
    "evaluated": "reviewed",
    # Legacy pre-jury statuses (0 rows on prod): past gate 1, outcome pending.
    "shortlisted": "final_pending", "interview": "final_pending",
    "accepted": "final_selected",
    "offered": "offered", "onboarded": "onboarded", "on_hold": "on_hold",
    "waitlisted": "waitlisted", "withdrawn": "withdrawn",
}

_PAGE = 1000


def _fetch_all(make_query) -> list[dict]:
    """Read every row of a query, paging past PostgREST's ~1000-row cap."""
    rows: list[dict] = []
    offset = 0
    while True:
        chunk = (make_query().range(offset, offset + _PAGE - 1).execute().data) or []
        rows.extend(chunk)
        if len(chunk) < _PAGE:
            return rows
        offset += _PAGE


def pipeline_stage(status: str | None, gate2_decision: str | None,
                   ic_all_signed: bool) -> str | None:
    """Stage key for one app (None for drafts). Unknown statuses fall into
    'submitted' so the stages always sum to the total."""
    if not status or status == "draft":
        return None
    if status == "rejected":
        return "final_rejected" if gate2_decision == "rejected" else "gate1_rejected"
    if status == "jury_review":
        return "final_selected" if ic_all_signed else "final_pending"
    return _STAGE_OF_STATUS.get(status, "submitted")


def latest_decisions_by_gate(rows: list[dict]) -> dict[tuple[str, str, str], str]:
    """{(native track, application_id, gate_stage): latest decision}."""
    latest: dict[tuple[str, str, str], dict] = {}
    for row in rows:
        key = (row.get("application_track"), row.get("application_id"),
               row.get("gate_stage") or "gate1")
        if not key[0] or not key[1]:
            continue
        old = latest.get(key)
        if old is None or (row.get("decided_at") or "") >= (old.get("decided_at") or ""):
            latest[key] = row
    return {k: v.get("decision") for k, v in latest.items()}


def ic_all_signed_keys(rows: list[dict]) -> set[tuple[str, str]]:
    """(native track, id) of apps whose current IC documents exist and are ALL signed."""
    current: dict[tuple[str, str], list[bool]] = {}
    for r in rows:
        if r.get("superseded_at"):
            continue
        current.setdefault((r.get("application_track"), r.get("application_id")), []).append(
            bool(r.get("signed_at")))
    return {k for k, v in current.items() if v and all(v)}


def _empty_bucket() -> dict:
    return {"total": 0, "stages": {s: 0 for s in PIPELINE_STAGES}}


def _finish_bucket(b: dict) -> dict:
    st = b["stages"]
    b["gate1_selected"] = sum(st[s] for s in GATE1_SELECTED_STAGES)
    b["rejected_total"] = st["gate1_rejected"] + st["final_rejected"]
    return b


def stage_for_app(app: dict, decisions: dict, signed: set) -> str | None:
    """Stage of one app row (``track`` = native) given the outputs of
    ``latest_decisions_by_gate`` and ``ic_all_signed_keys``."""
    key = (app.get("track"), app.get("id"))
    return pipeline_stage(app.get("status"),
                          decisions.get((key[0], key[1], "gate2")),
                          key in signed)


def build_pipeline_breakdown(apps: list[dict], decision_rows: list[dict],
                             ic_rows: list[dict]) -> dict:
    """Pure: the C1 ``pipeline_breakdown`` block. `apps` rows carry
    ``track`` (native), ``id``, ``status``, ``moved_to_track``; by_track uses
    the EFFECTIVE track."""
    decisions = latest_decisions_by_gate(decision_rows)
    signed = ic_all_signed_keys(ic_rows)
    out = _empty_bucket()
    by_track = {t: _empty_bucket() for t in TRACKS}
    for a in apps:
        stage = stage_for_app(a, decisions, signed)
        if stage is None:
            continue
        out["total"] += 1
        out["stages"][stage] += 1
        eff = by_track.get(a.get("moved_to_track") or a.get("track"))
        if eff is not None:
            eff["total"] += 1
            eff["stages"][stage] += 1
    _finish_bucket(out)
    out["by_track"] = {t: _finish_bucket(b) for t, b in by_track.items()}
    return out


def fetch_app_status_rows() -> list[dict]:
    """Every application row (drafts included) on both tables, projected to
    id/user_id/status/moved_to_track and stamped with its NATIVE ``track``."""
    out: list[dict] = []
    for track in TRACKS:
        try:
            sb = get_admin_client()
            rows = _fetch_all(lambda: sb.table(_track_table(track))
                              .select("id,user_id,status,moved_to_track").order("id"))
        except Exception as exc:
            log.warning("stats.fetch_app_status_rows failed",
                        extra={"track": track, "err": str(exc)})
            continue
        out.extend({**r, "track": track} for r in rows)
    return out


def fetch_decision_rows() -> list[dict]:
    """All admin_decisions rows (paginated)."""
    try:
        sb = get_admin_client()
        return _fetch_all(lambda: sb.table("admin_decisions").select(
            "application_id,application_track,gate_stage,decision,decided_at").order("id"))
    except Exception as exc:
        log.warning("stats.fetch_decision_rows failed", extra={"err": str(exc)})
        return []


def fetch_ic_rows() -> list[dict]:
    """All ic_documents rows' signing state (paginated; superseded filtered later)."""
    try:
        sb = get_admin_client()
        return _fetch_all(lambda: sb.table("ic_documents").select(
            "application_id,application_track,signed_at,superseded_at").order("id"))
    except Exception as exc:
        log.warning("stats.fetch_ic_rows failed", extra={"err": str(exc)})
        return []


# ai_screening column per dashboard component (score_completeness = "solution").
AI_COMPONENT_COLUMNS: dict[str, str] = {
    "problem":    "score_problem",
    "solution":   "score_completeness",
    "tech":       "score_tech",
    "founders":   "score_founders",
    "commitment": "score_commitment",
}


def fetch_ai_component_stats(non_draft: set[tuple[str, str]]) -> dict:
    """Real per-component AI means over non-draft apps + how many are scored.

    Returns ``{"ai_component_means": {component: mean | None},
    "ai_scored_count": n}`` where n = non-draft apps with a score_overall.
    """
    cols = ",".join(["application_id", "application_track", "score_overall",
                     *AI_COMPONENT_COLUMNS.values()])
    try:
        sb = get_admin_client()
        rows = _fetch_all(lambda: sb.table("ai_screening").select(cols).order("application_id"))
    except Exception as exc:
        log.warning("stats.fetch_ai_component_stats failed", extra={"err": str(exc)})
        rows = []
    rows = [r for r in rows
            if (r.get("application_track"), r.get("application_id")) in non_draft]
    means: dict[str, float | None] = {}
    for key, col in AI_COMPONENT_COLUMNS.items():
        vals = [float(r[col]) for r in rows if r.get(col) is not None]
        means[key] = round(sum(vals) / len(vals), 2) if vals else None
    scored = sum(1 for r in rows if r.get("score_overall") is not None)
    return {"ai_component_means": means, "ai_scored_count": scored}


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


def _other_track(track: str) -> str:
    return "sip" if track == "tir" else "tir"


def _base_count(table: str, *, status: str | None, non_draft: bool,
                moved_to: str | None) -> int:
    """One HEAD-style count on `table` with the given status filter. When
    `moved_to` is set, also require ``moved_to_track == moved_to`` (uses only
    ``.eq``, which every backend — real and the test double — honours)."""
    q = get_admin_client().table(table).select("id", count="exact")
    if status is not None:
        q = q.eq("status", status)
    if non_draft:
        q = q.neq("status", "draft")
    if moved_to is not None:
        q = q.eq("moved_to_track", moved_to)
    return (q.execute().count or 0)


def _effective_count(track: str, *, status: str | None, non_draft: bool) -> int:
    """count(*) of rows whose EFFECTIVE track is `track`, under the track-move
    overlay. Computed with only ``.eq`` filters (no ``IS NULL``) so it's
    backend-agnostic:  rows here that were NOT moved away
    (= all here − moved-to-other) + rows in the other table moved into here.
    """
    other = _other_track(track)
    here_all = _base_count(_track_table(track), status=status,
                           non_draft=non_draft, moved_to=None)
    moved_away = _base_count(_track_table(track), status=status,
                             non_draft=non_draft, moved_to=other)
    moved_in = _base_count(_track_table(other), status=status,
                           non_draft=non_draft, moved_to=track)
    return (here_all - moved_away) + moved_in


def count_apps_by_status(track: str, status: str) -> int:
    """count(*) of applications whose EFFECTIVE track is `track` with `status`.

    Track-move overlay: native rows here not moved away, plus rows in the other
    table moved into this track. Returns 0 on error so one failing cell doesn't
    take down the whole dashboard.
    """
    try:
        return _effective_count(track, status=status, non_draft=False)
    except Exception as exc:
        log.warning(
            "stats.count_apps_by_status failed",
            extra={"track": track, "status": status, "err": str(exc)},
        )
        return 0


def count_apps_total(track: str) -> int:
    """count(*) of all non-draft applications whose EFFECTIVE track is `track`."""
    try:
        return _effective_count(track, status=None, non_draft=True)
    except Exception as exc:
        log.warning(
            "stats.count_apps_total failed",
            extra={"track": track, "err": str(exc)},
        )
        return 0


def count_ai_screening_rows() -> int:
    """count(*) of ai_screening rows — i.e. apps that have been AI-screened.

    Used by the dashboard funnel's "in review" stage. Counts rows across
    both tracks (the table is keyed by (application_id, application_track)).
    An app that has been screened has exactly one row, so this is a clean
    proxy for "reached AI review" even when the app's status hasn't been
    advanced past `submitted` (e.g. scores written by the backfill script).
    """
    try:
        res = (
            get_admin_client()
            .table("ai_screening")
            .select("application_id", count="exact")
            .execute()
        )
        return res.count or 0
    except Exception as exc:
        log.warning("stats.count_ai_screening_rows failed", extra={"err": str(exc)})
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
