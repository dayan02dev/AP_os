"""A VIP founder signs their own MOU; the two tracks never see each other's."""
from __future__ import annotations

from app.services import founder_mou, founder_query
from tests.fixtures.fake_supabase import FakeSupabase

_MOU_ROWS = [
    {"id": "m1", "track": "tir", "application_id": "shared-id",
     "signer_name": "Tir Founder", "signed_pdf_path": "shared-id/mou/signed.pdf"},
    {"id": "m2", "track": "sip", "application_id": "shared-id",
     "signer_name": "Vip Founder", "signed_pdf_path": "shared-id/mou/signed.pdf"},
]


def test_fetch_mou_reads_the_tir_row_for_tir(monkeypatch):
    fake = FakeSupabase({"founder_mou": list(_MOU_ROWS)})
    monkeypatch.setattr(founder_query, "get_admin_client", lambda: fake)
    assert founder_query.fetch_mou("shared-id", "tir")["signer_name"] == "Tir Founder"


def test_fetch_mou_reads_the_sip_row_for_sip(monkeypatch):
    fake = FakeSupabase({"founder_mou": list(_MOU_ROWS)})
    monkeypatch.setattr(founder_query, "get_admin_client", lambda: fake)
    assert founder_query.fetch_mou("shared-id", "sip")["signer_name"] == "Vip Founder"


def test_unsigned_on_one_track_is_unsigned_even_if_signed_on_the_other(monkeypatch):
    fake = FakeSupabase({"founder_mou": [_MOU_ROWS[0]]})
    monkeypatch.setattr(founder_query, "get_admin_client", lambda: fake)
    assert founder_query.fetch_mou("shared-id", "sip") is None


def test_sign_stamps_the_track_and_flips_the_sip_application(monkeypatch):
    fake = FakeSupabase({
        "founder_mou": [],
        "sip_applications": [{"id": "sapp1", "status": "offered"}],
    })
    monkeypatch.setattr(founder_mou, "get_admin_client", lambda: fake)
    monkeypatch.setattr(founder_mou, "_upload", lambda *a, **k: None)
    monkeypatch.setattr(founder_mou, "render_signed_pdf", lambda **k: b"%PDF-")
    # decode_signature_png enforces the real PNG magic bytes; these tests are
    # about track scoping, and decoding already has its own tests in
    # test_founder_mou.py.
    monkeypatch.setattr(founder_mou, "decode_signature_png", lambda _s: b"\x89PNG\r\n\x1a\n")

    flips: list[tuple] = []
    monkeypatch.setattr(
        founder_mou.state_machine, "apply_status_change",
        lambda app_id, track, **k: flips.append((app_id, track, k.get("to_status"))),
    )

    row = founder_mou.sign_and_onboard(
        application_id="sapp1", user_id="u1", track="sip",
        signer_name="Vip Founder", founder_name="Vip Founder", venture="Dharini",
        signature_png="data:image/png;base64,aGVsbG8gd29ybGQgcGFkZGluZyBzdHJpbmc=",
        acknowledgements=list(founder_mou.REQUIRED_ACK_IDS),
    )
    assert row["track"] == "sip"
    assert flips == [("sapp1", "sip", "onboarded")]


def test_signing_on_sip_is_not_blocked_by_a_tir_row_with_the_same_id(monkeypatch):
    fake = FakeSupabase({
        "founder_mou": [_MOU_ROWS[0]],
        "sip_applications": [{"id": "shared-id", "status": "offered"}],
    })
    monkeypatch.setattr(founder_mou, "get_admin_client", lambda: fake)
    monkeypatch.setattr(founder_mou, "_upload", lambda *a, **k: None)
    monkeypatch.setattr(founder_mou, "render_signed_pdf", lambda **k: b"%PDF-")
    # decode_signature_png enforces the real PNG magic bytes; these tests are
    # about track scoping, and decoding already has its own tests in
    # test_founder_mou.py.
    monkeypatch.setattr(founder_mou, "decode_signature_png", lambda _s: b"\x89PNG\r\n\x1a\n")
    monkeypatch.setattr(founder_mou.state_machine, "apply_status_change",
                        lambda *a, **k: None)

    row = founder_mou.sign_and_onboard(
        application_id="shared-id", user_id="u1", track="sip",
        signer_name="Vip Founder", founder_name="Vip Founder", venture="Dharini",
        signature_png="data:image/png;base64,aGVsbG8gd29ybGQgcGFkZGluZyBzdHJpbmc=",
        acknowledgements=list(founder_mou.REQUIRED_ACK_IDS),
    )
    assert row["track"] == "sip"
