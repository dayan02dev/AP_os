"""send_applicant_selected: renders the real TIR / VIP selection templates.

These assert on rendered copy, so they fail if a template is renamed, a
variable stops resolving, or a draft marker / invented VIP term creeps back in.
"""
from __future__ import annotations

import re

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


def test_tir_selection_names_the_grant_and_residency_benefits(svc):
    s, sent = svc
    s.send_applicant_selected(to="ada@x.com", applicant_name="Ada", track="tir")

    html, text = sent["html"], sent["text"]
    assert sent["to"] == ["ada@x.com"]
    assert "Ada" in html
    # Programme facts sourced from the TIR MOU.
    assert "25,00,000" in html and "six-month" in html
    # Onboarding and portal instructions are sent separately from this announcement.
    for removed in ("What happens next", "Sign MOU", "Founder Portal", "first right of refusal"):
        assert removed not in html
    assert "TLR evaluation" not in html and "MIS filling" not in html
    assert "25,00,000" in text and "WHAT HAPPENS NEXT" not in text


def test_vip_selection_mirrors_the_tir_announcement(svc):
    s, sent = svc
    s.send_applicant_selected(to="ada@x.com", applicant_name="Ada", track="sip",
                              venture="Sample Venture")

    html, text = sent["html"], sent["text"]
    assert sent["to"] == ["ada@x.com"]
    for body in (html, text):
        assert "Congratulations, Ada" in body
        assert "Sample Venture" in body
        assert "Venture Innovation Programme (VIP)" in body
        assert "programme terms will follow with your programme agreement" in body
    assert "What the programme gives you" in html
    assert "WHAT THE PROGRAMME GIVES YOU" in text
    # Same concise shape as the TIR announcement: no onboarding instructions.
    for removed in ("What happens next", "Sign MOU", "Founder Portal", "same password"):
        assert removed not in html


def test_vip_selection_is_final_copy_with_no_invented_terms(svc):
    """VIP's funding amount and duration are not known, so the mail must state
    neither — and carry no draft banner or placeholder now that it is sent."""
    s, sent = svc
    s.send_applicant_selected(to="ada@x.com", applicant_name="Ada", track="sip")

    for body in (sent["html"], sent["text"]):
        for marker in ("DRAFT", "NOT FOR SENDING", "TO CONFIRM", "[", "{{"):
            assert marker not in body, f"draft marker in the VIP mail: {marker}"
        assert "Rs." not in body and "₹" not in body and "25,00,000" not in body
        assert not re.search(r"\d+\s*-?\s*month|six-month|twelve-month", body, re.I)
        assert "TIR" not in body and "Technology Innovator" not in body
        assert "SIP" not in body


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
