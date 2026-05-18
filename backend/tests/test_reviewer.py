"""Tests for the reviewer endpoints (Phase 1.5).

Mirrors the FakeSupabase pattern used in test_leadership_writes.py:
  - _FakeAdminClient + _FakeQuery for table mocking
  - app.dependency_overrides[get_current_user] for auth
  - monkeypatch on get_admin_client + write_audit

Coverage matrix (this file builds up across Tasks 1-7):
  * /reviewer/assignments — inbox shape, filtering rules
  * /reviewer/applications/{track}/{id} — privacy boundary
  * /reviewer/reviews — submit, draft, validation, auto-transition
  * /reviewer/reviews/{id} — 423 lock, edit-within-window
  * /reviewer/assignments/{id}/decline — happy path + audit
  * /reviewer/reviews — completed list filter
  * /reviewer/reviews/mine — probe endpoint
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from app.deps import get_current_user
from app.main import app


def test_reviewer_router_registered(client):
    """Smoke test: the router is wired into the app."""
    # Hitting the route without auth should 401, not 404.
    r = client.get("/reviewer/assignments")
    assert r.status_code in (401, 403), f"got {r.status_code}; route may not be registered"


# ─── Fake client (copied from test_leadership_writes; kept self-contained
#     so the file is readable without cross-file references) ─────────────


class _FakeQuery:
    def __init__(self, parent, name: str):
        self._parent = parent
        self._name = name
        self._mode = "select"
        self._payload: Any = None
        self._eqs: list[tuple[str, Any]] = []
        self._is_nulls: list[str] = []
        self._not_nulls: list[str] = []

    def select(self, *_a, **_k):  return self
    def order(self, *_a, **_k):   return self
    def limit(self, *_a, **_k):   return self
    def in_(self, *_a, **_k):     return self
    def or_(self, *_a, **_k):     return self
    def range(self, *_a, **_k):   return self
    def neq(self, *_a, **_k):     return self

    def eq(self, col, val):
        self._eqs.append((col, val))
        return self

    def is_(self, col, val):
        if val is None:
            self._is_nulls.append(col)
        return self

    def not_(self):
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
        # Apply eq filters
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


def _override_user(user_id: str, roles: list[str] = None):
    def _f():
        return {
            "user_id": user_id,
            "email": f"{user_id}@x.com",
            "roles": roles or ["reviewer"],
        }
    return _f


@pytest.fixture
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


def _install_db(monkeypatch, tables):
    from app.routers import reviewer as rv
    from app.services import reviewer_query
    fake = _FakeAdminClient(tables=tables)
    monkeypatch.setattr(rv, "get_admin_client", lambda: fake)
    monkeypatch.setattr(reviewer_query, "get_admin_client", lambda: fake)
    return fake


# ─── GET /reviewer/assignments ─────────────────────────────────────────


def test_inbox_returns_only_my_active_assignments(
    client, monkeypatch, _clear_overrides,
):
    me = "rev-a"
    other = "rev-b"
    _install_db(monkeypatch, {
        "reviewer_assignments": [
            {"id": "a1", "reviewer_user_id": me, "application_id": "app1",
             "application_track": "tir", "assigned_at": "2026-05-16T09:00:00Z",
             "assigned_by": "leader-u", "declined_at": None, "reassigned_to": None,
             "completed_at": None},
            {"id": "a2", "reviewer_user_id": other, "application_id": "app2",
             "application_track": "tir", "assigned_at": "2026-05-16T09:00:00Z",
             "assigned_by": "leader-u", "declined_at": None, "reassigned_to": None,
             "completed_at": None},
            {"id": "a3", "reviewer_user_id": me, "application_id": "app3",
             "application_track": "tir", "assigned_at": "2026-05-16T09:00:00Z",
             "assigned_by": "leader-u", "declined_at": "2026-05-17T00:00:00Z",
             "reassigned_to": None, "completed_at": None},
        ],
        "tir_applications": [
            {"id": "app1", "basic_org": "EdTech Co",
             "answers": {"problem": "AI tutoring for K-12 in rural India"},
             "submitted_at": "2026-05-15T00:00:00Z"},
            {"id": "app2", "basic_org": "X", "answers": {}, "submitted_at": "2026-05-15T00:00:00Z"},
            {"id": "app3", "basic_org": "Y", "answers": {}, "submitted_at": "2026-05-15T00:00:00Z"},
        ],
        "sip_applications": [],
        "reviews": [],
        "profiles": [
            {"id": "leader-u", "full_name": "Dev Dayan", "email": "dev@artpark.in"},
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)

    r = client.get("/reviewer/assignments")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "assignments" in body
    ids = [a["assignment_id"] for a in body["assignments"]]
    assert "a1" in ids
    assert "a2" not in ids  # belongs to another reviewer
    assert "a3" not in ids  # declined


def test_inbox_assignment_shape(client, monkeypatch, _clear_overrides):
    me = "rev-a"
    _install_db(monkeypatch, {
        "reviewer_assignments": [
            {"id": "a1", "reviewer_user_id": me, "application_id": "app1",
             "application_track": "tir", "assigned_at": "2026-05-16T09:00:00Z",
             "assigned_by": "leader-u", "declined_at": None, "reassigned_to": None,
             "completed_at": None},
        ],
        "tir_applications": [
            {"id": "app1", "basic_org": "EdTech Co",
             "answers": {"problem": "AI tutoring for K-12 in rural India"},
             "submitted_at": "2026-05-15T00:00:00Z"},
        ],
        "sip_applications": [],
        "reviews": [],
        "profiles": [
            {"id": "leader-u", "full_name": "Dev Dayan", "email": "dev@artpark.in"},
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)

    r = client.get("/reviewer/assignments")
    assert r.status_code == 200
    a = r.json()["assignments"][0]
    assert a["assignment_id"] == "a1"
    assert a["application_track"] == "tir"
    assert a["app_identifier"].startswith("TIR-")
    assert a["problem_one_liner"].startswith("AI tutoring")
    assert a["assigned_by_display"] == "Dev Dayan"
    assert a["my_review"] is None
