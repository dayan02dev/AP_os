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
    """The legacy free-text renderer's own version constant — untouched by
    this task, kept only because the one pre-existing production row was
    signed under it."""
    assert founder_mou.TEMPLATE_VERSION == "tir-mou-v2"


# ── multi-agreement signing (Task 7) ────────────────────────────────────


def test_facility_template_version_constant():
    assert founder_mou.FACILITY_TEMPLATE_VERSION == "facility-v1"


def test_current_template_version_joins_every_track_agreement():
    from app.services import agreements
    assert founder_mou.current_template_version("tir") == ",".join(agreements.TRACK_AGREEMENTS["tir"])
    assert founder_mou.current_template_version("sip") == ",".join(agreements.TRACK_AGREEMENTS["sip"])


def test_current_template_version_defaults_to_the_founder_track():
    assert founder_mou.current_template_version() == founder_mou.current_template_version(
        founder_mou.FOUNDER_TRACK
    )


def test_signed_agreement_slugs_parses_a_new_style_row():
    row = {"template_version": "facility-v1,collaboration-v1"}
    assert founder_mou.signed_agreement_slugs(row) == ["facility-v1", "collaboration-v1"]


def test_signed_agreement_slugs_on_the_legacy_row_matches_no_real_agreement():
    """The one pre-existing production row: its template_version is the old
    free-text tag, not a slug list. It must not be mistaken for having
    signed 'facility-v1' just because that happens to be a real slug now."""
    row = {"template_version": "tir-mou-v2"}
    slugs = founder_mou.signed_agreement_slugs(row)
    assert slugs == ["tir-mou-v2"]
    assert "facility-v1" not in slugs
    assert "collaboration-v1" not in slugs


def test_signed_agreement_slugs_handles_a_missing_version_gracefully():
    assert founder_mou.signed_agreement_slugs({}) == []
    assert founder_mou.signed_agreement_slugs({"template_version": None}) == []


# ── signed_pdf_url: direct unit coverage (not fronted by the router's own
# belt-and-braces check — this proves the guard lives inside the function
# itself, not only in routers/founder.py's caller) ─────────────────────


class _Bucket:
    def create_signed_url(self, path, expires_in):
        return {"signedURL": f"https://x/{path}"}


class _Storage:
    def from_(self, bucket):
        return _Bucket()


def _fake_with_mou(monkeypatch, rows):
    from tests.fixtures.fake_supabase import FakeSupabase
    fake = FakeSupabase({"founder_mou": rows})
    fake.storage = _Storage()
    monkeypatch.setattr(founder_mou, "get_admin_client", lambda: fake)
    return fake


def test_signed_pdf_url_returns_none_when_nothing_signed(monkeypatch):
    _fake_with_mou(monkeypatch, [])
    assert founder_mou.signed_pdf_url("app-none") is None


def test_signed_pdf_url_serves_the_legacy_rows_own_path_by_default(monkeypatch):
    _fake_with_mou(monkeypatch, [{
        "application_id": "app1", "signer_name": "OOOO",
        "template_version": "tir-mou-v2", "signed_pdf_path": "app1/mou/signed.pdf",
    }])
    assert founder_mou.signed_pdf_url("app1") == "https://x/app1/mou/signed.pdf"


def test_signed_pdf_url_refuses_a_slug_the_legacy_row_never_signed(monkeypatch):
    """The one production row never produced per-slug PDFs — asking this
    function directly for 'facility-v1' or 'collaboration-v1' against it
    must return None, not a guessed-at path."""
    _fake_with_mou(monkeypatch, [{
        "application_id": "app1", "signer_name": "OOOO",
        "template_version": "tir-mou-v2", "signed_pdf_path": "app1/mou/signed.pdf",
    }])
    assert founder_mou.signed_pdf_url("app1", agreement="facility-v1") is None
    assert founder_mou.signed_pdf_url("app1", agreement="collaboration-v1") is None


def test_signed_pdf_url_resolves_each_agreement_for_a_new_style_row(monkeypatch):
    _fake_with_mou(monkeypatch, [{
        "application_id": "app2", "signer_name": "Priya",
        "template_version": "facility-v1,collaboration-v1",
        "signed_pdf_path": "app2/mou/facility-v1.pdf",
    }])
    assert founder_mou.signed_pdf_url("app2") == "https://x/app2/mou/facility-v1.pdf"
    assert founder_mou.signed_pdf_url("app2", agreement="facility-v1") == (
        "https://x/app2/mou/facility-v1.pdf"
    )
    assert founder_mou.signed_pdf_url("app2", agreement="collaboration-v1") == (
        "https://x/app2/mou/collaboration-v1.pdf"
    )
