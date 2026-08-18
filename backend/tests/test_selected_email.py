"""send_applicant_selected: renders the real TIR / VIP selection templates.

These assert on rendered copy, so they fail if a template is renamed, a
variable stops resolving, or the VIP placeholders are silently dropped.
"""
from __future__ import annotations

import pytest

from app.services.email_service import EmailService


@pytest.fixture()
def svc(monkeypatch):
    s = EmailService()
    sent = {}

    def _capture(to, subject, html, text, reply_to=None):
        sent.update(to=to, subject=subject, html=html, text=text)
        return {"message_id": "m1", "status": "sent"}

    monkeypatch.setattr(s, "send_raw", _capture)
    return s, sent


def test_tir_selection_names_the_grant_the_mou_and_the_tir_tabs(svc):
    s, sent = svc
    s.send_applicant_selected(to="ada@x.com", applicant_name="Ada", track="tir")

    html, text = sent["html"], sent["text"]
    assert sent["to"] == ["ada@x.com"]
    assert "Ada" in html
    # Programme facts sourced from the TIR MOU.
    assert "25,00,000" in html and "six-month" in html
    # The MOU-first instruction and what it unlocks.
    assert "Sign MOU" in html
    for tab in ("Approach", "Organization", "Expense management"):
        assert tab in html, f"TIR tab missing: {tab}"
    # VIP-only tabs must never appear on the TIR mail.
    assert "TLR evaluation" not in html and "MIS filling" not in html
    # Credentials are explicitly unchanged.
    assert "same password" in html
    assert "25,00,000" in text and "Sign MOU" in text


def test_vip_selection_names_the_vip_tabs_not_the_tir_ones(svc):
    s, sent = svc
    s.send_applicant_selected(to="ada@x.com", applicant_name="Ada", track="sip")

    html = sent["html"]
    assert "TLR evaluation" in html and "MIS filling" in html
    for tir_only in ("Approach", "Expense management"):
        assert tir_only not in html, f"TIR-only tab leaked into the VIP mail: {tir_only}"
    assert "Sign MOU" in html and "same password" in html


def test_vip_shouts_when_its_programme_terms_are_still_placeholders(svc):
    """The VIP funding and duration lines are not known. Until they are supplied
    the mail must carry an unmissable DRAFT warning rather than quietly omit
    them — a silently incomplete offer is the dangerous failure here."""
    s, sent = svc
    s.send_applicant_selected(to="ada@x.com", applicant_name="Ada", track="sip")

    assert "DRAFT — NOT FOR SENDING" in sent["html"]
    assert "TO CONFIRM" in sent["html"]
    assert "DRAFT — NOT FOR SENDING" in sent["text"]


def test_supplying_the_vip_terms_removes_the_draft_warning(svc):
    s, sent = svc
    s.send_applicant_selected(
        to="ada@x.com", applicant_name="Ada", track="sip",
        vip_funding_line="<strong>A non-dilutive grant of Rs. 50,00,000</strong>.",
        vip_duration_line="<strong>A twelve-month programme</strong>.",
    )

    html = sent["html"]
    assert "DRAFT — NOT FOR SENDING" not in html
    assert "TO CONFIRM" not in html
    assert "50,00,000" in html and "twelve-month" in html


def test_the_venture_name_personalises_the_opening_when_present(svc):
    s, sent = svc
    s.send_applicant_selected(to="ada@x.com", applicant_name="Ada", track="tir",
                              venture="Acousto-EM Neural Recording")
    assert "Acousto-EM Neural Recording" in sent["html"]


def test_subjects_are_track_specific(svc):
    s, sent = svc
    s.send_applicant_selected(to="a@x.com", applicant_name="Ada", track="tir")
    tir_subject = sent["subject"]
    s.send_applicant_selected(to="a@x.com", applicant_name="Ada", track="sip")
    assert tir_subject != sent["subject"]
    assert "TIR" in tir_subject and "VIP" in sent["subject"]
