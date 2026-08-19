"""Agreement template loading + per-agreement substitution and rendering.

TIR founders sign TWO agreements: the Facility Agreement ("facility-v1")
and the Collaboration Agreement ("collaboration-v1"). VIP/SIP founders sign
Facility only. Which agreements apply to which track is data
(TRACK_AGREEMENTS below), not a branch in the renderer -- adding or
removing an agreement for a track is a one-line data change, never new
render logic.

The template JSON for each (produced by scripts/extract_agreement_template.py)
is generic: an ordered list of paragraph/table blocks with placeholder
markers preserved verbatim -- "[•]" (Facility) or named "[Tokens]"
(Collaboration, e.g. "[PAN Number]"). Everything below -- which paragraph
indices are the repeatable collaborator clauses, which placeholder maps to
which constant, which table cells are ARTPARK's facilities allocation -- is
knowledge specific to each agreement's actual structure, confirmed by
direct inspection of the source .docx files under scripts/source_docs/.

BLANK, NEVER FABRICATED, NEVER A VISIBLE BRACKET. ARTPARK has not supplied
real values for several business constants (Facility Agreement: term
length, insurance limit, the Collaboration Agreement's own date, the six
Schedule II availability windows; Collaboration Agreement: the research
area, the Facility Agreement's own date). Rather than inventing a
plausible-looking value -- the worst possible outcome for a signed legal
document -- or refusing to render at all, an unset constant renders as
EMPTY SPACE: exactly how the original .docx would read if nobody had typed
anything into that bracket yet. What must never happen, under any code
path, is a literal placeholder token ("[•]", "[PAN Number]", etc.)
surviving into rendered output -- render_preview_text() and
render_agreement_pdf() both re-scan every resolved block for every known
placeholder token and raise ValueError if one is still present. This is the
single guard this module cannot ship without: a bracket-token leak is the
failure a reader notices first.
"""
from __future__ import annotations

import io
import json
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from xml.sax.saxutils import escape as _xml_escape

_TEMPLATE_DIR = Path(__file__).resolve().parent / "agreements"
_BULLET = "[•]"

# Every placeholder syntax either template uses. Checked verbatim (not
# per-slug) after every substitution -- a superset check is harmless: a
# Collaboration Agreement token can never appear in the Facility Agreement's
# raw text or vice versa, so checking for both everywhere costs nothing and
# means this list can never silently miss a case for the "wrong" template.
_LEFTOVER_TOKENS = (
    _BULLET,
    "[month]",
    "[date]",
    "[Name of first founder]",
    "[PAN Number]",
    '[Father’s full name / Mother’s full name]',
    "[Address]",
    "[Date of agreement]",
    "[insert areas]",
)


# ============================================================================
# ARTPARK CONSTANTS. ARTPARK has not supplied real values for any of these
# as of this commit -- every entry is deliberately `None`. DO NOT invent
# plausible-looking numbers here: see the module docstring. An unset value
# renders as blank space, never a fabricated figure and never the literal
# bracket -- confirm each with ARTPARK ops/legal before filling it in.
# ============================================================================
TEMPLATE_CONSTANTS: dict[str, dict] = {
    "facility-v1": {
        # Term length in months (paragraph 34: "...for a period of
        # [•] ([•]) months..."). Fills BOTH occurrences
        # -- the numeral and its word form via _MONTH_WORDS. UNSET.
        "term_months": None,
        # Public liability insurance minimum, per occurrence (paragraph 88).
        # UNSET.
        "insurance_limit": None,
        # Date of the (separate) Collaboration Agreement, referenced at
        # paragraph 13. In practice this is likely the same day the
        # Collaboration Agreement itself is executed (see that template's
        # own "facility_agreement_date" below, the mirror-image reference)
        # -- but that coupling isn't assumed here; each is its own
        # confirmable value. UNSET.
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
    "collaboration-v1": {
        # [insert areas] at paragraph 26 -- ARTPARK's description of the
        # Research Area, not the founder's. UNSET.
        "research_area": None,
        # [Date of agreement] at paragraph 47 -- the Facility Agreement's
        # own execution date, referenced from within this document. UNSET.
        "facility_agreement_date": None,
    },
}

_MONTH_WORDS = {
    1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six",
    7: "seven", 8: "eight", 9: "nine", 10: "ten", 11: "eleven", 12: "twelve",
    18: "eighteen", 24: "twenty-four", 36: "thirty-six",
}

_COLLAB_FIELDS = ("name", "pan", "parent_name", "address")
# Facility Agreement uses positional "[•]" bullets in document
# order; Collaboration Agreement uses named tokens. Both cover the same
# four founder-supplied fields, in the same order.
_COLLAB_TOKEN_MAP = {
    "name": "[Name of first founder]",
    "pan": "[PAN Number]",
    "parent_name": '[Father’s full name / Mother’s full name]',
    "address": "[Address]",
}


# -- Per-agreement structural rules -----------------------------------------
# Which paragraph indices are what, confirmed directly against each source
# .docx. A future third agreement gets its own entry; nothing here is
# meant to generalize automatically across unrelated documents.
_AGREEMENT_RULES: dict[str, dict] = {
    "facility-v1": {
        # (AND-paragraph index, clause-paragraph index) per collaborator
        # slot, in document order.
        "collab_block_indices": [(3, 4), (5, 6), (7, 8)],
        "list_sentence_index": 9,
        "list_sentence_article": "",  # '...referred to as "Collaborator"' (no article)
        "execution_date_paragraph_indices": (1, 19),
        "facilities_table_index": 126,
        "availability_order": (
            "dedicated_seating", "lab_space", "computing", "wifi",
            "conference_rooms", "access_badge",
        ),
        # paragraph index -> ordered list of constant lookups, filled into
        # that paragraph's "[•]" bullets in order.
        # "term_months_words" is a virtual key resolved via _MONTH_WORDS,
        # not a literal dict entry.
        "bullet_fills": {
            13: ["collaboration_agreement_date"],
            34: ["term_months", "term_months_words"],
            88: ["insurance_limit"],
        },
    },
    "collaboration-v1": {
        "collab_block_indices": [(8, 10), (11, 13), (14, 16)],
        "list_sentence_index": 17,
        "list_sentence_article": "a ",  # '...referred to as a "Collaborator"'
        "execution_date_paragraph_indices": (2,),
        # paragraph index -> {token: constant_key}
        "named_token_fills": {
            26: {"[insert areas]": "research_area"},
            47: {"[Date of agreement]": "facility_agreement_date"},
        },
    },
}

# Which agreements a founder on each track must sign. TIR gets both;
# VIP/SIP gets Facility only (spec D4). This is the single source of truth
# both agreements_for_track() and any UI code read from -- adding a track
# or an agreement is a data change here, never a new branch in the
# renderer.
TRACK_AGREEMENTS: dict[str, list[str]] = {
    "tir": ["facility-v1", "collaboration-v1"],
    "sip": ["facility-v1"],
}

_AGREEMENT_META: dict[str, dict] = {
    "facility-v1": {"name": "Facility Agreement", "min_collaborators": 1, "max_collaborators": 3},
    "collaboration-v1": {
        "name": "Collaboration Agreement", "min_collaborators": 1, "max_collaborators": 3,
    },
}

_FIELD_SCHEMA = [
    {"key": "name", "label": "Full legal name"},
    {"key": "pan", "label": "PAN"},
    {"key": "parent_name", "label": "Father's / Mother's / Spouse's name (s/o, d/o)"},
    {"key": "address", "label": "Residential address"},
]

# ── ARTPARK-constant field schema (MOU tab rebuild) ─────────────────────────
# Every real blank in each template that ISN'T a collaborator party detail
# (those are _FIELD_SCHEMA above) is an ARTPARK business constant --
# TEMPLATE_CONSTANTS' own keys, one schema entry per key, labelled from the
# surrounding sentence in the source .docx (see the block-index comments in
# _AGREEMENT_RULES above, which this schema is derived from directly rather
# than re-guessed). A dotted key ("availability_windows.dedicated_seating")
# addresses a nested TEMPLATE_CONSTANTS entry -- see _constant_value() below.
#
# Facility Agreement: 22 total positional "[•]" blanks. 12 are collaborator
# fields (3 slots x 4 fields, already in _FIELD_SCHEMA); the other 10 are
# these 9 DISTINCT constants -- term_months alone fills 2 (paragraph 34's
# numeral and its word form, via the virtual "term_months_words" key).
_SECTION_TERMS = "Agreement terms"
_SECTION_SCHEDULE = "Facilities schedule (Schedule II)"

_FACILITY_CONSTANT_SCHEMA: list[dict] = [
    {
        "key": "collaboration_agreement_date",
        "label": "Date the Collaboration Agreement was signed",
        "section": _SECTION_TERMS,
        # paragraph 13: "...entered into a Collaboration Agreement dated [•]..."
    },
    {
        "key": "term_months",
        "label": "Facility Agreement term length (months)",
        "section": _SECTION_TERMS,
        # paragraph 34: "...for a period of [•] ([•]) months..."
    },
    {
        "key": "insurance_limit",
        "label": "Public liability insurance minimum, per occurrence",
        "section": _SECTION_TERMS,
        # paragraph 88
    },
    {
        "key": "availability_windows.dedicated_seating",
        "label": "Availability window — Dedicated Seating",
        "section": _SECTION_SCHEDULE,
    },
    {
        "key": "availability_windows.lab_space",
        "label": "Availability window — Laboratory Space",
        "section": _SECTION_SCHEDULE,
    },
    {
        "key": "availability_windows.computing",
        "label": "Availability window — Computing Resources",
        "section": _SECTION_SCHEDULE,
    },
    {
        "key": "availability_windows.wifi",
        "label": "Availability window — Wireless Internet",
        "section": _SECTION_SCHEDULE,
    },
    {
        "key": "availability_windows.conference_rooms",
        "label": "Availability window — Conference Rooms",
        "section": _SECTION_SCHEDULE,
    },
    {
        "key": "availability_windows.access_badge",
        "label": "Availability window — Administrative ID / Access Badge",
        "section": _SECTION_SCHEDULE,
    },
]

# Collaboration Agreement: its own two ARTPARK-owned named tokens.
# [Name of first founder] / [PAN Number] / [Father's...] / [Address] are
# collaborator fields (_FIELD_SCHEMA, same as Facility); [month]/[date] are
# the render-time execution date, not configurable, so neither belongs here.
_COLLABORATION_CONSTANT_SCHEMA: list[dict] = [
    {
        "key": "research_area",
        "label": "Research Area — the Collaborators' field of complementary expertise",
        "section": _SECTION_TERMS,
        # paragraph 26: "...expertise in the field of [insert areas]..."
    },
    {
        "key": "facility_agreement_date",
        "label": "Date the Facility Agreement was signed",
        "section": _SECTION_TERMS,
        # paragraph 47: "...the Facility Agreement dated [Date of agreement]..."
    },
]

_CONSTANT_SCHEMA: dict[str, list[dict]] = {
    "facility-v1": _FACILITY_CONSTANT_SCHEMA,
    "collaboration-v1": _COLLABORATION_CONSTANT_SCHEMA,
}

# The committed original .docx for each agreement -- the exact bytes that
# were legally verified (backend/scripts/source_docs/), served verbatim by
# source_docx_path() below. Never converted or regenerated.
_SOURCE_DOCX: dict[str, str] = {
    "facility-v1": "facility_agreement_2026-08-06.docx",
    "collaboration-v1": "collaboration_agreement_2026-08-15.docx",
}
_SOURCE_DOCX_DIR = Path(__file__).resolve().parent.parent.parent / "scripts" / "source_docs"


def _constant_value(slug: str, key: str):
    """Read TEMPLATE_CONSTANTS[slug][key] for schema display -- `key` may be
    a dotted path ("availability_windows.dedicated_seating") addressing a
    nested constant. Mirrors how _resolve_blocks itself reaches into
    availability_windows, just generalised for schema keys."""
    constants = TEMPLATE_CONSTANTS.get(slug, {})
    if "." in key:
        top, sub = key.split(".", 1)
        return (constants.get(top) or {}).get(sub)
    return constants.get(key)


def source_docx_path(slug: str) -> Path:
    """Path to the committed original .docx for `slug` -- read exactly what
    was legally verified, never a converted/regenerated copy. Raises
    KeyError for an unrecognised slug; callers (the router) validate against
    agreements_for_track() first and turn that into a 404, the same pattern
    every other agreement-slug lookup in this module already follows."""
    return _SOURCE_DOCX_DIR / _SOURCE_DOCX[slug]


def _blank(value: object) -> str:
    """Render an unset (None) constant as empty space -- never the word
    "None", never a fabricated value, never left for the caller to forget
    to handle."""
    return "" if value is None else str(value)


def _resolve_constant_value(constants: dict, key: str):
    """key is either a literal TEMPLATE_CONSTANTS entry, or the virtual key
    "term_months_words" (Facility Agreement's paragraph 34 fills BOTH the
    numeral and the word form from the same term_months value)."""
    if key == "term_months_words":
        months = constants.get("term_months")
        if months is None:
            return None
        words = _MONTH_WORDS.get(months)
        if words is None:
            # This is a code-time gap (an actual term length nobody taught
            # _MONTH_WORDS to spell out), not an unset business constant --
            # it still raises, because blanking it would silently produce
            # "for a period of 13 () months", half-filled and worse than an
            # honest error caught in development.
            raise ValueError(
                f"no word form registered for term_months={months!r} "
                "— add it to _MONTH_WORDS"
            )
        return words
    return constants.get(key)


@lru_cache
def _load_template(slug: str) -> dict:
    return json.loads((_TEMPLATE_DIR / f"{slug}.json").read_text(encoding="utf-8"))


def _fill_bullets(text: str, values: list) -> str:
    parts = text.split(_BULLET)
    if len(parts) - 1 != len(values):
        raise ValueError(
            f"placeholder count mismatch: {text!r} expects {len(parts) - 1}, got {len(values)}"
        )
    out = parts[0]
    for v, p in zip(values, parts[1:], strict=True):
        out += _blank(v) + p
    return out


def _fill_named_tokens(text: str, mapping: dict) -> str:
    for token, value in mapping.items():
        text = text.replace(token, _blank(value))
    return text


def _collaborator_list_sentence(n: int, article: str) -> str:
    labels = [f"Collaborator {i + 1}" for i in range(n)]
    if n == 1:
        return f'{labels[0]} shall be referred to as {article}"Collaborator".'
    joined = f"{', '.join(labels[:-1])} and {labels[-1]}" if n > 2 else " and ".join(labels)
    return (
        f'{joined} shall be individually referred to as {article}"Collaborator" and '
        'collectively referred to as "Collaborators".'
    )


def _execution_month_day(now: datetime | None = None) -> tuple[str, str]:
    """The Execution/Effective Date stamped into both agreements. This is
    NOT an ARTPARK business constant -- it is the actual calendar date the
    document is being generated/signed on, computed here from the current
    time. There is nothing to configure and nothing that can be "left
    unset": this always resolves.
    """
    now = now or datetime.now(UTC)
    return now.strftime("%B"), str(now.day)


def _resolve_blocks(collaborators: list[dict], slug: str) -> list[dict]:
    """Load the committed template for `slug` and return a fully-resolved
    list of blocks: collaborator clauses filled in (unused slots dropped
    entirely), the list-sentence regenerated for the actual collaborator
    count, ARTPARK constants substituted (blank where unset), and (Facility
    only) the facilities schedule table filled in. Raises ValueError only
    for a structural defect -- a placeholder this code doesn't know how to
    fill, or a bracket token still present after substitution -- never for
    a constant simply being unset.
    """
    if not 1 <= len(collaborators) <= 3:
        raise ValueError(f"1 to 3 collaborators required, got {len(collaborators)}")
    if slug not in _AGREEMENT_RULES:
        raise ValueError(f"unknown agreement slug {slug!r}")

    rules = _AGREEMENT_RULES[slug]
    constants = TEMPLATE_CONSTANTS.get(slug, {})
    raw = _load_template(slug)["blocks"]
    execution_month, execution_date = _execution_month_day()

    collab_indices = rules["collab_block_indices"]
    dropped_collab_indices = {i for pair in collab_indices[len(collaborators):] for i in pair}
    filled_collab_indices = {i for pair in collab_indices[: len(collaborators)] for i in pair}
    bullet_fills = rules.get("bullet_fills", {})
    named_token_fills = rules.get("named_token_fills", {})
    facilities_table_index = rules.get("facilities_table_index")

    resolved: list[dict] = []
    for block in raw:
        idx = block["index"]
        if idx in dropped_collab_indices:
            # Unused collaborator slots are dropped whole (both the
            # connector paragraph and the clause paragraph) -- never
            # rendered as an empty placeholder line.
            continue

        if block["type"] == "table":
            if facilities_table_index is not None and idx == facilities_table_index:
                rows = [list(r) for r in block["rows"]]
                for row_i, key in enumerate(rules["availability_order"], start=1):
                    rows[row_i][3] = _blank(constants.get("availability_windows", {}).get(key))
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
        has_bullet = _BULLET in text
        has_named_collab_token = any(tok in text for tok in _COLLAB_TOKEN_MAP.values())
        if idx in filled_collab_indices and (has_bullet or has_named_collab_token):
            # The clause paragraph itself (not its "AND" connector, which
            # carries neither a bullet nor a named token and so never
            # enters this branch — it passes through unchanged below).
            slot = next(i for i, pair in enumerate(collab_indices) if idx in pair)
            collaborator = collaborators[slot]
            if has_bullet:
                values = [str(collaborator[f]) for f in _COLLAB_FIELDS]
                text = _fill_bullets(text, values)
            else:
                mapping = {tok: collaborator[field] for field, tok in _COLLAB_TOKEN_MAP.items()}
                text = _fill_named_tokens(text, mapping)
        elif idx == rules["list_sentence_index"]:
            text = _collaborator_list_sentence(len(collaborators), rules["list_sentence_article"])
        elif idx in bullet_fills:
            values = [_resolve_constant_value(constants, key) for key in bullet_fills[idx]]
            text = _fill_bullets(text, values)
        elif idx in named_token_fills:
            mapping = {
                tok: _resolve_constant_value(constants, key)
                for tok, key in named_token_fills[idx].items()
            }
            text = _fill_named_tokens(text, mapping)

        if idx in rules["execution_date_paragraph_indices"]:
            text = text.replace("[month]", execution_month).replace("[date]", execution_date)

        if any(tok in text for tok in _LEFTOVER_TOKENS):
            raise ValueError(f"placeholder survived resolution in block {idx}: {text!r}")

        resolved.append({**block, "text": text})
    return resolved


def render_preview_text(collaborators: list[dict], slug: str = "facility-v1") -> str:
    """Plain-text rendering of the resolved agreement -- what the founder
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


def is_legacy_signature(recorded_version: str | None, track: str) -> bool:
    """True when a signature was recorded under agreements that no longer
    apply to `track` — so none of the documents now on offer is retrievable.

    `recorded_version` is the comma-joined slug list stamped on the row at
    signing time (older rows carry a single opaque label such as
    "tir-mou-v2"). Legacy means ZERO overlap with the current set. Partial
    overlap is deliberately NOT legacy: a founder who signed facility-v1
    before collaboration-v1 existed can still retrieve the facility
    document, and calling that state legacy would hide a document they are
    entitled to.

    Exists because the UI previously rendered "Agreements signed" above one
    row per document reading "Not part of what you signed" — each statement
    true, the combination meaningless.
    """
    if not recorded_version:
        return False
    signed = {p.strip() for p in recorded_version.split(",") if p.strip()}
    current = {x["slug"] for x in agreements_for_track(track)}
    return not (signed & current)


def agreements_for_track(track: str) -> list[dict]:
    """Which agreements a founder on `track` must sign, and the field
    schema for each. Driven by TRACK_AGREEMENTS -- tracks with no entry
    (or an unrecognised track) get no agreements, not a hardcoded default,
    so an unmapped track fails visibly rather than silently defaulting to
    the wrong document set."""
    slugs = TRACK_AGREEMENTS.get(track, [])
    return [
        {
            "slug": slug,
            "name": _AGREEMENT_META[slug]["name"],
            "min_collaborators": _AGREEMENT_META[slug]["min_collaborators"],
            "max_collaborators": _AGREEMENT_META[slug]["max_collaborators"],
            # Founder-editable blanks -- one set of party details per
            # collaborator (1-3), the same values feeding every agreement.
            "fields": [{**f, "owner": "founder"} for f in _FIELD_SCHEMA],
            # ARTPARK-owned blanks -- read-only context, not an input.
            # value is TEMPLATE_CONSTANTS' real current value (None today,
            # for every one of them -- see that dict's own docstring).
            "constants": [
                {**c, "owner": "artpark", "value": _constant_value(slug, c["key"])}
                for c in _CONSTANT_SCHEMA.get(slug, [])
            ],
            "source_docx_available": slug in _SOURCE_DOCX,
        }
        for slug in slugs
    ]


# -- PDF rendering (reportlab platypus for the body + pypdf to merge in a
#    canvas-drawn signature page) --------------------------------------------

def _build_body_pdf(blocks: list[dict]) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    styles = getSampleStyleSheet()
    body_style = ParagraphStyle("FacilityBody", parent=styles["Normal"], fontSize=9.5, leading=13)
    heading_style = ParagraphStyle(
        "FacilityHeading", parent=styles["Normal"], fontSize=11, leading=15,
        spaceBefore=8, spaceAfter=4,
    )

    flowables = []
    for b in blocks:
        if b["type"] == "paragraph":
            if not b["text"].strip():
                flowables.append(Spacer(1, 4 * mm))
                continue
            style_name = (b.get("style") or "")
            is_heading = style_name.startswith("Headings") or (
                b["text"].isupper() and len(b["text"].strip()) > 2
            )
            style = heading_style if is_heading else body_style
            flowables.append(Paragraph(_xml_escape(b["text"]), style))
        else:
            table = Table([[_xml_escape(cell) for cell in row] for row in b["rows"]], hAlign="LEFT")
            table.setStyle(
                TableStyle(
                    [
                        ("GRID", (0, 0), (-1, -1), 0.5, "#999999"),
                        ("FONTSIZE", (0, 0), (-1, -1), 7.5),
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ]
                )
            )
            flowables.append(table)
            flowables.append(Spacer(1, 4 * mm))

    buf = io.BytesIO()
    SimpleDocTemplate(buf, pagesize=A4, topMargin=20 * mm, bottomMargin=20 * mm).build(flowables)
    return buf.getvalue()


def _build_signature_page_pdf(
    signer_name: str, date_str: str, signature_png: str | None, accepted_acks: list[str] | None,
    venture_name: str | None = None,
) -> bytes:
    # Reuses the exact image-embed approach founder_mou.render_signed_pdf
    # already proves works against the Lambda runtime's reportlab.
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas

    from .founder_mou import _wrap, acknowledgement_text, decode_signature_png

    # signature_png is absent for a PRE-signing preview (nothing has been
    # drawn yet, or the founder hasn't reached the Sign step) -- decode is
    # skipped entirely rather than passed a sentinel, so the signed path
    # below (signature_png truthy) is untouched byte-for-byte from before
    # this became optional.
    raw_png = decode_signature_png(signature_png) if signature_png else None
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    width, height = A4
    x, y = 20 * mm, height - 25 * mm
    c.setFont("Helvetica-Bold", 11)
    c.drawString(x, y, "Signature")
    y -= 8 * mm
    c.setFont("Helvetica", 9)
    c.drawString(x, y, f"Signed by: {signer_name}    Date: {date_str}")
    y -= 10 * mm
    for ack_id in accepted_acks or []:
        for i, line in enumerate(_wrap(acknowledgement_text(ack_id), 100)):
            c.drawString(x + 4 * mm, y, ("[x] " if i == 0 else "    ") + line)
            y -= 4.6 * mm
        y -= 1.5 * mm
    if raw_png is not None:
        try:
            img = ImageReader(io.BytesIO(raw_png))
            c.drawImage(
                img, x, y - 20 * mm, width=55 * mm, height=18 * mm,
                preserveAspectRatio=True, mask="auto",
            )
        except Exception:  # noqa: BLE001 -- never fail the PDF over an image glitch
            pass
    else:
        # No signature yet: the blank ruled line a paper form would show at
        # this spot -- never a fabricated mark, never placeholder text.
        c.setLineWidth(0.75)
        c.line(x, y - 18 * mm, x + 70 * mm, y - 18 * mm)
    # Venture/startup name -- printed ONLY here, on the annexure page THIS
    # module generates, never inside the verified legal body text (neither
    # source agreement has a "name of the startup" blank; both are
    # individual-collaborator agreements). Omitted entirely (no new
    # setFont/drawString calls at all) when not supplied, so the default
    # call shape -- and therefore the golden-hash signed-PDF byte output --
    # is completely unchanged from before this field existed.
    if venture_name:
        y -= 26 * mm
        c.setFont("Helvetica", 8)
        c.drawString(x, y, f"Venture / startup name: {venture_name}")
    c.showPage()
    c.save()
    return buf.getvalue()


def render_agreement_pdf(
    *,
    collaborators: list[dict],
    signer_name: str,
    date_str: str,
    signature_png: str | None = None,
    accepted_acks: list[str] | None = None,
    slug: str = "facility-v1",
    venture_name: str | None = None,
) -> bytes:
    """Render the fully-resolved agreement to PDF bytes: a platypus-built
    body (real paragraphs, real tables) with a canvas-drawn signature page
    merged on at the end via pypdf. Shares _resolve_blocks with
    render_preview_text() so the signed PDF can never diverge from what the
    founder reviewed.

    signature_png is optional: the live preview a founder sees while still
    typing (or before drawing a signature) calls this with none at all, and
    gets back the same document with a blank ruled signature line instead
    of an image -- exactly what the paper form looks like unsigned. The
    signed path (signature_png provided) is unchanged.

    venture_name is optional and, when supplied, is printed ONLY on the
    signature/annexure page (see _build_signature_page_pdf) -- never into
    the body. Omitting it (the default) reproduces the exact pre-existing
    byte output; see the golden-hash test in test_agreements.py."""
    from pypdf import PdfReader, PdfWriter

    blocks = _resolve_blocks(collaborators, slug)
    body_pdf = _build_body_pdf(blocks)
    sig_pdf = _build_signature_page_pdf(
        signer_name, date_str, signature_png, accepted_acks, venture_name=venture_name
    )

    writer = PdfWriter()
    for page in PdfReader(io.BytesIO(body_pdf)).pages:
        writer.add_page(page)
    for page in PdfReader(io.BytesIO(sig_pdf)).pages:
        writer.add_page(page)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()
