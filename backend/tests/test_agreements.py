"""Substitution + rendering tests for app/services/agreements.py.

TIR founders sign TWO agreements (Facility + Collaboration); VIP/SIP sign
Facility only (agreements.TRACK_AGREEMENTS). As of this commit ARTPARK has
not supplied real values for either agreement's business constants (term
length, insurance limit, the cross-referenced agreement dates, the six
Schedule II availability windows, the research area) —
agreements.TEMPLATE_CONSTANTS ships with every one of those set to the
UNSET sentinel (None).

PRODUCT DECISION: an unset constant renders as BLANK — empty space, exactly
how the source .docx would read if nobody had typed anything into that
bracket. Rendering NEVER refuses to run over an unset constant, and NEVER
emits a fabricated value. The one thing that must never happen, under any
code path, is a literal placeholder token surviving into rendered output —
that is the failure a reader notices first, and it is asserted directly
against the actual generated text/PDF bytes throughout this file, not just
against the pre-render config.
"""
import pytest
from app.services import agreements

ONE = [
    {"name": "Aditi Rao", "pan": "ABCDE1234F", "parent_name": "Suresh Rao", "address": "12 MG Road, Bengaluru"}
]
TWO = ONE + [
    {"name": "Kiran Shah", "pan": "PQRSX5678L", "parent_name": "Manoj Shah", "address": "4 Church St, Bengaluru"}
]
THREE = TWO + [
    {"name": "Divya Nair", "pan": "LMNOQ9012Z", "parent_name": "Ravi Nair", "address": "9 Brigade Rd, Bengaluru"}
]

_TEST_FACILITY_CONSTANTS = {
    "term_months": 6,
    "insurance_limit": "TEST-INSURANCE-LIMIT-VALUE",
    "collaboration_agreement_date": "TEST-COLLAB-AGREEMENT-DATE",
    "availability_windows": {
        "dedicated_seating": "TEST-WINDOW-DEDICATED-SEATING",
        "lab_space": "TEST-WINDOW-LAB-SPACE",
        "computing": "TEST-WINDOW-COMPUTING",
        "wifi": "TEST-WINDOW-WIFI",
        "conference_rooms": "TEST-WINDOW-CONFERENCE-ROOMS",
        "access_badge": "TEST-WINDOW-ACCESS-BADGE",
    },
}
_TEST_COLLABORATION_CONSTANTS = {
    "research_area": "TEST-RESEARCH-AREA-ROBOTICS",
    "facility_agreement_date": "TEST-FACILITY-AGREEMENT-DATE",
}

ALL_SLUGS = ("facility-v1", "collaboration-v1")


@pytest.fixture
def _configured(monkeypatch):
    """Fill in TEMPLATE_CONSTANTS for BOTH agreements with fake-but-complete
    TEST-* values so the substitution engine can be exercised end to end.
    Deep-copies so mutation inside a test can never leak into another test
    or into the real module state used by the blank-rendering tests below."""
    import copy

    fake_facility = copy.deepcopy(_TEST_FACILITY_CONSTANTS)
    fake_collab = copy.deepcopy(_TEST_COLLABORATION_CONSTANTS)
    monkeypatch.setitem(agreements.TEMPLATE_CONSTANTS, "facility-v1", fake_facility)
    monkeypatch.setitem(agreements.TEMPLATE_CONSTANTS, "collaboration-v1", fake_collab)
    return {"facility-v1": fake_facility, "collaboration-v1": fake_collab}


# ═══════════════════════════════════════════════════════════════════════════
# THE test a reader checks first: no literal placeholder token — of either
# syntax either template uses — may ever survive into rendered output.
# Covers every collaborator arity, both templates, configured AND unset
# constants, and preview text AND real extracted PDF text.
# ═══════════════════════════════════════════════════════════════════════════

def test_no_placeholder_token_survives_any_collaborator_count_when_configured(_configured):
    for slug in ALL_SLUGS:
        for collaborators in (ONE, TWO, THREE):
            text = agreements.render_preview_text(collaborators, slug)
            for tok in agreements._LEFTOVER_TOKENS:
                assert tok not in text, f"{tok!r} leaked into {slug} preview for {len(collaborators)} collaborators"


def test_no_placeholder_token_survives_when_constants_are_unset():
    """The real shipped state: nothing has been configured. Rendering must
    still produce clean text — unset constants render blank, not as a
    visible bracket."""
    for slug in ALL_SLUGS:
        for collaborators in (ONE, TWO, THREE):
            text = agreements.render_preview_text(collaborators, slug)
            for tok in agreements._LEFTOVER_TOKENS:
                assert tok not in text, f"{tok!r} leaked into {slug} preview (unset constants) for {len(collaborators)} collaborators"


def test_no_placeholder_survives_in_the_actual_pdf_text(_configured):
    """Extract real text from the generated PDF bytes (not the pre-render
    string) for both agreements — the direct assertion, not a proxy."""
    import base64
    import io

    from pypdf import PdfReader

    png = "data:image/png;base64," + base64.b64encode(
        base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
        )
    ).decode()
    for slug in ALL_SLUGS:
        pdf = agreements.render_agreement_pdf(
            collaborators=THREE, signer_name="Aditi Rao", date_str="18 Aug 2026",
            signature_png=png, accepted_acks=[], slug=slug,
        )
        extracted = "".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(pdf)).pages)
        for tok in agreements._LEFTOVER_TOKENS:
            assert tok not in extracted, f"{tok!r} leaked into {slug} PDF text"


def test_a_value_that_is_itself_a_placeholder_token_still_trips_the_guard(monkeypatch):
    """Defense in depth: even a configured (non-None) constant whose value
    is itself literally a placeholder token (e.g. someone fat-fingers a
    bracket while filling in the config) must still be caught."""
    import copy

    trap = copy.deepcopy(_TEST_FACILITY_CONSTANTS)
    trap["insurance_limit"] = "[•]"
    monkeypatch.setitem(agreements.TEMPLATE_CONSTANTS, "facility-v1", trap)
    with pytest.raises(ValueError, match="placeholder"):
        agreements.render_preview_text(ONE, "facility-v1")


# ═══════════════════════════════════════════════════════════════════════════
# Blank rendering — the product decision this file protects. Unset
# constants must render as EMPTY SPACE, never fabricated, never the word
# "None", never blocking generation.
# ═══════════════════════════════════════════════════════════════════════════

def test_unset_facility_constants_render_blank_not_fabricated_not_blocked():
    text = agreements.render_preview_text(ONE, "facility-v1")
    assert "for a period of  ()" in text  # term_months blank, both numeral and words
    assert "not less than  per occurrence" in text  # insurance_limit blank
    assert "Collaboration Agreement dated ," in text  # collaboration_agreement_date blank
    assert "None" not in text  # never the literal word "None" leaking from str(None)


def test_unset_collaboration_constants_render_blank():
    text = agreements.render_preview_text(ONE, "collaboration-v1")
    # research_area blank — and specifically not the literal word "None"
    # (str(None) leaking through would be exactly as bad as fabricating a
    # value). NOTE: Schedule I's own funding table legitimately contains
    # the word "None" ("ART-PARK Equity Charge: None (Grant Equity)") as
    # real, unrelated contract text, so this asserts against the two
    # specific substituted lines rather than the word's absence anywhere
    # in the 173-paragraph document.
    research_area_line = next(line for line in text.splitlines() if "Research Area" in line)
    facility_date_line = next(line for line in text.splitlines() if "Facility Agreement dated" in line)
    assert "field of  (" in research_area_line
    assert "Facility Agreement dated  entered into" in facility_date_line
    assert "None" not in research_area_line
    assert "None" not in facility_date_line


def test_partial_configuration_is_fine_unlike_a_fail_closed_design(monkeypatch):
    """Only SOME constants configured, others still None — must still
    render cleanly (mixed real values + blanks), never raise."""
    import copy

    partial = copy.deepcopy(_TEST_FACILITY_CONSTANTS)
    partial["insurance_limit"] = None
    partial["availability_windows"]["wifi"] = None
    monkeypatch.setitem(agreements.TEMPLATE_CONSTANTS, "facility-v1", partial)
    text = agreements.render_preview_text(ONE, "facility-v1")
    assert partial["collaboration_agreement_date"] in text
    assert partial["availability_windows"]["dedicated_seating"] in text
    assert "not less than  per occurrence" in text  # the still-unset one is blank
    for tok in agreements._LEFTOVER_TOKENS:
        assert tok not in text


def test_pdf_render_never_raises_for_unset_constants():
    """render_agreement_pdf shares _resolve_blocks with render_preview_text
    — blank rendering must hold through the PDF path too, not just text."""
    import base64

    png = "data:image/png;base64," + base64.b64encode(
        base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
        )
    ).decode()
    for slug in ALL_SLUGS:
        pdf = agreements.render_agreement_pdf(
            collaborators=ONE, signer_name="Aditi Rao", date_str="18 Aug 2026",
            signature_png=png, accepted_acks=[], slug=slug,
        )
        assert pdf[:5] == b"%PDF-"


# ═══════════════════════════════════════════════════════════════════════════
# Collaborator block arity — same rules for both agreements: unused
# collaborator blocks are dropped entirely, never rendered as an empty
# placeholder line.
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("slug", ALL_SLUGS)
def test_one_collaborator_does_not_emit_second_or_third_block(_configured, slug):
    text = agreements.render_preview_text(ONE, slug)
    assert "Collaborator 2" not in text
    assert "Collaborator 3" not in text
    assert "Aditi Rao" in text


@pytest.mark.parametrize("slug", ALL_SLUGS)
def test_two_collaborators_drops_only_the_third_block(_configured, slug):
    text = agreements.render_preview_text(TWO, slug)
    assert "Collaborator 1" in text and "Collaborator 2" in text
    assert "Collaborator 3" not in text
    assert "Kiran Shah" in text


@pytest.mark.parametrize("slug", ALL_SLUGS)
def test_three_collaborators_renders_all_three(_configured, slug):
    text = agreements.render_preview_text(THREE, slug)
    assert all(f"Collaborator {n}" in text for n in (1, 2, 3))
    assert "Divya Nair" in text


@pytest.mark.parametrize("slug", ALL_SLUGS)
def test_invalid_collaborator_count_rejected(_configured, slug):
    with pytest.raises(ValueError, match="1 to 3"):
        agreements.render_preview_text([], slug)
    with pytest.raises(ValueError, match="1 to 3"):
        agreements.render_preview_text(
            THREE + [{"name": "x", "pan": "y", "parent_name": "z", "address": "w"}], slug
        )


def test_facility_collaborator_fields_substitute_in_the_documented_order(_configured):
    """name, PAN, parent_name (s/o/d/o), address — the field-map order,
    via positional "[•]" bullets."""
    text = agreements.render_preview_text(ONE, "facility-v1")
    assert (
        "Aditi Rao, having PAN ABCDE1234F, s/o/d/o Suresh Rao, resident of 12 MG Road, Bengaluru"
        in text
    )


def test_collaboration_collaborator_fields_substitute_via_named_tokens(_configured):
    """Same field order, but the Collaboration Agreement uses named tokens
    ([Name of first founder], [PAN Number], ...) instead of positional
    bullets — the accepted-revisions text from the redlined .docx."""
    text = agreements.render_preview_text(ONE, "collaboration-v1")
    assert (
        "Aditi Rao, having PAN ABCDE1234F, s/o/d/o Suresh Rao, resident of 12 MG Road, Bengaluru"
        in text
    )


def test_facility_list_sentence_has_no_article(_configured):
    """Facility Agreement's own wording: '...referred to as "Collaborator"'
    — no article, confirmed against the source .docx."""
    text = agreements.render_preview_text(ONE, "facility-v1")
    assert 'Collaborator 1 shall be referred to as "Collaborator".' in text
    assert 'as a "Collaborator"' not in text


def test_collaboration_list_sentence_has_an_article(_configured):
    """Collaboration Agreement's own wording differs subtly: '...referred
    to as A "Collaborator"' — confirmed against its own source .docx, and
    deliberately NOT the same string as the Facility Agreement's."""
    text = agreements.render_preview_text(ONE, "collaboration-v1")
    assert 'Collaborator 1 shall be referred to as a "Collaborator".' in text


def test_list_sentence_regenerates_for_three_collaborators_both_agreements(_configured):
    facility_text = agreements.render_preview_text(THREE, "facility-v1")
    assert (
        'Collaborator 1, Collaborator 2 and Collaborator 3 shall be individually referred to as '
        '"Collaborator" and collectively referred to as "Collaborators".' in facility_text
    )
    collab_text = agreements.render_preview_text(THREE, "collaboration-v1")
    assert (
        'Collaborator 1, Collaborator 2 and Collaborator 3 shall be individually referred to as a '
        '"Collaborator" and collectively referred to as "Collaborators".' in collab_text
    )


# ═══════════════════════════════════════════════════════════════════════════
# ARTPARK constants, when configured.
# ═══════════════════════════════════════════════════════════════════════════

def test_facility_artpark_constants_appear(_configured):
    text = agreements.render_preview_text(ONE, "facility-v1")
    c = agreements.TEMPLATE_CONSTANTS["facility-v1"]
    assert c["insurance_limit"] in text
    assert str(c["term_months"]) in text
    assert agreements._MONTH_WORDS[c["term_months"]] in text
    assert c["collaboration_agreement_date"] in text


def test_facilities_schedule_constants_appear_in_order(_configured):
    text = agreements.render_preview_text(ONE, "facility-v1")
    c = agreements.TEMPLATE_CONSTANTS["facility-v1"]["availability_windows"]
    assert c["dedicated_seating"] in text
    assert c["access_badge"] in text
    assert text.index(c["dedicated_seating"]) < text.index(c["access_badge"])


def test_collaboration_artpark_constants_appear(_configured):
    text = agreements.render_preview_text(ONE, "collaboration-v1")
    c = agreements.TEMPLATE_CONSTANTS["collaboration-v1"]
    assert c["research_area"] in text
    assert c["facility_agreement_date"] in text


def test_execution_month_and_date_are_stamped_not_left_blank(_configured):
    """[month]/[date] use a different bracket syntax and are stamped from
    the actual render-time date, not from TEMPLATE_CONSTANTS — they always
    resolve for both agreements, there is nothing to configure."""
    import datetime as _dt

    now = _dt.datetime.now(_dt.UTC)
    for slug in ALL_SLUGS:
        text = agreements.render_preview_text(ONE, slug)
        assert now.strftime("%B") in text
        assert str(now.day) in text


def test_unresolved_placeholder_raises_instead_of_shipping_broken_text(_configured, monkeypatch):
    """Defensive check inside the renderer itself: if a future template
    edit adds a placeholder this code doesn't know how to fill, fail
    loudly rather than emit a document with a visible blank bracket."""
    bad_blocks = agreements._load_template("facility-v1")["blocks"] + [
        {"type": "paragraph", "index": 999, "text": "Unhandled [•] field.", "placeholder_count": 1}
    ]
    monkeypatch.setattr(agreements, "_load_template", lambda slug: {"blocks": bad_blocks})
    with pytest.raises(ValueError, match="placeholder"):
        agreements.render_preview_text(ONE, "facility-v1")


# ═══════════════════════════════════════════════════════════════════════════
# Track-driven agreement listing — data, not a hardcoded branch.
# ═══════════════════════════════════════════════════════════════════════════

def test_tir_gets_both_agreements():
    ids = [a["slug"] for a in agreements.agreements_for_track("tir")]
    assert ids == ["facility-v1", "collaboration-v1"]


def test_sip_gets_facility_only():
    ids = [a["slug"] for a in agreements.agreements_for_track("sip")]
    assert ids == ["facility-v1"]


def test_unrecognised_track_gets_no_agreements_not_a_default():
    """An unmapped track must fail visibly (empty list, no card renders)
    rather than silently defaulting to some agreement set — the frontend
    driven-by-this-data has nothing to render, which is correct, not a
    bug to paper over with a fallback."""
    assert agreements.agreements_for_track("nonexistent-track") == []


def test_adding_a_track_is_a_data_change_not_a_new_code_path(monkeypatch):
    """Proves TRACK_AGREEMENTS actually drives agreements_for_track() —
    mutating the data dict alone (no code change) changes the result."""
    monkeypatch.setitem(agreements.TRACK_AGREEMENTS, "sip", ["facility-v1", "collaboration-v1"])
    ids = [a["slug"] for a in agreements.agreements_for_track("sip")]
    assert ids == ["facility-v1", "collaboration-v1"]


# ═══════════════════════════════════════════════════════════════════════════
# PDF rendering — reportlab platypus (body) + pypdf (signature-page merge).
# ═══════════════════════════════════════════════════════════════════════════
import base64  # noqa: E402
import io  # noqa: E402

from pypdf import PdfReader  # noqa: E402

_PNG = "data:image/png;base64," + base64.b64encode(
    base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
    )
).decode()


@pytest.mark.parametrize("slug", ALL_SLUGS)
def test_render_agreement_pdf_returns_pdf_bytes(_configured, slug):
    pdf = agreements.render_agreement_pdf(
        collaborators=ONE, signer_name="Aditi Rao", date_str="18 Aug 2026",
        signature_png=_PNG, accepted_acks=[], slug=slug,
    )
    assert pdf[:5] == b"%PDF-"
    assert len(pdf) > 2000


def test_signature_block_content_is_present_in_the_pdf(_configured):
    """A page-count check alone is a weak proxy here: the Facility
    Agreement body is long enough (9 pages for a single collaborator) that
    omitting the signature page entirely does not change the page count in
    any obvious way. Assert on the signature page's actual, distinctive
    content instead — the one thing a missing merge step would remove."""
    pdf = agreements.render_agreement_pdf(
        collaborators=ONE, signer_name="Aditi Rao Signer", date_str="18 Aug 2026",
        signature_png=_PNG, accepted_acks=["full_time_presence"], slug="facility-v1",
    )
    extracted = "".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(pdf)).pages)
    assert "Signed by: Aditi Rao Signer" in extracted
    assert "Date: 18 Aug 2026" in extracted
    from app.services.founder_mou import acknowledgement_text

    assert acknowledgement_text("full_time_presence")[:40] in extracted


def test_pdf_contains_every_collaborator_name(_configured):
    for slug in ALL_SLUGS:
        pdf = agreements.render_agreement_pdf(
            collaborators=THREE, signer_name="Aditi Rao", date_str="18 Aug 2026",
            signature_png=_PNG, accepted_acks=[], slug=slug,
        )
        extracted = "".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(pdf)).pages)
        for c in THREE:
            assert c["name"] in extracted


def test_two_collaborators_does_not_leak_a_third_empty_block_into_the_pdf(_configured):
    for slug in ALL_SLUGS:
        pdf = agreements.render_agreement_pdf(
            collaborators=TWO, signer_name="Aditi Rao", date_str="18 Aug 2026",
            signature_png=_PNG, accepted_acks=[], slug=slug,
        )
        extracted = "".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(pdf)).pages)
        assert "Collaborator 3" not in extracted


def test_pdf_is_longer_with_more_collaborators(_configured):
    for slug in ALL_SLUGS:
        small = agreements.render_agreement_pdf(
            collaborators=ONE, signer_name="A", date_str="d", signature_png=_PNG,
            accepted_acks=[], slug=slug,
        )
        big = agreements.render_agreement_pdf(
            collaborators=THREE, signer_name="A", date_str="d", signature_png=_PNG,
            accepted_acks=[], slug=slug,
        )
        assert len(big) > len(small)


# ═══════════════════════════════════════════════════════════════════════════
# Optional signature — the PDF preview must render before signing, when
# there is no signature yet. The signature AREA becomes the blank ruled
# space it would be on paper: no image, and no fabricated placeholder mark.
# ═══════════════════════════════════════════════════════════════════════════

def test_render_agreement_pdf_without_signature_does_not_raise(_configured):
    for slug in ALL_SLUGS:
        pdf = agreements.render_agreement_pdf(
            collaborators=ONE, signer_name="Aditi Rao", date_str="18 Aug 2026",
            signature_png=None, accepted_acks=[], slug=slug,
        )
        assert pdf[:5] == b"%PDF-"


def test_render_agreement_pdf_signature_defaults_to_none_when_omitted(_configured):
    """signature_png is optional -- omitting the kwarg entirely (not just
    passing None explicitly) must work, since the preview endpoint never
    has one to pass."""
    pdf = agreements.render_agreement_pdf(
        collaborators=ONE, signer_name="Aditi Rao", date_str="18 Aug 2026",
        accepted_acks=[], slug="facility-v1",
    )
    assert pdf[:5] == b"%PDF-"


def test_unsigned_preview_embeds_no_signature_image():
    """The signature block must contain NO image XObject at all when no
    signature was supplied -- proves the blank-ruled-space path is really
    blank, not a silently-swapped default/placeholder image."""
    from pypdf import PdfReader

    pdf = agreements.render_agreement_pdf(
        collaborators=ONE, signer_name="Aditi Rao", date_str="18 Aug 2026",
        signature_png=None, accepted_acks=[], slug="facility-v1",
    )
    sig_page = PdfReader(io.BytesIO(pdf)).pages[-1]
    assert list(sig_page.images) == []


def test_signed_render_embeds_exactly_one_signature_image():
    """Sanity counterpart to the test above -- the signed path still embeds
    the real signature image, so "no image" for the unsigned case above is
    a meaningful assertion and not just an artifact of extraction failing
    for both cases alike."""
    from pypdf import PdfReader

    pdf = agreements.render_agreement_pdf(
        collaborators=ONE, signer_name="Aditi Rao", date_str="18 Aug 2026",
        signature_png=_PNG, accepted_acks=[], slug="facility-v1",
    )
    sig_page = PdfReader(io.BytesIO(pdf)).pages[-1]
    assert len(list(sig_page.images)) == 1


def test_unsigned_preview_contains_no_placeholder_token_either():
    """The blank-signature path reuses the same discipline as every other
    unset field in this module: no literal placeholder token, ever."""
    from pypdf import PdfReader

    for slug in ALL_SLUGS:
        pdf = agreements.render_agreement_pdf(
            collaborators=THREE, signer_name="", date_str="18 Aug 2026",
            signature_png=None, accepted_acks=[], slug=slug,
        )
        extracted = "".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(pdf)).pages)
        for tok in agreements._LEFTOVER_TOKENS:
            assert tok not in extracted


# The exact byte output of a SIGNED render, hashed BEFORE signature_png
# became optional on render_agreement_pdf -- proves the refactor changed
# nothing about the already-shipped signed path. Regenerate only if the
# signature-page layout is deliberately redesigned.
_GOLDEN_SIGNED_SHA256 = {
    "facility-v1": "55127ae5a4ac2ee61c5fa1ebba675139a6fd7b995312bc1db95f2c44ef3ab990",
    "collaboration-v1": "646bcb8b0605b11912cd080d1aaaf319776c696adfb746f0d98c747e841c5d98",
}


def test_unsigned_signature_page_text_matches_signed_signature_page_text():
    """A drawn line (unsigned) and an embedded image (signed) both produce
    zero extractable text -- the last page's TEXT content must be IDENTICAL
    either way. This is what actually rules out a fabricated label sneaking
    into the blank-signature branch (e.g. "Not yet signed", "[sign here]")
    -- an image-count check alone would miss stray drawString calls."""
    from pypdf import PdfReader

    signed = agreements.render_agreement_pdf(
        collaborators=ONE, signer_name="Aditi Rao", date_str="18 Aug 2026",
        signature_png=_PNG, accepted_acks=[], slug="facility-v1",
    )
    unsigned = agreements.render_agreement_pdf(
        collaborators=ONE, signer_name="Aditi Rao", date_str="18 Aug 2026",
        signature_png=None, accepted_acks=[], slug="facility-v1",
    )
    signed_text = PdfReader(io.BytesIO(signed)).pages[-1].extract_text() or ""
    unsigned_text = PdfReader(io.BytesIO(unsigned)).pages[-1].extract_text() or ""
    assert signed_text == unsigned_text


@pytest.mark.parametrize("slug", ALL_SLUGS)
def test_signed_render_is_byte_identical_to_pre_refactor_golden(slug):
    """Deliberately NOT using the `_configured` fixture -- the golden hash
    was captured against the real shipped state (every ARTPARK constant
    still unset), which is also the only state that currently exists in
    production."""
    import hashlib

    pdf = agreements.render_agreement_pdf(
        collaborators=ONE, signer_name="Aditi Rao", date_str="18 Aug 2026",
        signature_png=_PNG, accepted_acks=["full_time_presence"], slug=slug,
    )
    assert hashlib.sha256(pdf).hexdigest() == _GOLDEN_SIGNED_SHA256[slug]


# ── legacy signatures ─────────────────────────────────────────────────
# A row signed before the agreements changed retrieves none of the current
# documents. Production carried exactly one such row (signer OOOO,
# template_version "tir-mou-v2"), and every future version bump recreates
# the state for everyone who signed before it. The UI used to render
# "Agreements signed" above one row per document reading "Not part of what
# you signed" — each true, the combination meaningless.

def test_a_superseded_version_label_is_legacy():
    assert agreements.is_legacy_signature("tir-mou-v2", "tir") is True


def test_the_current_slug_list_is_not_legacy():
    assert agreements.is_legacy_signature("facility-v1,collaboration-v1", "tir") is False


def test_partial_overlap_is_not_legacy():
    """Signed facility-v1 before collaboration-v1 existed: one current
    document IS still retrievable, so this is the ordinary per-document
    case, not the legacy one. Treating it as legacy would hide a document
    the founder is entitled to download."""
    assert agreements.is_legacy_signature("facility-v1", "tir") is False


def test_vip_signature_is_not_legacy_for_its_single_agreement():
    assert agreements.is_legacy_signature("facility-v1", "sip") is False


def test_a_tir_only_signature_is_legacy_for_vip():
    """collaboration-v1 is not on VIP's list at all, so a row carrying only
    it has nothing retrievable on that track."""
    assert agreements.is_legacy_signature("collaboration-v1", "sip") is True


def test_unsigned_is_never_legacy():
    assert agreements.is_legacy_signature(None, "tir") is False
    assert agreements.is_legacy_signature("", "tir") is False


def test_whitespace_and_stray_commas_do_not_defeat_the_match():
    assert agreements.is_legacy_signature(" facility-v1 , ", "tir") is False


# ═══════════════════════════════════════════════════════════════════════════
# Field schema for the founder-facing MOU tab (rebuild task): every real
# blank in each template becomes a labelled field, tagged with its owner
# (founder-editable vs ARTPARK constant). Derived from the SAME
# _AGREEMENT_RULES mapping the renderer itself uses, not re-guessed.
# ═══════════════════════════════════════════════════════════════════════════

def _entry(track: str, slug: str) -> dict:
    return next(a for a in agreements.agreements_for_track(track) if a["slug"] == slug)


def test_facility_constant_schema_covers_every_non_collaborator_blank():
    """The Facility Agreement has 22 total positional '[•]' blanks: 12 are
    the collaborator party details (already in `fields`, 4 per slot x 3
    slots) and the other 10 are ARTPARK business constants -- 9 DISTINCT
    fields, because term_months alone fills 2 of the 10 (the numeral and
    its word form, via the virtual term_months_words key)."""
    entry = _entry("tir", "facility-v1")
    keys = [c["key"] for c in entry["constants"]]
    assert keys == [
        "collaboration_agreement_date", "term_months", "insurance_limit",
        "availability_windows.dedicated_seating", "availability_windows.lab_space",
        "availability_windows.computing", "availability_windows.wifi",
        "availability_windows.conference_rooms", "availability_windows.access_badge",
    ]
    assert all(c["owner"] == "artpark" for c in entry["constants"])
    assert all(c["label"].strip() for c in entry["constants"])
    for c in entry["constants"]:
        assert "[•]" not in c["label"]
        assert "None" not in c["label"]


def test_collaboration_constant_schema_covers_its_two_named_blanks():
    """[insert areas] (research_area) and [Date of agreement]
    (facility_agreement_date) -- the Collaboration Agreement's own two
    ARTPARK-owned named tokens (agreements._AGREEMENT_RULES['collaboration-v1']
    ['named_token_fills'])."""
    entry = _entry("tir", "collaboration-v1")
    keys = [c["key"] for c in entry["constants"]]
    assert keys == ["research_area", "facility_agreement_date"]
    assert all(c["owner"] == "artpark" for c in entry["constants"])
    assert all(c["label"].strip() for c in entry["constants"])


def test_constant_schema_values_reflect_the_real_unset_state():
    """As shipped, every ARTPARK constant is None -- the schema must report
    that truthfully: never a fabricated value, never silently omitted."""
    facility = _entry("tir", "facility-v1")
    assert all(c["value"] is None for c in facility["constants"])
    collab = _entry("tir", "collaboration-v1")
    assert all(c["value"] is None for c in collab["constants"])


def test_constant_schema_values_reflect_configured_constants(_configured):
    by_key = {c["key"]: c["value"] for c in _entry("tir", "facility-v1")["constants"]}
    assert by_key["term_months"] == 6
    assert by_key["insurance_limit"] == "TEST-INSURANCE-LIMIT-VALUE"
    assert by_key["collaboration_agreement_date"] == "TEST-COLLAB-AGREEMENT-DATE"
    assert by_key["availability_windows.dedicated_seating"] == "TEST-WINDOW-DEDICATED-SEATING"
    assert by_key["availability_windows.access_badge"] == "TEST-WINDOW-ACCESS-BADGE"

    by_key2 = {c["key"]: c["value"] for c in _entry("tir", "collaboration-v1")["constants"]}
    assert by_key2["research_area"] == "TEST-RESEARCH-AREA-ROBOTICS"
    assert by_key2["facility_agreement_date"] == "TEST-FACILITY-AGREEMENT-DATE"


def test_founder_editable_fields_are_unchanged_by_the_constants_addition():
    """Adding `constants` must not disturb the pre-existing `fields` list
    that test_founder_crud.py's router test already pins."""
    entry = _entry("tir", "facility-v1")
    assert [f["key"] for f in entry["fields"]] == ["name", "pan", "parent_name", "address"]


def test_facility_constants_are_grouped_into_the_documents_own_two_sections():
    """The reader-facing UI groups these the way the document itself does:
    the three business terms (paragraphs 13/34/88) first, then Schedule
    II's six-row facilities table -- in the document's own order, not an
    arbitrary one."""
    entry = _entry("tir", "facility-v1")
    sections = [(c["key"], c["section"]) for c in entry["constants"]]
    assert sections == [
        ("collaboration_agreement_date", "Agreement terms"),
        ("term_months", "Agreement terms"),
        ("insurance_limit", "Agreement terms"),
        ("availability_windows.dedicated_seating", "Facilities schedule (Schedule II)"),
        ("availability_windows.lab_space", "Facilities schedule (Schedule II)"),
        ("availability_windows.computing", "Facilities schedule (Schedule II)"),
        ("availability_windows.wifi", "Facilities schedule (Schedule II)"),
        ("availability_windows.conference_rooms", "Facilities schedule (Schedule II)"),
        ("availability_windows.access_badge", "Facilities schedule (Schedule II)"),
    ]


def test_collaboration_constants_are_all_in_the_single_agreement_terms_section():
    entry = _entry("tir", "collaboration-v1")
    assert all(c["section"] == "Agreement terms" for c in entry["constants"])


def test_sip_facility_entry_also_carries_the_constant_schema():
    """The constant schema is per-agreement, not per-track -- SIP's single
    Facility Agreement entry gets the same 9 constants TIR's does."""
    entry = _entry("sip", "facility-v1")
    assert [c["key"] for c in entry["constants"]] == [
        c["key"] for c in _entry("tir", "facility-v1")["constants"]
    ]


# ═══════════════════════════════════════════════════════════════════════════
# Original source .docx — served verbatim so a founder can read exactly
# what was legally verified, never converted or regenerated.
# ═══════════════════════════════════════════════════════════════════════════

def test_source_docx_path_resolves_to_the_real_committed_file():
    for slug in ALL_SLUGS:
        path = agreements.source_docx_path(slug)
        assert path.exists(), f"{slug}: {path} does not exist"
        assert path.suffix == ".docx"
        # A .docx is a zip archive -- confirms this is the real binary, not
        # a stub or a text file with a renamed extension.
        assert path.read_bytes()[:2] == b"PK"


def test_source_docx_path_rejects_an_unknown_slug():
    with pytest.raises(KeyError):
        agreements.source_docx_path("not-a-real-agreement")


# ═══════════════════════════════════════════════════════════════════════════
# Venture name — printed ONLY on the signature/annexure page this module
# generates itself, never inserted into either agreement's verified legal
# body text. Optional and additive: omitting it must reproduce the exact
# pre-existing golden-hash output (see
# test_signed_render_is_byte_identical_to_pre_refactor_golden below).
# ═══════════════════════════════════════════════════════════════════════════

def test_venture_name_is_absent_from_the_signature_page_by_default(_configured):
    pdf = agreements.render_agreement_pdf(
        collaborators=ONE, signer_name="Aditi Rao", date_str="18 Aug 2026",
        signature_png=_PNG, accepted_acks=[], slug="facility-v1",
    )
    extracted = PdfReader(io.BytesIO(pdf)).pages[-1].extract_text() or ""
    assert "Venture" not in extracted


def test_venture_name_appears_on_the_signature_page_when_provided(_configured):
    pdf = agreements.render_agreement_pdf(
        collaborators=ONE, signer_name="Aditi Rao", date_str="18 Aug 2026",
        signature_png=_PNG, accepted_acks=[], slug="facility-v1",
        venture_name="Sarva Robotics",
    )
    extracted = PdfReader(io.BytesIO(pdf)).pages[-1].extract_text() or ""
    assert "Sarva Robotics" in extracted


def test_venture_name_only_appears_on_the_signature_page_never_the_body(_configured):
    """The explicit product decision: this is OUR page, not the verified
    legal text -- so the venture name must never leak into any body page."""
    pdf = agreements.render_agreement_pdf(
        collaborators=ONE, signer_name="Aditi Rao", date_str="18 Aug 2026",
        signature_png=_PNG, accepted_acks=[], slug="facility-v1",
        venture_name="Sarva Robotics",
    )
    pages = PdfReader(io.BytesIO(pdf)).pages
    body_text = "".join(p.extract_text() or "" for p in pages[:-1])
    assert "Sarva Robotics" not in body_text
    assert "Sarva Robotics" in (pages[-1].extract_text() or "")
