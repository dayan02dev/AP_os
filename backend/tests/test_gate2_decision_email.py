"""Gate-2 applicant emails: selection (offered) and the unchanged rejection.

Gate-2 previously sent the applicant nothing. `offered` now sends the selection
email of the application's EFFECTIVE track (TIR or VIP); `rejected` reuses the
SAME gracious template gate-1 already uses. Everything stays best-effort — a
mail failure must never stop the decision from committing.
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
    """Serves `rows` for the applications tables and nothing else; records
    which tables were read."""
    def __init__(self, rows):
        self._rows = rows
        self.tables: list[str] = []

    def table(self, name):
        self.tables.append(name)
        return _Q(self._rows if name.endswith("_applications") else [])


def _svc(selected, rejected):
    return SimpleNamespace(
        send_applicant_selected=lambda **kw: selected.append(kw),
        send_applicant_decision=lambda **kw: rejected.append(kw),
    )


def test_gate2_offered_sends_the_selection_email_for_both_tracks(monkeypatch):
    selected, rejected = [], []
    monkeypatch.setattr(decision_email, "get_email_service", lambda: _svc(selected, rejected))
    sb = _SB([{"basic_full_name": "Ada", "basic_email": "ada@x.com"}])

    decision_email.notify_applicant_gate2(
        sb, track="tir", application_id="id1", decision="offered")
    decision_email.notify_applicant_gate2(
        sb, track="sip", application_id="id2", decision="offered")

    assert [s["track"] for s in selected] == ["tir", "sip"]
    assert all(s["to"] == "ada@x.com" and s["applicant_name"] == "Ada" for s in selected)
    assert "sip_applications" in sb.tables
    assert not rejected


def test_gate2_offered_follows_the_effective_track_of_a_moved_application(monkeypatch):
    """A TIR row moved to VIP (moved_to_track='sip') gets the VIP mail, and a
    VIP row moved to TIR gets the TIR one."""
    selected, rejected = [], []
    monkeypatch.setattr(decision_email, "get_email_service", lambda: _svc(selected, rejected))

    decision_email.notify_applicant_gate2(
        _SB([{"basic_full_name": "Ada", "basic_email": "ada@x.com", "moved_to_track": "sip"}]),
        track="tir", application_id="id1", decision="offered")
    decision_email.notify_applicant_gate2(
        _SB([{"basic_full_name": "Bo", "basic_email": "bo@x.com", "moved_to_track": "tir"}]),
        track="sip", application_id="id2", decision="offered")

    assert [s["track"] for s in selected] == ["sip", "tir"]


def test_gate2_rejected_reuses_the_existing_rejection_email(monkeypatch):
    """The jury-round decline must be the SAME mail an admin rejection sends."""
    selected, rejected = [], []
    monkeypatch.setattr(decision_email, "get_email_service", lambda: _svc(selected, rejected))
    sb = _SB([{"basic_full_name": "Ada", "basic_email": "ada@x.com"}])

    decision_email.notify_applicant_gate2(sb, track="tir", application_id="id1", decision="rejected")

    assert len(rejected) == 1
    assert rejected[0]["outcome"] == "rejected"
    assert rejected[0]["program_label"] == "TIR"
    assert not selected


def test_gate2_rejected_names_vip_for_a_vip_application(monkeypatch):
    selected, rejected = [], []
    monkeypatch.setattr(decision_email, "get_email_service", lambda: _svc(selected, rejected))

    decision_email.notify_applicant_gate2(
        _SB([{"basic_full_name": "Ada", "basic_email": "ada@x.com"}]),
        track="sip", application_id="id1", decision="rejected")
    decision_email.notify_applicant_gate2(
        _SB([{"basic_full_name": "Bo", "basic_email": "bo@x.com", "moved_to_track": "sip"}]),
        track="tir", application_id="id2", decision="rejected")

    assert [r["program_label"] for r in rejected] == ["VIP", "VIP"]
    assert not selected


def test_gate2_waitlist_and_hold_send_nothing(monkeypatch):
    selected, rejected = [], []
    monkeypatch.setattr(decision_email, "get_email_service", lambda: _svc(selected, rejected))
    sb = _SB([{"basic_full_name": "Ada", "basic_email": "ada@x.com"}])

    for track in ("tir", "sip"):
        for d in ("waitlisted", "on_hold"):
            decision_email.notify_applicant_gate2(sb, track=track, application_id="id1", decision=d)

    assert not selected and not rejected


def test_a_mail_failure_never_escapes(monkeypatch):
    """The decision has already committed by the time we mail — a send failure
    must be swallowed, never surfaced to the admin as a failed decision."""
    def _boom(**_kw):
        raise RuntimeError("resend down")

    monkeypatch.setattr(decision_email, "get_email_service",
                        lambda: SimpleNamespace(send_applicant_decision=_boom,
                                                send_applicant_selected=_boom))
    sb = _SB([{"basic_full_name": "Ada", "basic_email": "ada@x.com"}])

    for track in ("tir", "sip"):
        for d in ("rejected", "offered"):
            decision_email.notify_applicant_gate2(sb, track=track, application_id="id1", decision=d)


def test_missing_applicant_email_is_skipped_quietly(monkeypatch):
    selected, rejected = [], []
    monkeypatch.setattr(decision_email, "get_email_service", lambda: _svc(selected, rejected))
    sb = _SB([{"basic_full_name": "Ada", "basic_email": ""}])

    for d in ("rejected", "offered"):
        decision_email.notify_applicant_gate2(sb, track="sip", application_id="id1", decision=d)

    assert not selected and not rejected
