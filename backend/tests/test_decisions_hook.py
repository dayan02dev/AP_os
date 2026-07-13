"""record_decision fires the applicant email for rejected/jury_review only,
and email failure never breaks the decision. Fake admin client captures writes."""
from __future__ import annotations

from types import SimpleNamespace

from app.services import decisions


class _Q:
    def __init__(self, parent, name): self._p, self._n = parent, name; self._mode = "select"
    def select(self, *_a, **_k): return self
    def eq(self, *_a, **_k): return self
    def limit(self, *_a, **_k): return self
    def insert(self, payload): self._p.inserts.append((self._n, payload)); return self
    def execute(self):
        if self._n.endswith("_applications"):
            return SimpleNamespace(data=[{"status": "evaluated", "basic_full_name": "Ada", "basic_email": "ada@x.com"}])
        return SimpleNamespace(data=[])


class _SB:
    def __init__(self): self.inserts = []
    def table(self, name): return _Q(self, name)


def _patch(monkeypatch):
    sb = _SB()
    monkeypatch.setattr(decisions, "get_admin_client", lambda: sb)
    monkeypatch.setattr(decisions.state_machine, "apply_status_change", lambda *a, **k: None)
    monkeypatch.setattr(decisions, "write_audit", lambda **k: None)
    calls = []
    monkeypatch.setattr(decisions.decision_email, "notify_applicant_decided",
        lambda _sb, **kw: calls.append(kw))
    return sb, calls


def test_jury_review_triggers_advanced_notify(monkeypatch):
    _sb, calls = _patch(monkeypatch)
    decisions.record_decision(track="tir", application_id="id1", decision="jury_review",
                              rationale=None, decided_by="u1")
    assert calls == [{"track": "tir", "application_id": "id1", "decision": "jury_review"}]


def test_on_hold_does_not_notify(monkeypatch):
    _sb, calls = _patch(monkeypatch)
    decisions.record_decision(track="tir", application_id="id1", decision="on_hold",
                              rationale="x", decided_by="u1")
    assert calls == []


def test_email_failure_does_not_break_decision(monkeypatch):
    _sb, _calls = _patch(monkeypatch)
    monkeypatch.setattr(decisions.decision_email, "notify_applicant_decided",
        lambda _sb, **kw: (_ for _ in ()).throw(RuntimeError("boom")))
    # notify_applicant_decided is best-effort internally, but guard here too:
    out = decisions.record_decision(track="tir", application_id="id1", decision="rejected",
                                    rationale="no", decided_by="u1")
    assert out["decision"] == "rejected"


def test_jury_review_detaches_reviewers(monkeypatch):
    _sb, _calls = _patch(monkeypatch)
    detached = []
    monkeypatch.setattr(
        decisions.applications_query, "detach_application_from_review",
        lambda sb, aid, track, *, remove_batch_link: detached.append((aid, track, remove_batch_link)),
    )
    decisions.record_decision(track="tir", application_id="id1", decision="jury_review",
                              rationale=None, decided_by="u1")
    assert detached == [("id1", "tir", True)]


def test_on_hold_does_not_detach(monkeypatch):
    _sb, _calls = _patch(monkeypatch)
    detached = []
    monkeypatch.setattr(
        decisions.applications_query, "detach_application_from_review",
        lambda *a, **k: detached.append(a),
    )
    decisions.record_decision(track="tir", application_id="id1", decision="on_hold",
                              rationale="x", decided_by="u1")
    assert detached == []
