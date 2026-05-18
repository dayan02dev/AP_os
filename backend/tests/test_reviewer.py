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
    from app.services import reviewer_query, state_machine
    fake = _FakeAdminClient(tables=tables)
    monkeypatch.setattr(rv, "get_admin_client", lambda: fake)
    monkeypatch.setattr(reviewer_query, "get_admin_client", lambda: fake)
    monkeypatch.setattr(state_machine, "get_admin_client", lambda: fake)
    # Capture-only audit so we don't hit a real Supabase from inside
    # write_audit's own get_admin_client() call. Matches the pattern in
    # test_leadership_writes._capture_audit_writes.
    monkeypatch.setattr(rv, "write_audit", lambda **kwargs: None)
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


# ─── GET /reviewer/applications/{track}/{id} ───────────────────────────


def test_app_detail_strips_ai_when_no_submitted_review(
    client, monkeypatch, _clear_overrides,
):
    me = "rev-a"
    _install_db(monkeypatch, {
        "reviewer_assignments": [
            {"id": "a1", "reviewer_user_id": me, "application_id": "app1",
             "application_track": "tir", "assigned_at": "2026-05-16T09:00:00Z",
             "assigned_by": "leader-u", "declined_at": None,
             "reassigned_to": None, "completed_at": None},
        ],
        "tir_applications": [
            {"id": "app1", "answers": {"problem": "x"}, "submitted_at": "2026-05-15T00:00:00Z"},
        ],
        "sip_applications": [],
        "reviews": [],
        "ai_screening": [
            {"id": "ai1", "application_id": "app1", "application_track": "tir",
             "score_problem": 8, "score_solution": 7, "score_overall": 7.5,
             "summary": "Strong on problem framing."},
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.get("/reviewer/applications/tir/app1")
    assert r.status_code == 200
    body = r.json()
    assert body["ai_screening"] is None, "AI must be stripped before submit"


def test_app_detail_includes_ai_after_submit(
    client, monkeypatch, _clear_overrides,
):
    me = "rev-a"
    _install_db(monkeypatch, {
        "reviewer_assignments": [
            {"id": "a1", "reviewer_user_id": me, "application_id": "app1",
             "application_track": "tir", "assigned_at": "2026-05-16T09:00:00Z",
             "assigned_by": "leader-u", "declined_at": None,
             "reassigned_to": None, "completed_at": None},
        ],
        "tir_applications": [
            {"id": "app1", "answers": {"problem": "x"}, "submitted_at": "2026-05-15T00:00:00Z"},
        ],
        "sip_applications": [],
        "reviews": [
            {"id": "rev1", "application_id": "app1", "application_track": "tir",
             "reviewer_user_id": me, "submitted_at": "2026-05-17T10:00:00Z",
             "locked_at": "2026-05-17T11:00:00Z",
             "score_problem": 6, "recommendation": "maybe"},
        ],
        "ai_screening": [
            {"id": "ai1", "application_id": "app1", "application_track": "tir",
             "score_problem": 8, "score_overall": 7.5, "summary": "Strong."},
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.get("/reviewer/applications/tir/app1")
    assert r.status_code == 200
    body = r.json()
    assert body["ai_screening"] is not None
    assert body["ai_screening"]["score_overall"] == 7.5


def test_app_detail_403_when_not_assigned(
    client, monkeypatch, _clear_overrides,
):
    me = "rev-a"
    _install_db(monkeypatch, {
        "reviewer_assignments": [],  # no assignment for `me`
        "tir_applications": [
            {"id": "app1", "answers": {"problem": "x"}, "submitted_at": "2026-05-15T00:00:00Z"},
        ],
        "sip_applications": [],
        "reviews": [],
        "ai_screening": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.get("/reviewer/applications/tir/app1")
    assert r.status_code == 403


def test_app_detail_strips_ai_when_review_is_draft(
    client, monkeypatch, _clear_overrides,
):
    """Path C of the privacy boundary: caller has an active assignment AND a
    draft review (submitted_at IS NULL) AND ai_screening data exists — but
    ai_screening MUST still be stripped because the reviewer hasn't submitted
    yet. Tests the `my_review.get("submitted_at")` short-circuit explicitly.
    """
    me = "rev-a"
    _install_db(monkeypatch, {
        "reviewer_assignments": [
            {"id": "a1", "reviewer_user_id": me, "application_id": "app1",
             "application_track": "tir", "assigned_at": "2026-05-16T09:00:00Z",
             "assigned_by": "leader-u", "declined_at": None,
             "reassigned_to": None, "completed_at": None},
        ],
        "tir_applications": [
            {"id": "app1", "answers": {"problem": "x"},
             "submitted_at": "2026-05-15T00:00:00Z"},
        ],
        "sip_applications": [],
        "reviews": [
            # Draft: submitted_at IS NULL, locked_at IS NULL
            {"id": "rev-draft", "application_id": "app1", "application_track": "tir",
             "reviewer_user_id": me, "submitted_at": None, "locked_at": None,
             "score_problem": 4, "recommendation": None},
        ],
        "ai_screening": [
            {"id": "ai1", "application_id": "app1", "application_track": "tir",
             "score_problem": 8, "score_overall": 7.5,
             "summary": "Strong on problem framing."},
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.get("/reviewer/applications/tir/app1")
    assert r.status_code == 200
    body = r.json()
    assert body["my_review"] is not None
    assert body["my_review"]["submitted_at"] is None
    assert body["ai_screening"] is None, \
        "Draft review must not unlock AI screening (anti-anchoring)"


# ─── POST /reviewer/reviews ────────────────────────────────────────────


_VALID_SUBMIT = {
    "application_id": "app1",
    "application_track": "tir",
    "assignment_id": "a1",
    "score_problem": 7,
    "score_solution": 5,
    "score_tech": 6,
    "score_founders": 8,
    "score_commitment": 7,
    "recommendation": "maybe",
    "strengths": None,
    "concerns": None,
    "quick_notes": None,
    "draft": False,
}


def _seed_one_assignment(monkeypatch, reviewer_user_id: str, **extra_rows):
    tables = {
        "reviewer_assignments": [
            {"id": "a1", "reviewer_user_id": reviewer_user_id,
             "application_id": "app1", "application_track": "tir",
             "assigned_at": "2026-05-16T09:00:00Z", "assigned_by": "leader-u",
             "declined_at": None, "reassigned_to": None, "completed_at": None},
        ],
        "tir_applications": [
            {"id": "app1", "answers": {"problem": "x"}, "status": "under_review",
             "submitted_at": "2026-05-15T00:00:00Z"},
        ],
        "sip_applications": [],
        "reviews": [],
        "ai_screening": [],
        "application_status_log": [],
    }
    for k, v in extra_rows.items():
        tables[k] = v
    return _install_db(monkeypatch, tables)


def test_submit_review_rejects_missing_score(client, monkeypatch, _clear_overrides):
    me = "rev-a"
    _seed_one_assignment(monkeypatch, me)
    app.dependency_overrides[get_current_user] = _override_user(me)
    body = dict(_VALID_SUBMIT)
    del body["score_problem"]
    r = client.post("/reviewer/reviews", json=body)
    assert r.status_code == 422


def test_submit_review_rejects_score_out_of_range(client, monkeypatch, _clear_overrides):
    me = "rev-a"
    _seed_one_assignment(monkeypatch, me)
    app.dependency_overrides[get_current_user] = _override_user(me)
    body = dict(_VALID_SUBMIT)
    body["score_solution"] = 11
    r = client.post("/reviewer/reviews", json=body)
    assert r.status_code == 422


def test_submit_review_rejects_score_integrity_field(client, monkeypatch, _clear_overrides):
    me = "rev-a"
    _seed_one_assignment(monkeypatch, me)
    app.dependency_overrides[get_current_user] = _override_user(me)
    body = dict(_VALID_SUBMIT)
    body["score_integrity"] = 6
    r = client.post("/reviewer/reviews", json=body)
    assert r.status_code == 422


def test_submit_review_writes_row_with_60_min_lock(
    client, monkeypatch, _clear_overrides, freezer,
):
    me = "rev-a"
    freezer.move_to("2026-05-18T10:00:00Z")
    fake = _seed_one_assignment(monkeypatch, me)
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.post("/reviewer/reviews", json=_VALID_SUBMIT)
    assert r.status_code == 201, r.text
    # Find the insert into 'reviews'
    review_inserts = [p for n, p in fake.inserts if n == "reviews"]
    assert len(review_inserts) == 1
    row = review_inserts[0]
    assert row["submitted_at"] == "2026-05-18T10:00:00+00:00"
    assert row["locked_at"] == "2026-05-18T11:00:00+00:00"


def test_submit_review_all_reviewers_complete_triggers_evaluated(
    client, monkeypatch, _clear_overrides,
):
    """Closes spec §14.4."""
    me = "rev-a"
    other = "rev-b"
    fake = _seed_one_assignment(
        monkeypatch, me,
        reviewer_assignments=[
            {"id": "a1", "reviewer_user_id": me,
             "application_id": "app1", "application_track": "tir",
             "assigned_at": "2026-05-16T09:00:00Z", "assigned_by": "leader-u",
             "declined_at": None, "reassigned_to": None, "completed_at": None},
            {"id": "a2", "reviewer_user_id": other,
             "application_id": "app1", "application_track": "tir",
             "assigned_at": "2026-05-16T09:00:00Z", "assigned_by": "leader-u",
             "declined_at": None, "reassigned_to": None,
             "completed_at": "2026-05-17T12:00:00Z"},  # other already done
        ],
    )
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.post("/reviewer/reviews", json=_VALID_SUBMIT)
    assert r.status_code == 201, r.text
    # tir_applications should have an update to status=evaluated
    status_updates = [u for n, u, eqs in fake.updates if n == "tir_applications"]
    assert any(u.get("status") == "evaluated" for u in status_updates)


def test_submit_review_partial_completion_does_not_transition(
    client, monkeypatch, _clear_overrides,
):
    me = "rev-a"
    other = "rev-b"
    fake = _seed_one_assignment(
        monkeypatch, me,
        reviewer_assignments=[
            {"id": "a1", "reviewer_user_id": me,
             "application_id": "app1", "application_track": "tir",
             "assigned_at": "2026-05-16T09:00:00Z", "assigned_by": "leader-u",
             "declined_at": None, "reassigned_to": None, "completed_at": None},
            {"id": "a2", "reviewer_user_id": other,
             "application_id": "app1", "application_track": "tir",
             "assigned_at": "2026-05-16T09:00:00Z", "assigned_by": "leader-u",
             "declined_at": None, "reassigned_to": None, "completed_at": None},
        ],
    )
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.post("/reviewer/reviews", json=_VALID_SUBMIT)
    assert r.status_code == 201, r.text
    status_updates = [u for n, u, eqs in fake.updates if n == "tir_applications"]
    assert not any(u.get("status") == "evaluated" for u in status_updates)


def test_draft_does_not_transition_or_lock(
    client, monkeypatch, _clear_overrides, freezer,
):
    me = "rev-a"
    freezer.move_to("2026-05-18T10:00:00Z")
    fake = _seed_one_assignment(monkeypatch, me)
    app.dependency_overrides[get_current_user] = _override_user(me)
    body = dict(_VALID_SUBMIT)
    body["draft"] = True
    r = client.post("/reviewer/reviews", json=body)
    assert r.status_code == 201
    review_inserts = [p for n, p in fake.inserts if n == "reviews"]
    row = review_inserts[0]
    assert row["submitted_at"] is None
    assert row["locked_at"] is None
    status_updates = [u for n, u, eqs in fake.updates if n == "tir_applications"]
    assert not any(u.get("status") == "evaluated" for u in status_updates)
