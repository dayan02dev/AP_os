"""Tests for state_machine module — Task 4.

Covers:
  - LEGAL_TRANSITIONS: on_hold + jury_review additions
  - apply_status_change: happy path, illegal transition, missing app
"""
from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException

from app.services import state_machine as sm


# ─── Transition map unit tests ──────────────────────────────────────────

def test_evaluated_allows_on_hold():
    assert "on_hold" in sm.LEGAL_TRANSITIONS["evaluated"]


def test_on_hold_can_release_to_decisions():
    allowed = sm.LEGAL_TRANSITIONS["on_hold"]
    assert {"evaluated", "shortlisted", "rejected", "waitlisted"} <= allowed


def test_shortlisted_allows_jury_review():
    assert "jury_review" in sm.LEGAL_TRANSITIONS["shortlisted"]


def test_jury_review_in_transitions():
    """jury_review must be a key so assert_legal_transition doesn't 422 on withdrawn."""
    assert "jury_review" in sm.LEGAL_TRANSITIONS


def test_on_hold_allows_withdrawn():
    assert "withdrawn" in sm.LEGAL_TRANSITIONS["on_hold"]


def test_jury_review_allows_withdrawn():
    assert "withdrawn" in sm.LEGAL_TRANSITIONS["jury_review"]


# ─── Fake client ────────────────────────────────────────────────────────


class _FakeQuery:
    def __init__(self, parent, name: str):
        self._parent = parent
        self._name = name
        self._mode = "select"
        self._payload: Any = None
        self._eqs: list[tuple[str, Any]] = []

    def select(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def order(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self._eqs.append((col, val))
        return self

    def insert(self, payload):
        self._mode = "insert"
        self._payload = payload
        self._parent.inserts.append((self._name, payload))
        return self

    def update(self, payload):
        self._mode = "update"
        self._payload = payload
        self._parent.updates.append((self._name, payload, list(self._eqs)))
        return self

    def execute(self):
        if self._mode in ("insert", "update"):
            data = self._payload if isinstance(self._payload, list) else (
                [self._payload] if self._payload else [{"ok": True}]
            )
            return SimpleNamespace(data=data, count=len(data))
        rows = self._parent.tables.get(self._name, [])
        for col, val in self._eqs:
            rows = [r for r in rows if r.get(col) == val]
        return SimpleNamespace(data=rows, count=len(rows))


class _FakeAdminClient:
    def __init__(self, tables: dict[str, list[dict]] | None = None):
        self.tables = tables or {}
        self.inserts: list[tuple[str, Any]] = []
        self.updates: list[tuple[str, Any, list]] = []

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(self, name)


# ─── apply_status_change tests ──────────────────────────────────────────


def test_apply_status_change_updates_and_logs(monkeypatch):
    """Happy path: evaluated → shortlisted; returns previous status,
    updates tir_applications, inserts into application_status_log."""
    fake = _FakeAdminClient(tables={
        "tir_applications": [
            {"id": "app-1", "status": "evaluated"},
        ],
        "application_status_log": [],
    })
    monkeypatch.setattr(sm, "get_admin_client", lambda: fake)

    prev = sm.apply_status_change(
        "app-1", "tir",
        to_status="shortlisted",
        changed_by="u1",
        reason="ok",
    )

    assert prev == "evaluated"

    # status update recorded
    app_updates = [u for n, u, eqs in fake.updates if n == "tir_applications"]
    assert len(app_updates) == 1
    assert app_updates[0]["status"] == "shortlisted"

    # status_log insert recorded
    log_inserts = [p for n, p in fake.inserts if n == "application_status_log"]
    assert len(log_inserts) == 1
    log = log_inserts[0]
    assert log["application_id"] == "app-1"
    assert log["application_track"] == "tir"
    assert log["from_status"] == "evaluated"
    assert log["to_status"] == "shortlisted"
    assert log["changed_by"] == "u1"
    assert log["reason"] == "ok"
    assert log["changed_at"] is not None


def test_apply_status_change_illegal_raises_422(monkeypatch):
    """draft → shortlisted is illegal; must raise HTTPException 422
    with code illegal_transition."""
    fake = _FakeAdminClient(tables={
        "tir_applications": [
            {"id": "app-1", "status": "draft"},
        ],
    })
    monkeypatch.setattr(sm, "get_admin_client", lambda: fake)

    with pytest.raises(HTTPException) as exc_info:
        sm.apply_status_change(
            "app-1", "tir",
            to_status="shortlisted",
            changed_by="u1",
        )
    assert exc_info.value.status_code == 422
    assert exc_info.value.detail["code"] == "illegal_transition"


def test_apply_status_change_missing_app_404(monkeypatch):
    """No rows returned → HTTPException 404 with code application_not_found."""
    fake = _FakeAdminClient(tables={
        "tir_applications": [],  # empty
    })
    monkeypatch.setattr(sm, "get_admin_client", lambda: fake)

    with pytest.raises(HTTPException) as exc_info:
        sm.apply_status_change(
            "app-1", "tir",
            to_status="shortlisted",
            changed_by="u1",
        )
    assert exc_info.value.status_code == 404
    assert exc_info.value.detail["code"] == "application_not_found"


def test_apply_status_change_sip_uses_sip_table(monkeypatch):
    """track='sip' must query sip_applications, not tir_applications."""
    fake = _FakeAdminClient(tables={
        "sip_applications": [
            {"id": "sip-1", "status": "evaluated"},
        ],
        "tir_applications": [],  # must NOT be used
        "application_status_log": [],
    })
    monkeypatch.setattr(sm, "get_admin_client", lambda: fake)

    prev = sm.apply_status_change(
        "sip-1", "sip",
        to_status="shortlisted",
        changed_by="u2",
    )
    assert prev == "evaluated"

    app_updates = [u for n, u, eqs in fake.updates if n == "sip_applications"]
    assert len(app_updates) == 1
    assert app_updates[0]["status"] == "shortlisted"


def test_apply_status_change_on_hold_roundtrip(monkeypatch):
    """evaluated → on_hold → shortlisted roundtrip (two separate calls)."""
    fake1 = _FakeAdminClient(tables={
        "tir_applications": [{"id": "app-1", "status": "evaluated"}],
        "application_status_log": [],
    })
    monkeypatch.setattr(sm, "get_admin_client", lambda: fake1)
    prev1 = sm.apply_status_change("app-1", "tir", to_status="on_hold", changed_by="u1")
    assert prev1 == "evaluated"

    fake2 = _FakeAdminClient(tables={
        "tir_applications": [{"id": "app-1", "status": "on_hold"}],
        "application_status_log": [],
    })
    monkeypatch.setattr(sm, "get_admin_client", lambda: fake2)
    prev2 = sm.apply_status_change("app-1", "tir", to_status="shortlisted", changed_by="u1")
    assert prev2 == "on_hold"


def test_jury_review_reachable_from_review_states():
    # Approve → jury_review must be legal from every realistic pre-jury state.
    for frm in ("under_review", "evaluated", "on_hold", "shortlisted"):
        sm.assert_legal_transition(frm, "jury_review")  # must not raise


def test_jury_review_can_be_rejected():
    # Smoke test relies on approve-then-reject of one app.
    sm.assert_legal_transition("jury_review", "rejected")  # must not raise


# ─── VIP/TIR Approve (jury_review) from early statuses ──────────────────


def test_submitted_allows_jury_review():
    """Admin Approve on a freshly-submitted app must not 422."""
    sm.assert_legal_transition("submitted", "jury_review")  # must not raise


def test_ai_screening_allows_jury_review():
    """Admin Approve while AI screening is in-flight must not 422."""
    sm.assert_legal_transition("ai_screening", "jury_review")  # must not raise


def test_screening_failed_allows_jury_review():
    """Admin Approve after AI screening failed must not 422."""
    sm.assert_legal_transition("screening_failed", "jury_review")  # must not raise


def test_submitted_still_allows_rejected():
    """Existing reject path from submitted must remain unaffected."""
    sm.assert_legal_transition("submitted", "rejected")  # must not raise


def test_illegal_transition_from_onboarded_to_jury_review():
    """onboarded → jury_review is not a legal transition; must raise 422."""
    with pytest.raises(HTTPException) as exc_info:
        sm.assert_legal_transition("onboarded", "jury_review")
    assert exc_info.value.status_code == 422
    assert exc_info.value.detail["code"] == "illegal_transition"


# ─── Assignment-driven status workflow (2026-07-06) ─────────────────────


def test_submitted_to_under_review_is_legal():
    from app.services import state_machine
    assert "under_review" in state_machine.LEGAL_TRANSITIONS["submitted"]


def test_advance_to_under_review_only_from_submitted(monkeypatch):
    from app.services import state_machine
    from tests.fixtures.fake_supabase import FakeSupabase
    fake = FakeSupabase({"tir_applications": [{"id": "a1", "status": "submitted"}]})
    monkeypatch.setattr(state_machine, "get_admin_client", lambda: fake)
    assert state_machine.advance_to_under_review_on_assignment("a1", "tir") is True
    assert fake.status_of("tir", "a1") == "under_review"
    # idempotent / no-op when not submitted
    assert state_machine.advance_to_under_review_on_assignment("a1", "tir") is False
    assert fake.status_of("tir", "a1") == "under_review"


def test_advance_noop_when_already_evaluated(monkeypatch):
    from app.services import state_machine
    from tests.fixtures.fake_supabase import FakeSupabase
    fake = FakeSupabase({"sip_applications": [{"id": "a2", "status": "evaluated"}]})
    monkeypatch.setattr(state_machine, "get_admin_client", lambda: fake)
    assert state_machine.advance_to_under_review_on_assignment("a2", "sip") is False
    assert fake.status_of("sip", "a2") == "evaluated"


def test_first_review_flips_under_review_to_evaluated(monkeypatch):
    from app.services import state_machine
    from tests.fixtures.fake_supabase import FakeSupabase
    fake = FakeSupabase({
        "tir_applications": [{"id": "a1", "status": "under_review"}],
        "reviews": [{"id": "r1", "application_id": "a1", "application_track": "tir",
                     "status": "submitted", "submitted_at": "2026-07-01T00:00:00Z"}],
    })
    monkeypatch.setattr(state_machine, "get_admin_client", lambda: fake)
    assert state_machine.auto_transition_to_evaluated_on_first_review("a1", "tir") is True
    assert fake.status_of("tir", "a1") == "evaluated"


def test_no_review_no_flip(monkeypatch):
    from app.services import state_machine
    from tests.fixtures.fake_supabase import FakeSupabase
    fake = FakeSupabase({"sip_applications": [{"id": "a2", "status": "under_review"}], "reviews": []})
    monkeypatch.setattr(state_machine, "get_admin_client", lambda: fake)
    assert state_machine.auto_transition_to_evaluated_on_first_review("a2", "sip") is False
    assert fake.status_of("sip", "a2") == "under_review"


def test_flip_noop_when_not_under_review(monkeypatch):
    from app.services import state_machine
    from tests.fixtures.fake_supabase import FakeSupabase
    fake = FakeSupabase({
        "tir_applications": [{"id": "a3", "status": "evaluated"}],
        "reviews": [{"id": "r", "application_id": "a3", "application_track": "tir",
                     "status": "submitted", "submitted_at": "2026-07-01T00:00:00Z"}],
    })
    monkeypatch.setattr(state_machine, "get_admin_client", lambda: fake)
    assert state_machine.auto_transition_to_evaluated_on_first_review("a3", "tir") is False
    assert fake.status_of("tir", "a3") == "evaluated"
