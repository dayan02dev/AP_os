"""Agreement template loading + Facility-Agreement-specific substitution and
rendering.

The template JSON (produced by scripts/extract_agreement_template.py — see
that module's docstring) is generic: an ordered list of paragraph/table
blocks with "[•]" markers preserved verbatim. Everything below — which
paragraph indices are the repeatable collaborator clauses, which need the
collaborator list-sentence regenerated, which table cells are ARTPARK's
facilities allocation — is knowledge specific to the Facility Agreement's
actual structure, confirmed by direct inspection of the source .docx
(backend/scripts/source_docs/facility_agreement_2026-08-06.docx). A future
second agreement (Collaboration Agreement) gets its own rule set; nothing
here is meant to generalize automatically.

FAIL-CLOSED BY DESIGN. This module must never emit a document — preview
text or signed PDF bytes — containing a literal "[•]", "[month]" or "[date]"
token, and it must never silently substitute a blank. Two independent
guards enforce this on every render:

  1. _require_constants_configured() runs before a single block is
     resolved, and refuses to proceed (raising ValueError naming exactly
     which constants are still unset) while any ARTPARK business constant
     below is still the UNSET sentinel.
  2. _resolve_blocks() re-scans every block's text AFTER substitution and
     raises if any placeholder token is still present — a safety net that
     also catches a constant whose *value* is itself a stray placeholder
     token, and catches a future template edit adding a "[•]" this module
     doesn't yet know how to fill.

render_agreement_pdf() (the signed-document renderer) shares _resolve_blocks
with render_preview_text() (what the founder reviews before signing) so the
two can never drift from each other — whatever the founder previewed is
exactly what gets rendered into the signed PDF.
"""
from __future__ import annotations

import json
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path

_TEMPLATE_DIR = Path(__file__).resolve().parent / "agreements"
_BULLET = "[•]"
_LEFTOVER_TOKENS = (_BULLET, "[month]", "[date]")


# ══════════════════════════════════════════════════════════════════════════
# ARTPARK CONSTANTS — UNSET. CONFIRM WITH ARTPARK OPS/LEGAL BEFORE PROD USE.
#
# These are the Facility Agreement's business/legal terms that are the same
# for every founder who signs it (as distinct from the founder-supplied
# party details, which come from the request body). As of this commit,
# ARTPARK has not supplied real values for any of them. Every entry below is
# deliberately `None` — the UNSET sentinel.
#
# DO NOT invent plausible-looking numbers here. A fabricated contract term
# baked into a signed legal document is the single worst outcome this module
# can produce. render_preview_text() and render_agreement_pdf() both call
# _require_constants_configured() before touching a single block, and both
# refuse to run — raising ValueError naming exactly which of the entries
# below are still unset — until every one of them has been replaced with a
# real, ARTPARK-confirmed value.
#
# Count: 3 named scalar constants (term_months, insurance_limit,
# collaboration_agreement_date) + 6 Schedule II availability windows = 9
# distinct entries to fill in, covering all 10 blank *positions* in the
# source document — term_months alone fills TWO separate "[•]" blanks at
# paragraph 34 ("...for a period of [•] ([•]) months...": the numeral and
# its word form, looked up via _MONTH_WORDS below), so one real value
# resolves both.
#
# NOTE: the execution "[month]"/"[date]" tokens at paragraphs 1 and 19 are
# NOT here. Per the design spec, those use a different bracket syntax on
# purpose because they are not a fixed business constant at all — they are
# the actual calendar date the document is generated/signed on, computed at
# render time by _execution_month_day() below. There is nothing to
# configure for them and nothing to leave unset.
# ══════════════════════════════════════════════════════════════════════════
TEMPLATE_CONSTANTS: dict[str, dict] = {
    "facility-v1": {
        # Term length in months (paragraph 34: "...for a period of [•]
        # ([•]) months..."). Fills BOTH occurrences — the numeral and its
        # word form via _MONTH_WORDS. UNSET.
        "term_months": None,
        # Public liability insurance minimum, per occurrence (paragraph 88:
        # "Public liability insurance with a limit of not less than [•] per
        # occurrence"). e.g. an amount with currency and words, ARTPARK's
        # call — not this codebase's. UNSET.
        "insurance_limit": None,
        # Date of the separate Collaboration Agreement referenced at
        # paragraph 13 ("...entered into a Collaboration Agreement dated
        # [•]..."). UNSET.
        "collaboration_agreement_date": None,
        # Schedule II ("SCHEDULE II: FACILITIES", the 7x5 table): ARTPARK's
        # Availability Window commitment for each facility row, in the
        # document's own row order. All six are UNSET.
        "availability_windows": {
            "dedicated_seating": None,
            "lab_space": None,
            "computing": None,
            "wifi": None,
            "conference_rooms": None,
            "access_badge": None,
        },
    },
}

_MONTH_WORDS = {
    1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six",
    7: "seven", 8: "eight", 9: "nine", 10: "ten", 11: "eleven", 12: "twelve",
    18: "eighteen", 24: "twenty-four", 36: "thirty-six",
}

_COLLAB_FIELDS = ("name", "pan", "parent_name", "address")
# (AND-paragraph index, clause-paragraph index) per collaborator slot, in
# document order. Confirmed directly against the source .docx: paragraph 3
# ("AND") precedes paragraph 4 (Collaborator 1's clause); 5/6 is
# Collaborator 2; 7/8 is Collaborator 3.
_COLLAB_BLOCK_INDICES = [(3, 4), (5, 6), (7, 8)]
_LIST_SENTENCE_INDEX = 9
_COLLAB_AGREEMENT_DATE_INDEX = 13
_TERM_INDEX = 34
_INSURANCE_INDEX = 88
_EXECUTION_DATE_PARAGRAPH_INDICES = (1, 19)
_FACILITIES_TABLE_INDEX = 126
_AVAILABILITY_ORDER = (
    "dedicated_seating", "lab_space", "computing", "wifi",
    "conference_rooms", "access_badge",
)


def _is_unset(value: object) -> bool:
    if value is None:
        return True
    if isinstance(value, str) and not value.strip():
        return True
    return False


def _missing_constants(slug: str) -> list[str]:
    """Names of every still-unset entry in TEMPLATE_CONSTANTS[slug], in a
    stable, human-readable order."""
    c = TEMPLATE_CONSTANTS[slug]
    missing = [
        key
        for key in ("term_months", "insurance_limit", "collaboration_agreement_date")
        if _is_unset(c.get(key))
    ]
    missing += [
        f"availability_windows.{key}"
        for key in _AVAILABILITY_ORDER
        if _is_unset(c.get("availability_windows", {}).get(key))
    ]
    return missing


def _require_constants_configured(slug: str) -> None:
    missing = _missing_constants(slug)
    if missing:
        raise ValueError(
            f"Cannot render agreement {slug!r}: ARTPARK has not supplied real "
            "values for the following contract constants: "
            + ", ".join(missing)
            + ". These are legal terms — do not guess them. Set them in "
            f"TEMPLATE_CONSTANTS[{slug!r}] in app/services/agreements.py "
            "only once ARTPARK ops/legal has confirmed the real value."
        )


@lru_cache
def _load_template(slug: str) -> dict:
    return json.loads((_TEMPLATE_DIR / f"{slug}.json").read_text(encoding="utf-8"))


def _fill_bullets(text: str, values: list[str]) -> str:
    parts = text.split(_BULLET)
    if len(parts) - 1 != len(values):
        raise ValueError(
            f"placeholder count mismatch: {text!r} expects {len(parts) - 1}, got {len(values)}"
        )
    out = parts[0]
    for v, p in zip(values, parts[1:]):
        out += str(v) + p
    return out


def _collaborator_list_sentence(n: int) -> str:
    labels = [f"Collaborator {i + 1}" for i in range(n)]
    if n == 1:
        return f'{labels[0]} shall be referred to as "Collaborator".'
    joined = f"{', '.join(labels[:-1])} and {labels[-1]}" if n > 2 else " and ".join(labels)
    return (
        f'{joined} shall be individually referred to as "Collaborator" and '
        'collectively referred to as "Collaborators".'
    )


def _execution_month_day(now: datetime | None = None) -> tuple[str, str]:
    """The Execution/Effective Date stamped into paragraphs 1 and 19.

    Uses the literal "[month]"/"[date]" bracket convention (not "[•]")
    specifically because — per the design spec — this is NOT an ARTPARK
    business constant. It is the actual calendar date the document is being
    generated/signed on, computed here from the current time. There is
    nothing to configure and nothing that can be "left unset": this always
    resolves.
    """
    now = now or datetime.now(UTC)
    return now.strftime("%B"), str(now.day)


def _resolve_blocks(collaborators: list[dict], slug: str = "facility-v1") -> list[dict]:
    """Load the committed template for `slug` and return a fully-resolved
    list of blocks: collaborator clauses filled in (unused slots dropped
    entirely), the list-sentence regenerated for the actual collaborator
    count, ARTPARK constants substituted, and the facilities schedule table
    filled in. Raises ValueError (never returns a partial result) if
    constants are unset or if any block still contains a placeholder token
    after substitution.
    """
    if not 1 <= len(collaborators) <= 3:
        raise ValueError(f"1 to 3 collaborators required, got {len(collaborators)}")
    _require_constants_configured(slug)

    c = TEMPLATE_CONSTANTS[slug]
    raw = _load_template(slug)["blocks"]
    execution_month, execution_date = _execution_month_day()

    dropped_collab_indices = {
        i for pair in _COLLAB_BLOCK_INDICES[len(collaborators):] for i in pair
    }
    filled_collab_indices = {
        i for pair in _COLLAB_BLOCK_INDICES[: len(collaborators)] for i in pair
    }

    resolved: list[dict] = []
    for block in raw:
        idx = block["index"]
        if idx in dropped_collab_indices:
            # Unused collaborator slots are dropped whole (both the "AND"
            # connector and the clause paragraph) — never rendered as an
            # empty "[•]" line.
            continue

        if block["type"] == "table":
            if idx == _FACILITIES_TABLE_INDEX:
                rows = [list(r) for r in block["rows"]]
                for row_i, key in enumerate(_AVAILABILITY_ORDER, start=1):
                    rows[row_i][3] = c["availability_windows"][key]
                block = {**block, "rows": rows}
            for row in block["rows"]:
                for cell in row:
                    if isinstance(cell, str) and any(tok in cell for tok in _LEFTOVER_TOKENS):
                        raise ValueError(
                            f"placeholder survived resolution in table {idx}, row {row!r}"
                        )
            resolved.append(block)
            continue

        text = block["text"]
        if idx in filled_collab_indices and block["placeholder_count"]:
            slot = next(i for i, pair in enumerate(_COLLAB_BLOCK_INDICES) if idx in pair)
            values = [str(collaborators[slot][f]) for f in _COLLAB_FIELDS]
            text = _fill_bullets(text, values)
        elif idx == _LIST_SENTENCE_INDEX:
            text = _collaborator_list_sentence(len(collaborators))
        elif idx == _COLLAB_AGREEMENT_DATE_INDEX:
            text = _fill_bullets(text, [c["collaboration_agreement_date"]])
        elif idx == _TERM_INDEX:
            words = _MONTH_WORDS.get(c["term_months"])
            if words is None:
                raise ValueError(
                    f"no word form registered for term_months={c['term_months']!r} "
                    "— add it to _MONTH_WORDS"
                )
            text = _fill_bullets(text, [str(c["term_months"]), words])
        elif idx == _INSURANCE_INDEX:
            text = _fill_bullets(text, [c["insurance_limit"]])

        if idx in _EXECUTION_DATE_PARAGRAPH_INDICES:
            text = text.replace("[month]", execution_month).replace("[date]", execution_date)

        if any(tok in text for tok in _LEFTOVER_TOKENS):
            raise ValueError(f"placeholder survived resolution in block {idx}: {text!r}")

        resolved.append({**block, "text": text})
    return resolved


def render_preview_text(collaborators: list[dict], slug: str = "facility-v1") -> str:
    """Plain-text rendering of the resolved agreement — what the founder
    reads before signing. Shares _resolve_blocks with the PDF renderer so
    preview and signed document can never diverge."""
    blocks = _resolve_blocks(collaborators, slug)
    lines = []
    for b in blocks:
        if b["type"] == "paragraph":
            lines.append(b["text"])
        else:
            for row in b["rows"]:
                lines.append(" | ".join(row))
    return "\n".join(lines)


def agreements_for_track(track: str) -> list[dict]:
    """Which agreements a founder on `track` must sign, and the field schema
    for each. Collaboration Agreement is intentionally absent for every
    track until a revisions-accepted draft exists (see the design spec's
    §3 blocker) — Facility ships for both TIR and VIP/SIP.
    """
    return [
        {
            "slug": "facility-v1",
            "name": "Facility Agreement",
            "min_collaborators": 1,
            "max_collaborators": 3,
            "fields": [
                {"key": "name", "label": "Full legal name"},
                {"key": "pan", "label": "PAN"},
                {"key": "parent_name", "label": "Father's / Mother's / Spouse's name (s/o, d/o)"},
                {"key": "address", "label": "Residential address"},
            ],
        }
    ]
