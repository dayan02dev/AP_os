"""Gate-2 applicant emails: selection (offered) and the unchanged rejection.

Gate-2 previously sent the applicant nothing. `offered` now sends a
track-specific selection email; `rejected` reuses the SAME gracious template
gate-1 already uses. Everything stays best-effort — a mail failure must never
stop the decision from committing.
"""
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


def _svc(selected, rejected):
    return SimpleNamespace(
        send_applicant_selected=lambda **kw: selected.append(kw),
        send_applicant_decision=lambda **kw: rejected.append(kw),
    )


def test_gate2_offered_sends_NOTHING_yet(monkeypatch):
    """The selection templates exist and render, but are deliberately NOT wired
    to the decision yet: VIP's programme terms are still unconfirmed, the VIP
    portal is not in production, and FOUNDER_PORTAL_ALLOWLIST would block the
    founder the mail invites. Rejection ships first; selection follows once
    those three are resolved."""
    selected, rejected = [], []
    monkeypatch.setattr(decision_email, "get_email_service", lambda: _svc(selected, rejected))
    sb = _SB([{"basic_full_name": "Ada", "basic_email": "ada@x.com"}])

    for track in ("tir", "sip"):
        decision_email.notify_applicant_gate2(
            sb, track=track, application_id="id1", decision="offered")

    assert not selected, "selection email must not fire until it is deliberately enabled"
    assert not rejected


def test_gate2_rejected_reuses_the_existing_rejection_email(monkeypatch):
    """The jury-round decline must be the SAME mail an admin rejection sends."""
    selected, rejected = [], []
    monkeypatch.setattr(decision_email, "get_email_service", lambda: _svc(selected, rejected))
    sb = _SB([{"basic_full_name": "Ada", "basic_email": "ada@x.com"}])

    decision_email.notify_applicant_gate2(sb, track="tir", application_id="id1", decision="rejected")

    assert len(rejected) == 1
    assert rejected[0]["outcome"] == "rejected"
    assert not selected


def test_gate2_waitlist_and_hold_send_nothing(monkeypatch):
    selected, rejected = [], []
    monkeypatch.setattr(decision_email, "get_email_service", lambda: _svc(selected, rejected))
    sb = _SB([{"basic_full_name": "Ada", "basic_email": "ada@x.com"}])

    for d in ("waitlisted", "on_hold"):
        decision_email.notify_applicant_gate2(sb, track="tir", application_id="id1", decision=d)

    assert not selected and not rejected


def test_a_mail_failure_never_escapes(monkeypatch):
    """The decision has already committed by the time we mail — a send failure
    must be swallowed, never surfaced to the admin as a failed decision."""
    def _boom(**_kw):
        raise RuntimeError("resend down")

    monkeypatch.setattr(decision_email, "get_email_service",
                        lambda: SimpleNamespace(send_applicant_decision=_boom))
    sb = _SB([{"basic_full_name": "Ada", "basic_email": "ada@x.com"}])

    decision_email.notify_applicant_gate2(sb, track="tir", application_id="id1", decision="rejected")


def test_missing_applicant_email_is_skipped_quietly(monkeypatch):
    selected = []
    monkeypatch.setattr(decision_email, "get_email_service",
                        lambda: SimpleNamespace(send_applicant_decision=lambda **kw: selected.append(kw)))
    sb = _SB([{"basic_full_name": "Ada", "basic_email": ""}])

    decision_email.notify_applicant_gate2(sb, track="tir", application_id="id1", decision="rejected")

    assert not selected
