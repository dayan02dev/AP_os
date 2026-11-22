"""notify_applicant_decided: resolves applicant email, maps decision→outcome,
best-effort send. Mirrors test_assignment_email's fake-client style."""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from app.services import decision_email
from app.services.email_service import EmailService


class _Q:
    def __init__(self, rows): self._rows = rows
    def select(self, *_a, **_k): return self
    def eq(self, *_a, **_k): return self
    def limit(self, *_a, **_k): return self
    def execute(self): return SimpleNamespace(data=self._rows)


class _SB:
    def __init__(self, rows): self._rows = rows
    def table(self, _name): return _Q(self._rows)


def test_jury_review_sends_advanced(monkeypatch):
    calls = []
    monkeypatch.setattr(decision_email, "get_email_service",
        lambda: SimpleNamespace(send_applicant_decision=lambda **kw: calls.append(kw)))
    sb = _SB([{"basic_full_name": "Ada", "basic_email": "ada@x.com"}])
    decision_email.notify_applicant_decided(sb, track="tir", application_id="id1", decision="jury_review")
    assert len(calls) == 1
    assert calls[0]["outcome"] == "advanced" and calls[0]["to"] == "ada@x.com"


def test_rejected_sends_rejected(monkeypatch):
    calls = []
    monkeypatch.setattr(decision_email, "get_email_service",
        lambda: SimpleNamespace(send_applicant_decision=lambda **kw: calls.append(kw)))
    sb = _SB([{"basic_full_name": "Ada", "basic_email": "ada@x.com"}])
    decision_email.notify_applicant_decided(sb, track="sip", application_id="id1", decision="rejected")
    assert calls and calls[0]["outcome"] == "rejected"


def test_other_decisions_send_nothing(monkeypatch):
    calls = []
    monkeypatch.setattr(decision_email, "get_email_service",
        lambda: SimpleNamespace(send_applicant_decision=lambda **kw: calls.append(kw)))
    sb = _SB([{"basic_full_name": "Ada", "basic_email": "ada@x.com"}])
    for d in ("shortlisted", "on_hold", "waitlisted"):
        decision_email.notify_applicant_decided(sb, track="tir", application_id="id1", decision=d)
    assert calls == []


def test_missing_email_is_swallowed(monkeypatch):
    monkeypatch.setattr(decision_email, "get_email_service",
        lambda: SimpleNamespace(send_applicant_decision=lambda **kw: (_ for _ in ()).throw(AssertionError("should not send"))))
    sb = _SB([{"basic_full_name": "Ada", "basic_email": ""}])
    # Must not raise and must not send.
    decision_email.notify_applicant_decided(sb, track="tir", application_id="id1", decision="rejected")


def test_send_failure_is_swallowed(monkeypatch):
    def boom(**_kw): raise RuntimeError("resend down")
    monkeypatch.setattr(decision_email, "get_email_service",
        lambda: SimpleNamespace(send_applicant_decision=boom))
    sb = _SB([{"basic_full_name": "Ada", "basic_email": "ada@x.com"}])
    decision_email.notify_applicant_decided(sb, track="tir", application_id="id1", decision="rejected")  # no raise


def test_notify_threads_program_label_for_sip():
    sb = MagicMock()
    sb.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[{"basic_full_name": "Asha", "basic_email": "asha@x.com"}]
    )
    svc = MagicMock()
    with patch.object(decision_email, "get_email_service", return_value=svc):
        decision_email.notify_applicant_decided(sb, track="sip", application_id="app-1", decision="jury_review")
    kwargs = svc.send_applicant_decision.call_args.kwargs
    assert kwargs["outcome"] == "advanced"
    assert kwargs["program_label"] == "VIP"


class _RecordingQ(_Q):
    def __init__(self, rows, log):
        super().__init__(rows)
        self._log = log

    def select(self, cols, *_a, **_k):
        self._log.append(cols)
        return self


class _RecordingSB:
    """Records the table and columns each read asks for."""
    def __init__(self, rows):
        self._rows = rows
        self.reads: list[tuple[str, str]] = []

    def table(self, name):
        cols: list[str] = []
        self.reads.append((name, cols))
        return _RecordingQ(self._rows, cols)


@pytest.mark.parametrize("decision,outcome", [("jury_review", "advanced"), ("rejected", "rejected")])
def test_sip_gate1_mail_reads_sip_applications_and_names_vip(monkeypatch, decision, outcome):
    calls = []
    monkeypatch.setattr(decision_email, "get_email_service",
        lambda: SimpleNamespace(send_applicant_decision=lambda **kw: calls.append(kw)))
    sb = _RecordingSB([{"basic_full_name": "Udayan Pawar", "basic_email": "u@x.com"}])

    decision_email.notify_applicant_decided(sb, track="sip", application_id="app-1", decision=decision)

    (table, cols), = sb.reads
    assert table == "sip_applications"
    assert {"basic_email", "basic_full_name", "moved_to_track"} <= set(cols[0].split(","))
    assert calls == [{"to": "u@x.com", "applicant_name": "Udayan Pawar", "outcome": outcome,
                      "application_ref": "app-1"[:8], "program_label": "VIP"}]


@pytest.mark.parametrize("native,moved_to,label", [
    ("tir", "sip", "VIP"),   # moved into VIP: hears from VIP
    ("sip", "tir", "TIR"),   # moved out of VIP: hears from TIR
    ("sip", None, "VIP"),
    ("tir", None, "TIR"),
])
def test_gate1_label_follows_the_effective_track(monkeypatch, native, moved_to, label):
    calls = []
    monkeypatch.setattr(decision_email, "get_email_service",
        lambda: SimpleNamespace(send_applicant_decision=lambda **kw: calls.append(kw)))
    sb = _SB([{"basic_full_name": "Ada", "basic_email": "ada@x.com", "moved_to_track": moved_to}])

    for decision in ("jury_review", "rejected"):
        decision_email.notify_applicant_decided(sb, track=native, application_id="id1", decision=decision)

    assert [c["program_label"] for c in calls] == [label, label]


@pytest.mark.parametrize("outcome,subject", [
    ("advanced", "Your ARTPARK application has advanced to the next round"),
    ("rejected", "An update on your ARTPARK application"),
])
def test_vip_gate1_copy_names_vip_never_sip_or_tir(monkeypatch, outcome, subject):
    """Render the real templates the way the hook calls them for a VIP app."""
    svc, sent = EmailService(), {}
    monkeypatch.setattr(svc, "send_raw",
        lambda to, subj, html, text, reply_to=None: sent.update(subject=subj, html=html, text=text))
    monkeypatch.setattr(decision_email, "get_email_service", lambda: svc)
    decision = "jury_review" if outcome == "advanced" else "rejected"

    decision_email.notify_applicant_decided(
        _SB([{"basic_full_name": "Udayan Pawar", "basic_email": "u@x.com"}]),
        track="sip", application_id="app-1", decision=decision)

    assert sent["subject"] == subject
    for body in (sent["html"], sent["text"]):
        assert "Udayan Pawar" in body
        assert "ARTPARK VIP programme" in body
        assert "SIP" not in body and "TIR" not in body
