"""notify_applicant_decided: resolves applicant email, maps decision→outcome,
best-effort send. Mirrors test_assignment_email's fake-client style."""
from __future__ import annotations

from types import SimpleNamespace

from app.services import decision_email


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
