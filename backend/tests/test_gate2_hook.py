"""record_gate2_decision must notify the applicant — and must still commit the
decision if that mail fails."""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.services import decisions


@pytest.fixture()
def fake_db(monkeypatch):
    sb = MagicMock()
    sb.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = \
        SimpleNamespace(data=[{"status": "jury_review"}])
    monkeypatch.setattr(decisions, "get_admin_client", lambda: sb)
    monkeypatch.setattr(decisions.state_machine, "assert_legal_transition", lambda *_a, **_k: None)
    monkeypatch.setattr(decisions.state_machine, "apply_status_change", lambda *_a, **_k: "jury_review")
    monkeypatch.setattr(decisions, "write_audit", lambda *_a, **_k: None)
    return sb


@pytest.mark.parametrize("track", ["tir", "sip"])
def test_gate2_offered_notifies_the_applicant(fake_db, monkeypatch, track):
    calls = []
    monkeypatch.setattr(decisions.decision_email, "notify_applicant_gate2",
                        lambda sb, **kw: calls.append(kw))

    decisions.record_gate2_decision(
        track=track, application_id="id1", decision="offered",
        rationale=None, decided_by="admin-1",
    )

    assert calls == [{"track": track, "application_id": "id1", "decision": "offered"}]


def test_gate2_vip_offer_sends_the_vip_selection_mail(fake_db, monkeypatch):
    """End to end through decision_email: a VIP offer mails the VIP template."""
    row = {"status": "jury_review", "basic_full_name": "Ada", "basic_email": "ada@x.com"}
    fake_db.table.return_value.select.return_value.eq.return_value.limit.return_value \
        .execute.return_value = SimpleNamespace(data=[row])
    fake_db.table.return_value.select.return_value.eq.return_value.eq.return_value \
        .limit.return_value.execute.return_value = SimpleNamespace(data=[])
    selected = []
    monkeypatch.setattr(decisions.decision_email, "get_email_service",
                        lambda: SimpleNamespace(send_applicant_selected=lambda **kw: selected.append(kw)))

    out = decisions.record_gate2_decision(
        track="sip", application_id="id1", decision="offered",
        rationale=None, decided_by="admin-1",
    )

    assert out["decision"] == "offered"
    assert selected == [{"to": "ada@x.com", "applicant_name": "Ada", "track": "sip", "venture": ""}]


def test_gate2_rejected_notifies_the_applicant(fake_db, monkeypatch):
    calls = []
    monkeypatch.setattr(decisions.decision_email, "notify_applicant_gate2",
                        lambda sb, **kw: calls.append(kw))

    decisions.record_gate2_decision(
        track="sip", application_id="id2", decision="rejected",
        rationale="Not a fit", decided_by="admin-1",
    )

    assert calls and calls[0]["decision"] == "rejected"


@pytest.mark.parametrize("track", ["tir", "sip"])
def test_a_failing_notification_does_not_fail_the_decision(fake_db, monkeypatch, track):
    """The status change and admin_decisions row are already written by the time
    we mail; an email outage must not surface as a failed decision."""
    def _boom(*_a, **_k):
        raise RuntimeError("resend down")

    monkeypatch.setattr(decisions.decision_email, "notify_applicant_gate2", _boom)

    out = decisions.record_gate2_decision(
        track=track, application_id="id3", decision="offered",
        rationale=None, decided_by="admin-1",
    )

    assert out["decision"] == "offered" and out["gate_stage"] == "gate2"


def test_a_failing_send_does_not_fail_the_decision(fake_db, monkeypatch):
    """Same guarantee with the real notifier: Resend raising mid-send."""
    row = {"status": "jury_review", "basic_full_name": "Ada", "basic_email": "ada@x.com"}
    fake_db.table.return_value.select.return_value.eq.return_value.limit.return_value \
        .execute.return_value = SimpleNamespace(data=[row])

    def _boom(**_kw):
        raise RuntimeError("resend down")

    monkeypatch.setattr(decisions.decision_email, "get_email_service",
                        lambda: SimpleNamespace(send_applicant_selected=_boom))

    out = decisions.record_gate2_decision(
        track="sip", application_id="id4", decision="offered",
        rationale=None, decided_by="admin-1",
    )

    assert out["decision"] == "offered" and out["gate_stage"] == "gate2"
