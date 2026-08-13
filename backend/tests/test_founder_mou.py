"""MOU signing: PDF generation + ordered sign (PDF before status flip)."""
from __future__ import annotations

import base64

import pytest

from app.services import founder_mou


# a 1x1 transparent PNG
_PNG = "data:image/png;base64," + base64.b64encode(
    base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
    )
).decode()


def test_render_signed_pdf_returns_pdf_bytes():
    pdf = founder_mou.render_signed_pdf(
        founder_name="Priya Ramachandran", venture="Neonatal sepsis monitor",
        signer_name="Priya Ramachandran", date_str="2026-07-17", signature_png=_PNG,
    )
    assert pdf[:5] == b"%PDF-", "output must be a PDF"
    assert len(pdf) > 500


def test_decode_signature_png_strips_data_url():
    raw = founder_mou.decode_signature_png(_PNG)
    assert raw[:8] == b"\x89PNG\r\n\x1a\n"


def test_decode_signature_png_rejects_non_png():
    with pytest.raises(ValueError):
        founder_mou.decode_signature_png("data:image/gif;base64,AAAA")


def test_decode_signature_png_accepts_uppercase_mime():
    upper = _PNG.replace("image/png", "image/PNG")
    raw = founder_mou.decode_signature_png(upper)
    assert raw[:8] == b"\x89PNG\r\n\x1a\n"


# ── residency acknowledgements ────────────────────────────────────────


def test_four_acknowledgements_are_defined():
    assert len(founder_mou.ACKNOWLEDGEMENTS) == 4
    assert founder_mou.REQUIRED_ACK_IDS == (
        "full_time_presence",
        "first_right_of_refusal",
        "expense_account_procurement",
        "additional_funding_equity",
    )


def test_acknowledgement_wording_matches_the_brief():
    """Spot-check the substantive clause of each point so a well-meaning
    reword can't silently drop a condition."""
    by_id = {a["id"]: a["text"] for a in founder_mou.ACKNOWLEDGEMENTS}
    assert "full time present at ARTPARK campus" in by_id["full_time_presence"]
    assert "first right of refusal" in by_id["first_right_of_refusal"]
    assert "At no point shall money be paid out" in by_id["expense_account_procurement"]
    assert "equity allocation to ARTPARK" in by_id["additional_funding_equity"]


def test_missing_acknowledgements_lists_all_when_none_accepted():
    assert founder_mou.missing_acknowledgements([]) == list(founder_mou.REQUIRED_ACK_IDS)
    assert founder_mou.missing_acknowledgements(None) == list(founder_mou.REQUIRED_ACK_IDS)


def test_missing_acknowledgements_empty_when_all_accepted():
    assert founder_mou.missing_acknowledgements(list(founder_mou.REQUIRED_ACK_IDS)) == []


def test_missing_acknowledgements_reports_only_the_gap():
    partial = [i for i in founder_mou.REQUIRED_ACK_IDS if i != "first_right_of_refusal"]
    assert founder_mou.missing_acknowledgements(partial) == ["first_right_of_refusal"]


def test_unknown_ack_ids_do_not_satisfy_the_requirement():
    assert founder_mou.missing_acknowledgements(["nope", "whatever"]) == list(
        founder_mou.REQUIRED_ACK_IDS
    )


def test_signed_pdf_embeds_acknowledgement_text():
    """The signed document must record what was agreed, not just that it was."""
    pdf = founder_mou.render_signed_pdf(
        founder_name="Priya Ramachandran", venture="Neonatal sepsis monitor",
        signer_name="Priya Ramachandran", date_str="2026-07-17", signature_png=_PNG,
        accepted_acks=list(founder_mou.REQUIRED_ACK_IDS),
    )
    assert pdf[:5] == b"%PDF-"
    # A PDF with all four acknowledgements stamped in is materially longer
    # than one without.
    bare = founder_mou.render_signed_pdf(
        founder_name="Priya Ramachandran", venture="Neonatal sepsis monitor",
        signer_name="Priya Ramachandran", date_str="2026-07-17", signature_png=_PNG,
    )
    assert len(pdf) > len(bare)


def test_template_version_bumped_for_acknowledgements():
    assert founder_mou.TEMPLATE_VERSION == "tir-mou-v2"
