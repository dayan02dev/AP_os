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
        self._table_calls: dict[str, int] = {}

    def table(self, name: str) -> _FakeQuery:
        self._table_calls[name] = self._table_calls.get(name, 0) + 1
        return _FakeQuery(self, name)

    def table_call_counts(self) -> dict[str, int]:
        return dict(self._table_calls)


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


def test_app_detail_includes_ai_screening_before_submit(
    client, monkeypatch, _clear_overrides,
):
    """Spec 2026-06-12 §1 decision: reviewer prototypes are the source of truth
    and show AI scores pre-submit, so ai_screening must be included even when
    the reviewer has no review yet (anti-anchoring strip is OFF)."""
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
    assert body["ai_screening"] is not None, "AI must be included pre-submit (UI-is-truth)"
    assert body["ai_screening"]["score_overall"] == 7.5


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


def test_app_detail_includes_ai_when_review_is_draft(
    client, monkeypatch, _clear_overrides,
):
    """Spec 2026-06-12 §1 decision: reviewer prototypes are the source of truth
    and show AI scores at all times. A draft review (submitted_at IS NULL) must
    still receive ai_screening — the anti-anchoring strip is OFF entirely.
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
    assert body["ai_screening"] is not None, \
        "AI must be included even on a draft review (UI-is-truth, anti-anchoring OFF)"
    assert body["ai_screening"]["score_overall"] == 7.5


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
    # Non-draft submits require non-empty notes (Task 3); keep the canonical
    # valid body valid.
    "quick_notes": "solid team",
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


def test_submit_review_403_when_not_my_assignment(
    client, monkeypatch, _clear_overrides,
):
    """The capability gate `score_app` is role-wide; this test pins the
    per-assignment ownership check at the route layer."""
    me = "rev-a"
    _seed_one_assignment(monkeypatch, "rev-someone-else")  # assigned to other
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.post("/reviewer/reviews", json=_VALID_SUBMIT)
    assert r.status_code == 403, r.text
    assert r.json()["detail"]["code"] == "not_your_assignment"


def test_submit_review_409_when_review_already_exists(
    client, monkeypatch, _clear_overrides,
):
    """Migration 014 has UNIQUE(application_id, application_track, reviewer_user_id)
    on `reviews`. The router pre-checks so the client sees a clean 409 instead
    of a 502 from the DB unique-violation."""
    me = "rev-a"
    _seed_one_assignment(monkeypatch, me, reviews=[
        {"id": "existing-rev", "application_id": "app1", "application_track": "tir",
         "reviewer_user_id": me, "score_problem": 6, "score_solution": 6,
         "score_tech": 6, "score_founders": 6, "score_commitment": 6,
         "recommendation": "maybe",
         "submitted_at": "2026-05-17T10:00:00Z",
         "locked_at": "2026-05-17T11:00:00Z"},
    ])
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.post("/reviewer/reviews", json=_VALID_SUBMIT)
    assert r.status_code == 409, r.text
    assert r.json()["detail"]["code"] == "review_already_exists"
    assert r.json()["detail"]["review_id"] == "existing-rev"


# ─── POST /reviewer/reviews — Task 3 extensions ────────────────────────
#     flags, disagree_with_ai, notes-required, richer responses


def test_submit_requires_notes(client, monkeypatch, _clear_overrides):
    """Non-draft submits must carry non-empty quick_notes (spec §4.7)."""
    me = "rev-a"
    _seed_one_assignment(monkeypatch, me)
    app.dependency_overrides[get_current_user] = _override_user(me)

    body = dict(_VALID_SUBMIT)
    body["quick_notes"] = None
    r = client.post("/reviewer/reviews", json=body)
    assert r.status_code == 422, r.text
    assert r.json()["detail"]["code"] == "notes_required"

    body["quick_notes"] = "   "  # whitespace-only is still empty
    r = client.post("/reviewer/reviews", json=body)
    assert r.status_code == 422, r.text
    assert r.json()["detail"]["code"] == "notes_required"


def test_submit_persists_flags_and_disagreements(
    client, monkeypatch, _clear_overrides,
):
    me = "rev-a"
    fake = _seed_one_assignment(monkeypatch, me)
    app.dependency_overrides[get_current_user] = _override_user(me)

    body = dict(_VALID_SUBMIT)
    body["flags"] = ["pivot risk", "ip ownership unclear"]
    body["disagree_with_ai"] = {"problem": "AI undersold the pilot data"}
    r = client.post("/reviewer/reviews", json=body)
    assert r.status_code == 201, r.text

    review_inserts = [p for n, p in fake.inserts if n == "reviews"]
    assert len(review_inserts) == 1
    row = review_inserts[0]
    assert row["flags"] == ["pivot risk", "ip ownership unclear"]
    assert row["disagree_with_ai"] == {"problem": "AI undersold the pilot data"}


def test_submit_rejects_more_than_8_flags(client, monkeypatch, _clear_overrides):
    me = "rev-a"
    _seed_one_assignment(monkeypatch, me)
    app.dependency_overrides[get_current_user] = _override_user(me)

    body = dict(_VALID_SUBMIT)
    body["flags"] = [f"flag-{i}" for i in range(9)]
    r = client.post("/reviewer/reviews", json=body)
    assert r.status_code == 422, r.text
    assert r.json()["detail"]["code"] == "flags_invalid"


def test_submit_response_includes_weighted_overall_and_lock(
    client, monkeypatch, _clear_overrides,
):
    """Weights: problem 22 / solution 30 / tech 22 / founders 14 / commitment 12.
    8*.22 + 6*.30 + 7*.22 + 9*.14 + 5*.12 = 6.96"""
    me = "rev-a"
    _seed_one_assignment(monkeypatch, me)
    app.dependency_overrides[get_current_user] = _override_user(me)

    body = dict(_VALID_SUBMIT)
    body.update(score_problem=8, score_solution=6, score_tech=7,
                score_founders=9, score_commitment=5)
    r = client.post("/reviewer/reviews", json=body)
    assert r.status_code == 201, r.text
    payload = r.json()
    assert payload["overall"] == 6.96
    assert payload["editWindowExpiresAt"] is not None


def test_submit_requires_disagreement_reason_on_high_variance(
    client, monkeypatch, _clear_overrides,
):
    """Spec §4.7: |reviewer − AI| > 1.0 on any dimension requires a written
    reason in disagree_with_ai[<short name>]."""
    me = "rev-a"
    _seed_one_assignment(monkeypatch, me, ai_screening=[
        {"application_id": "app1", "application_track": "tir",
         "score_problem": 5.0, "score_completeness": 7.0, "score_tech": 7.0,
         "score_founders": 7.0, "score_commitment": 7.0},
    ])
    app.dependency_overrides[get_current_user] = _override_user(me)

    body = dict(_VALID_SUBMIT)
    # problem: |8.0 − 5.0| = 3.0 → reason required. Every other dimension is
    # within ±1.0 of the AI row (solution maps to AI score_completeness).
    body.update(score_problem=8.0, score_solution=7.0, score_tech=6.0,
                score_founders=8.0, score_commitment=7.0)
    r = client.post("/reviewer/reviews", json=body)
    assert r.status_code == 422, r.text
    detail = r.json()["detail"]
    assert detail["code"] == "disagreement_reason_required"
    assert "problem" in detail["dimensions"]

    body["disagree_with_ai"] = {"problem": "AI missed the pilot data"}
    r = client.post("/reviewer/reviews", json=body)
    assert r.status_code == 201, r.text


def test_draft_save_skips_notes_and_disagreement_validation(
    client, monkeypatch, _clear_overrides,
):
    me = "rev-a"
    _seed_one_assignment(monkeypatch, me, ai_screening=[
        {"application_id": "app1", "application_track": "tir",
         "score_problem": 1.0, "score_completeness": 1.0, "score_tech": 1.0,
         "score_founders": 1.0, "score_commitment": 1.0},
    ])
    app.dependency_overrides[get_current_user] = _override_user(me)

    body = dict(_VALID_SUBMIT)
    body.update(draft=True, quick_notes=None, score_tech=None,
                score_founders=None, score_commitment=None,
                recommendation=None)
    # score_problem stays 7 vs AI 1.0 → variance 6.0, but drafts skip both
    # the notes requirement and the disagreement check.
    r = client.post("/reviewer/reviews", json=body)
    assert r.status_code == 201, r.text


# ─── PATCH /reviewer/reviews/{id} ──────────────────────────────────────


def _freeze_datetime(monkeypatch, iso_utc: str):
    """Patch datetime.now in the reviewer router to a fixed UTC instant.

    Avoids the SENTRY_DSN + freezegun + FastAPI TestClient hang in this
    env. The router calls `datetime.now(timezone.utc)` for submitted_at /
    locked_at math; this swap covers it.
    """
    from datetime import datetime as _dt
    from app.routers import reviewer as rv
    from app.services import reviewer_query as rq

    fixed = _dt.fromisoformat(iso_utc.replace("Z", "+00:00"))

    class _Frozen:
        @classmethod
        def now(cls, tz=None):
            return fixed
        @classmethod
        def fromisoformat(cls, s):
            return _dt.fromisoformat(s)

    monkeypatch.setattr(rv, "datetime", _Frozen)
    monkeypatch.setattr(rq, "datetime", _Frozen)


def test_patch_review_within_window_succeeds(
    client, monkeypatch, _clear_overrides,
):
    me = "rev-a"
    _freeze_datetime(monkeypatch, "2026-05-18T10:30:00Z")
    fake = _install_db(monkeypatch, {
        "reviewer_assignments": [],
        "tir_applications": [],
        "sip_applications": [],
        "reviews": [
            {"id": "rev1", "reviewer_user_id": me,
             "application_id": "app1", "application_track": "tir",
             "submitted_at": "2026-05-18T10:00:00+00:00",
             "locked_at": "2026-05-18T11:00:00+00:00",
             "score_problem": 5, "score_solution": 6, "score_tech": 6,
             "score_founders": 6, "score_commitment": 6,
             "recommendation": "maybe", "quick_notes": "looks ok"},
        ],
        "application_status_log": [],
        "ai_screening": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.patch("/reviewer/reviews/rev1", json={"score_problem": 8})
    assert r.status_code == 200, r.text
    updates = [u for n, u, eqs in fake.updates if n == "reviews"]
    assert any(u.get("score_problem") == 8 for u in updates)


def test_patch_review_after_lock_returns_423(
    client, monkeypatch, _clear_overrides,
):
    me = "rev-a"
    _freeze_datetime(monkeypatch, "2026-05-18T11:01:00Z")
    _install_db(monkeypatch, {
        "reviewer_assignments": [],
        "tir_applications": [],
        "sip_applications": [],
        "reviews": [
            {"id": "rev1", "reviewer_user_id": me,
             "application_id": "app1", "application_track": "tir",
             "submitted_at": "2026-05-18T10:00:00+00:00",
             "locked_at": "2026-05-18T11:00:00+00:00",
             "score_problem": 5, "recommendation": "maybe"},
        ],
        "application_status_log": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.patch("/reviewer/reviews/rev1", json={"score_problem": 8})
    assert r.status_code == 423
    assert r.json()["detail"]["code"] == "review_locked"


def test_patch_review_does_not_extend_lock(
    client, monkeypatch, _clear_overrides,
):
    me = "rev-a"
    _freeze_datetime(monkeypatch, "2026-05-18T10:30:00Z")
    fake = _install_db(monkeypatch, {
        "reviewer_assignments": [],
        "tir_applications": [],
        "sip_applications": [],
        "reviews": [
            {"id": "rev1", "reviewer_user_id": me,
             "application_id": "app1", "application_track": "tir",
             "submitted_at": "2026-05-18T10:00:00+00:00",
             "locked_at": "2026-05-18T11:00:00+00:00",
             "score_problem": 5, "score_solution": 6, "score_tech": 6,
             "score_founders": 6, "score_commitment": 6,
             "recommendation": "maybe", "quick_notes": "looks ok"},
        ],
        "application_status_log": [],
        "ai_screening": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.patch("/reviewer/reviews/rev1", json={"score_problem": 8})
    assert r.status_code == 200
    updates = [u for n, u, eqs in fake.updates if n == "reviews"]
    # No update should touch locked_at
    assert not any("locked_at" in u for u in updates)


def test_patch_review_caller_must_own(
    client, monkeypatch, _clear_overrides,
):
    me = "rev-a"
    _freeze_datetime(monkeypatch, "2026-05-18T10:30:00Z")
    _install_db(monkeypatch, {
        "reviewer_assignments": [],
        "tir_applications": [],
        "sip_applications": [],
        "reviews": [
            {"id": "rev1", "reviewer_user_id": "rev-b",  # NOT me
             "application_id": "app1", "application_track": "tir",
             "submitted_at": "2026-05-18T10:00:00+00:00",
             "locked_at": "2026-05-18T11:00:00+00:00",
             "score_problem": 5, "recommendation": "maybe"},
        ],
        "application_status_log": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.patch("/reviewer/reviews/rev1", json={"score_problem": 8})
    assert r.status_code == 403


def test_patch_draft_review_no_lock_check(client, monkeypatch, _clear_overrides):
    """A draft row has locked_at=NULL. PATCH should succeed regardless of
    'now' because the lock check is conditional on locked_at being set."""
    me = "rev-a"
    _freeze_datetime(monkeypatch, "2026-05-18T10:30:00Z")
    fake = _install_db(monkeypatch, {
        "reviewer_assignments": [],
        "tir_applications": [],
        "sip_applications": [],
        "reviews": [
            {"id": "rev-draft", "reviewer_user_id": me,
             "application_id": "app1", "application_track": "tir",
             "submitted_at": None, "locked_at": None,
             "score_problem": 3, "recommendation": None},
        ],
        "application_status_log": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.patch("/reviewer/reviews/rev-draft", json={"score_problem": 6})
    assert r.status_code == 200, r.text
    updates = [u for n, u, eqs in fake.updates if n == "reviews"]
    assert any(u.get("score_problem") == 6 for u in updates)


def test_patch_flip_draft_to_submitted_runs_full_pipeline(
    client, monkeypatch, _clear_overrides,
):
    """Closes spec §14.4 for the PATCH flip path: full draft with all
    scores, PATCH with draft:false, expect submitted_at + locked_at set,
    assignment completed_at set, and auto-transition fired when sole
    reviewer."""
    me = "rev-a"
    _freeze_datetime(monkeypatch, "2026-05-18T10:00:00Z")
    fake = _install_db(monkeypatch, {
        "reviewer_assignments": [
            {"id": "a1", "reviewer_user_id": me,
             "application_id": "app1", "application_track": "tir",
             "assigned_at": "2026-05-16T09:00:00Z", "assigned_by": "leader-u",
             "declined_at": None, "reassigned_to": None, "completed_at": None},
        ],
        "tir_applications": [
            {"id": "app1", "answers": {"problem": "x"}, "status": "under_review",
             "submitted_at": "2026-05-15T00:00:00Z"},
        ],
        "sip_applications": [],
        "reviews": [
            {"id": "rev-draft", "reviewer_user_id": me, "assignment_id": "a1",
             "application_id": "app1", "application_track": "tir",
             "submitted_at": None, "locked_at": None,
             "score_problem": 7, "score_solution": 5, "score_tech": 6,
             "score_founders": 8, "score_commitment": 7,
             "recommendation": "maybe", "quick_notes": "ok"},
        ],
        "application_status_log": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.patch("/reviewer/reviews/rev-draft", json={"draft": False})
    assert r.status_code == 200, r.text

    # The patch should now include submitted_at + locked_at
    updates = [u for n, u, eqs in fake.updates if n == "reviews"]
    assert any(
        "submitted_at" in u and u["submitted_at"] == "2026-05-18T10:00:00+00:00"
        for u in updates
    )
    assert any(
        "locked_at" in u and u["locked_at"] == "2026-05-18T11:00:00+00:00"
        for u in updates
    )
    # Assignment should be marked complete
    asg_updates = [u for n, u, eqs in fake.updates if n == "reviewer_assignments"]
    assert any(u.get("completed_at") == "2026-05-18T10:00:00+00:00" for u in asg_updates)
    # tir_applications.status should be set to evaluated (sole reviewer, just completed)
    status_updates = [u for n, u, eqs in fake.updates if n == "tir_applications"]
    assert any(u.get("status") == "evaluated" for u in status_updates)


def test_patch_flip_draft_to_submitted_rejects_incomplete(
    client, monkeypatch, _clear_overrides,
):
    """The draft → submitted flip must enforce the same completeness rule
    that POST enforces: all 5 scores + recommendation required."""
    me = "rev-a"
    _freeze_datetime(monkeypatch, "2026-05-18T10:00:00Z")
    _install_db(monkeypatch, {
        "reviewer_assignments": [],
        "tir_applications": [],
        "sip_applications": [],
        "reviews": [
            {"id": "rev-draft", "reviewer_user_id": me, "assignment_id": "a1",
             "application_id": "app1", "application_track": "tir",
             "submitted_at": None, "locked_at": None,
             # Incomplete: only 2 of 5 scores set, no recommendation
             "score_problem": 7, "score_solution": 5, "score_tech": None,
             "score_founders": None, "score_commitment": None,
             "recommendation": None},
        ],
        "application_status_log": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.patch("/reviewer/reviews/rev-draft", json={"draft": False})
    assert r.status_code == 422, r.text
    body = r.json()
    assert body["detail"]["code"] == "incomplete_review"
    missing = set(body["detail"]["missing"])
    assert "score_tech" in missing
    assert "score_founders" in missing
    assert "score_commitment" in missing
    assert "recommendation" in missing


# ─── POST /reviewer/assignments/{id}/decline ───────────────────────────


def test_decline_sets_declined_at_and_reason(
    client, monkeypatch, _clear_overrides,
):
    me = "rev-a"
    _freeze_datetime(monkeypatch, "2026-05-18T10:00:00Z")
    fake = _seed_one_assignment(monkeypatch, me)
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.post(
        "/reviewer/assignments/a1/decline",
        json={"reason": "Not my domain — defer to someone with healthcare context."},
    )
    assert r.status_code == 200, r.text
    updates = [u for n, u, eqs in fake.updates if n == "reviewer_assignments"]
    assert len(updates) == 1
    assert updates[0]["declined_at"] == "2026-05-18T10:00:00+00:00"
    assert "healthcare" in updates[0]["decline_reason"]


def test_decline_requires_min_10_char_reason(
    client, monkeypatch, _clear_overrides,
):
    me = "rev-a"
    _seed_one_assignment(monkeypatch, me)
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.post("/reviewer/assignments/a1/decline", json={"reason": "no"})
    assert r.status_code == 422


def test_decline_blocked_when_not_my_assignment(
    client, monkeypatch, _clear_overrides,
):
    me = "rev-a"
    _seed_one_assignment(monkeypatch, "rev-b")  # assigned to someone else
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.post(
        "/reviewer/assignments/a1/decline",
        json={"reason": "I shouldn't be able to decline this."},
    )
    assert r.status_code == 403


def test_decline_409_when_already_declined(
    client, monkeypatch, _clear_overrides,
):
    me = "rev-a"
    _install_db(monkeypatch, {
        "reviewer_assignments": [
            {"id": "a1", "reviewer_user_id": me,
             "application_id": "app1", "application_track": "tir",
             "assigned_at": "2026-05-16T09:00:00Z", "assigned_by": "leader-u",
             "declined_at": "2026-05-17T00:00:00Z",  # already declined
             "decline_reason": "earlier reason",
             "reassigned_to": None, "completed_at": None},
        ],
        "tir_applications": [],
        "sip_applications": [],
        "reviews": [],
        "ai_screening": [],
        "application_status_log": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.post(
        "/reviewer/assignments/a1/decline",
        json={"reason": "Trying to decline again."},
    )
    assert r.status_code == 409, r.text
    assert r.json()["detail"]["code"] == "already_declined"


def test_decline_404_when_assignment_not_found(
    client, monkeypatch, _clear_overrides,
):
    me = "rev-a"
    _install_db(monkeypatch, {
        "reviewer_assignments": [],
        "tir_applications": [],
        "sip_applications": [],
        "reviews": [],
        "ai_screening": [],
        "application_status_log": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.post(
        "/reviewer/assignments/does-not-exist/decline",
        json={"reason": "Trying to decline a missing assignment."},
    )
    assert r.status_code == 404


# ─── GET /reviewer/reviews?mine=true&locked=true ───────────────────────


def test_completed_list_returns_only_my_locked(
    client, monkeypatch, _clear_overrides,
):
    me = "rev-a"
    _freeze_datetime(monkeypatch, "2026-05-20T10:00:00Z")
    _install_db(monkeypatch, {
        "reviewer_assignments": [],
        "tir_applications": [
            {"id": "app1", "answers": {"problem": "Locked one"},
             "submitted_at": "2026-05-15T00:00:00Z"},
            {"id": "app2", "answers": {"problem": "Unlocked one"},
             "submitted_at": "2026-05-15T00:00:00Z"},
        ],
        "sip_applications": [],
        "reviews": [
            {"id": "r1", "reviewer_user_id": me, "application_id": "app1",
             "application_track": "tir", "submitted_at": "2026-05-18T10:00:00+00:00",
             "locked_at": "2026-05-18T11:00:00+00:00",
             "score_problem": 7, "score_solution": 6, "score_tech": 7,
             "score_founders": 8, "score_commitment": 7, "recommendation": "yes"},
            {"id": "r2", "reviewer_user_id": me, "application_id": "app2",
             "application_track": "tir", "submitted_at": "2026-05-20T09:50:00+00:00",
             "locked_at": "2026-05-20T10:50:00+00:00",  # locked_at > now → not locked yet
             "score_problem": 5, "recommendation": "maybe"},
            {"id": "r3", "reviewer_user_id": "rev-b", "application_id": "app1",
             "application_track": "tir", "submitted_at": "2026-05-18T10:00:00+00:00",
             "locked_at": "2026-05-18T11:00:00+00:00",
             "score_problem": 7, "recommendation": "no"},  # not mine
        ],
        "ai_screening": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.get("/reviewer/reviews?mine=true&locked=true")
    assert r.status_code == 200
    ids = [x["review_id"] for x in r.json()["reviews"]]
    assert "r1" in ids
    assert "r2" not in ids   # locked_at > now → not yet locked
    assert "r3" not in ids   # not mine


def test_completed_list_computes_weighted_overall(
    client, monkeypatch, _clear_overrides,
):
    me = "rev-a"
    _freeze_datetime(monkeypatch, "2026-05-20T10:00:00Z")
    _install_db(monkeypatch, {
        "reviewer_assignments": [],
        "tir_applications": [
            {"id": "app1", "answers": {"problem": "X"},
             "submitted_at": "2026-05-15T00:00:00Z"},
        ],
        "sip_applications": [],
        "reviews": [
            {"id": "r1", "reviewer_user_id": me, "application_id": "app1",
             "application_track": "tir", "submitted_at": "2026-05-18T10:00:00+00:00",
             "locked_at": "2026-05-18T11:00:00+00:00",
             "score_problem": 8, "score_solution": 6, "score_tech": 7,
             "score_founders": 9, "score_commitment": 5, "recommendation": "yes"},
        ],
        "ai_screening": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.get("/reviewer/reviews?mine=true&locked=true")
    rows = r.json()["reviews"]
    # Weights: P22 S30 T22 F14 C12 → (8*22 + 6*30 + 7*22 + 9*14 + 5*12) / 100
    # = (176 + 180 + 154 + 126 + 60) / 100 = 696/100 = 6.96
    assert abs(rows[0]["score_overall_mine"] - 6.96) < 0.01


def test_completed_list_requires_mine_true(
    client, monkeypatch, _clear_overrides,
):
    me = "rev-a"
    _install_db(monkeypatch, {
        "reviewer_assignments": [], "tir_applications": [], "sip_applications": [],
        "reviews": [], "ai_screening": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.get("/reviewer/reviews?locked=true")  # missing mine=true
    assert r.status_code == 400


def test_completed_list_requires_locked_true(
    client, monkeypatch, _clear_overrides,
):
    me = "rev-a"
    _install_db(monkeypatch, {
        "reviewer_assignments": [], "tir_applications": [], "sip_applications": [],
        "reviews": [], "ai_screening": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.get("/reviewer/reviews?mine=true")  # missing locked=true
    assert r.status_code == 400


def test_mine_probe_returns_my_review_for_app(
    client, monkeypatch, _clear_overrides,
):
    me = "rev-a"
    _install_db(monkeypatch, {
        "reviewer_assignments": [], "tir_applications": [], "sip_applications": [],
        "reviews": [
            {"id": "r1", "reviewer_user_id": me, "application_id": "app1",
             "application_track": "tir", "submitted_at": "2026-05-18T10:00:00+00:00",
             "locked_at": "2026-05-18T11:00:00+00:00",
             "score_problem": 7, "recommendation": "yes"},
        ],
        "ai_screening": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.get("/reviewer/reviews/mine?application_id=app1")
    assert r.status_code == 200
    assert r.json()["review"]["id"] == "r1"


def test_mine_probe_returns_null_when_no_review(
    client, monkeypatch, _clear_overrides,
):
    me = "rev-a"
    _install_db(monkeypatch, {
        "reviewer_assignments": [], "tir_applications": [], "sip_applications": [],
        "reviews": [], "ai_screening": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    r = client.get("/reviewer/reviews/mine?application_id=app1")
    assert r.status_code == 200
    assert r.json()["review"] is None


# ─── Half-point score acceptance ──────────────────────────────────────


def test_submit_review_accepts_half_point_scores(
    client, monkeypatch, _clear_overrides,
):
    """Prototype sliders move in 0.5 steps; conint would 422 on 7.5."""
    me = "rev-1"
    fake = _seed_one_assignment(monkeypatch, me)
    app.dependency_overrides[get_current_user] = _override_user(me)

    body = {
        "application_id": "app1",
        "application_track": "tir",
        "assignment_id": "a1",
        "score_problem":    7.5,
        "score_solution":   8.0,
        "score_tech":       6.5,
        "score_founders":   7.0,
        "score_commitment": 7.5,
        "recommendation": "yes",
        "strengths": None,
        "concerns": None,
        "quick_notes": "half-point scores ok",  # notes required on submit
        "draft": False,
    }
    r = client.post("/reviewer/reviews", json=body)
    assert r.status_code == 201, (
        f"Expected 201 but got {r.status_code}; body: {r.text}"
    )
    data = r.json()
    assert data["review"]["score_problem"] == 7.5


def test_submit_review_rejects_non_half_step_score(
    client, monkeypatch, _clear_overrides,
):
    """numeric(4,1) would silently round 7.77 — the API must 422 instead."""
    me = "rev-1"
    _seed_one_assignment(monkeypatch, me)
    app.dependency_overrides[get_current_user] = _override_user(me)
    body = dict(_VALID_SUBMIT)
    body["score_tech"] = 7.77
    r = client.post("/reviewer/reviews", json=body)
    assert r.status_code == 422


# ─── PATCH validation gap fixes ────────────────────────────────────────


def test_patch_rejects_invalid_flags(client, monkeypatch, _clear_overrides):
    """PATCH on a draft review with an over-length flag must 422 flags_invalid.
    The 80-char limit has no DB backstop; the router must catch it before write."""
    me = "rev-a"
    _freeze_datetime(monkeypatch, "2026-05-18T10:30:00Z")
    _install_db(monkeypatch, {
        "reviewer_assignments": [],
        "tir_applications": [],
        "sip_applications": [],
        "reviews": [
            {"id": "rev-draft", "reviewer_user_id": me,
             "application_id": "app1", "application_track": "tir",
             "submitted_at": None, "locked_at": None,
             "score_problem": 5, "recommendation": None,
             "quick_notes": None},
        ],
        "application_status_log": [],
        "ai_screening": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)
    # flag that exceeds the 80-char limit
    r = client.patch("/reviewer/reviews/rev-draft", json={"flags": ["x" * 81]})
    assert r.status_code == 422, r.text
    assert r.json()["detail"]["code"] == "flags_invalid"


def test_patch_submitted_review_enforces_disagreement_gate(
    client, monkeypatch, _clear_overrides,
):
    """Editing an already-submitted review must re-run the spec §4.7
    disagreement gate.  A score change that crosses the >1.0 variance
    threshold without a reason must 422; providing the reason must 200."""
    me = "rev-a"
    _freeze_datetime(monkeypatch, "2026-05-18T10:30:00Z")
    _install_db(monkeypatch, {
        "reviewer_assignments": [],
        "tir_applications": [],
        "sip_applications": [],
        "reviews": [
            # Fully-compliant submitted review, locked_at in the future.
            {"id": "rev1", "reviewer_user_id": me,
             "application_id": "app1", "application_track": "tir",
             "submitted_at": "2026-05-18T10:00:00+00:00",
             "locked_at": "2026-05-18T11:00:00+00:00",
             "score_problem": 7.0, "score_solution": 7.0, "score_tech": 7.0,
             "score_founders": 7.0, "score_commitment": 7.0,
             "recommendation": "maybe", "quick_notes": "solid team",
             "disagree_with_ai": None},
        ],
        "application_status_log": [],
        "ai_screening": [
            # All AI scores 7.0; reviewer bumping problem to 9.0 → |9−7|=2.0 > 1.0
            {"application_id": "app1", "application_track": "tir",
             "score_problem": 7.0, "score_completeness": 7.0,
             "score_tech": 7.0, "score_founders": 7.0, "score_commitment": 7.0},
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)

    # Without disagree_with_ai → 422 disagreement_reason_required
    r = client.patch("/reviewer/reviews/rev1", json={"score_problem": 9.0})
    assert r.status_code == 422, r.text
    detail = r.json()["detail"]
    assert detail["code"] == "disagreement_reason_required"
    assert "problem" in detail["dimensions"]

    # With the required reason → 200
    r = client.patch(
        "/reviewer/reviews/rev1",
        json={"score_problem": 9.0, "disagree_with_ai": {"problem": "pilot data missed by AI"}},
    )
    assert r.status_code == 200, r.text


def test_patch_draft_review_skips_submit_gates(
    client, monkeypatch, _clear_overrides,
):
    """Editing a draft (submitted_at IS NULL) must NOT run submit-time gates.
    A score change with no notes and high variance should still return 200."""
    me = "rev-a"
    _freeze_datetime(monkeypatch, "2026-05-18T10:30:00Z")
    _install_db(monkeypatch, {
        "reviewer_assignments": [],
        "tir_applications": [],
        "sip_applications": [],
        "reviews": [
            {"id": "rev-draft", "reviewer_user_id": me,
             "application_id": "app1", "application_track": "tir",
             "submitted_at": None, "locked_at": None,
             "score_problem": 5.0, "score_solution": 5.0, "score_tech": 5.0,
             "score_founders": 5.0, "score_commitment": 5.0,
             "recommendation": None, "quick_notes": None,
             "disagree_with_ai": None},
        ],
        "application_status_log": [],
        "ai_screening": [
            # High-variance AI row — would trigger disagreement gate on a submitted review
            {"application_id": "app1", "application_track": "tir",
             "score_problem": 1.0, "score_completeness": 1.0,
             "score_tech": 1.0, "score_founders": 1.0, "score_commitment": 1.0},
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)

    # score_problem 9.0 vs AI 1.0 → variance 8.0; no notes, no disagree_with_ai
    # On a draft these gates must be skipped entirely → 200
    r = client.patch("/reviewer/reviews/rev-draft", json={"score_problem": 9.0})
    assert r.status_code == 200, r.text


# ─── New hardening tests ────────────────────────────────────────────────


def test_submit_disagreement_gate_on_commit_dimension(
    client, monkeypatch, _clear_overrides,
):
    """'commit' is the client-facing short key for score_commitment.
    Variance >1.0 on commitment requires disagree_with_ai['commit']; providing
    it clears the gate."""
    me = "rev-a"
    _seed_one_assignment(monkeypatch, me, ai_screening=[
        {"application_id": "app1", "application_track": "tir",
         "score_problem": 7.0, "score_completeness": 7.0, "score_tech": 7.0,
         "score_founders": 7.0, "score_commitment": 5.0,
         "score_completeness": 7.0},
    ])
    app.dependency_overrides[get_current_user] = _override_user(me)

    body = dict(_VALID_SUBMIT)
    # commitment: |8.0 − 5.0| = 3.0 → reason required; all others within ±1.0
    body.update(
        score_problem=7.0, score_solution=7.0, score_tech=7.0,
        score_founders=7.0, score_commitment=8.0,
    )

    # Without reason → 422, "commit" in dimensions
    r = client.post("/reviewer/reviews", json=body)
    assert r.status_code == 422, r.text
    detail = r.json()["detail"]
    assert detail["code"] == "disagreement_reason_required"
    assert "commit" in detail["dimensions"]

    # With reason under the 'commit' key → 201
    body["disagree_with_ai"] = {"commit": "AI undervalued commitment"}
    r = client.post("/reviewer/reviews", json=body)
    assert r.status_code == 201, r.text


def test_submit_disagreement_boundary_exactly_one_is_allowed(
    client, monkeypatch, _clear_overrides,
):
    """The gate uses strict > 1.0, so a delta of exactly 1.0 must NOT require a
    reason and must return 201."""
    me = "rev-a"
    _seed_one_assignment(monkeypatch, me, ai_screening=[
        {"application_id": "app1", "application_track": "tir",
         "score_problem": 6.0, "score_completeness": 7.0, "score_tech": 7.0,
         "score_founders": 7.0, "score_commitment": 7.0},
    ])
    app.dependency_overrides[get_current_user] = _override_user(me)

    body = dict(_VALID_SUBMIT)
    # problem: |7.0 − 6.0| = 1.0 exactly → NOT > 1.0 → no reason needed
    body.update(
        score_problem=7.0, score_solution=7.0, score_tech=7.0,
        score_founders=7.0, score_commitment=7.0,
    )
    r = client.post("/reviewer/reviews", json=body)
    assert r.status_code == 201, r.text


def test_submit_accepts_exactly_8_flags_of_80_chars(
    client, monkeypatch, _clear_overrides,
):
    """8 flags each of exactly 80 chars is the boundary that must pass (both
    max-count and max-length are inclusive)."""
    me = "rev-a"
    _seed_one_assignment(monkeypatch, me)
    app.dependency_overrides[get_current_user] = _override_user(me)

    body = dict(_VALID_SUBMIT)
    body["flags"] = ["x" * 80 for _ in range(8)]
    r = client.post("/reviewer/reviews", json=body)
    assert r.status_code == 201, r.text


def test_patch_text_only_edit_on_submitted_review_skips_ai_fetch(
    client, monkeypatch, _clear_overrides,
):
    """A text-only PATCH (quick_notes only) on a submitted review within the
    lock window must succeed even when there is NO ai_screening row.  This
    proves the gated fetch path: score columns absent → ai_row stays None →
    _validate_disagreements no-ops."""
    me = "rev-a"
    _freeze_datetime(monkeypatch, "2026-05-18T10:30:00Z")
    _install_db(monkeypatch, {
        "reviewer_assignments": [],
        "tir_applications": [],
        "sip_applications": [],
        "reviews": [
            # Fully-compliant submitted review; locked_at in the future.
            {"id": "rev1", "reviewer_user_id": me,
             "application_id": "app1", "application_track": "tir",
             "submitted_at": "2026-05-18T10:00:00+00:00",
             "locked_at": "2026-05-18T11:00:00+00:00",
             "score_problem": 7.0, "score_solution": 7.0, "score_tech": 7.0,
             "score_founders": 7.0, "score_commitment": 7.0,
             "recommendation": "maybe", "quick_notes": "original notes",
             "disagree_with_ai": None},
        ],
        "application_status_log": [],
        # No ai_screening row — fetch must be skipped entirely for text-only PATCH
        "ai_screening": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)

    r = client.patch("/reviewer/reviews/rev1", json={"quick_notes": "updated"})
    assert r.status_code == 200, r.text


# ─── GET /reviewer/queue (Task 6) ──────────────────────────────────────


def test_queue_shape_includes_ai_due_and_review_status(
    client, monkeypatch, _clear_overrides,
):
    """Spec §4.2 canonical queue: AI block, due date, review status chip.
    app-1 (tir) has AI + a submitted review; app-2 (sip) has neither.
    app-3 (tir) has a draft review — exercises the 'draft' reviewStatus branch."""
    me = "rev-1"
    _install_db(monkeypatch, {
        "reviewer_assignments": [
            {"id": "asg-1", "application_id": "app-1", "application_track": "tir",
             "reviewer_user_id": me, "due_at": "2026-06-20T00:00:00+00:00",
             "declined_at": None, "reassigned_to": None},
            {"id": "asg-2", "application_id": "app-2", "application_track": "sip",
             "reviewer_user_id": me, "due_at": None,
             "declined_at": None, "reassigned_to": None},
            {"id": "asg-3", "application_id": "app-3", "application_track": "tir",
             "reviewer_user_id": me, "due_at": "2026-06-10T00:00:00+00:00",
             "declined_at": None, "reassigned_to": None},
        ],
        "tir_applications": [
            {"id": "app-1", "display_seq": 26001, "basic_full_name": "Aanya Mehta",
             "basic_org": "Karkhana", "solution_stage": "Pilot-ready product",
             "submitted_at": "2026-05-20T00:00:00+00:00", "basic_teammates": []},
            {"id": "app-3", "display_seq": 26003, "basic_full_name": "X",
             "solution_stage": "Prototype built",
             "submitted_at": "2026-05-22T00:00:00+00:00", "basic_teammates": []},
        ],
        "sip_applications": [
            {"id": "app-2", "display_seq": 26002, "basic_full_name": "Priya Iyer",
             "basic_org": "Saathi", "sip_trl": "TRL 5", "sip_traction": "Active pilots",
             "submitted_at": "2026-05-21T00:00:00+00:00", "sip_founders": []},
        ],
        "reviews": [
            {"id": "rv-1", "application_id": "app-1", "application_track": "tir",
             "reviewer_user_id": me, "submitted_at": "2026-06-03T00:00:00+00:00",
             "locked_at": "2026-06-03T01:00:00+00:00"},
            {"id": "rv-3", "application_id": "app-3", "application_track": "tir",
             "reviewer_user_id": me, "submitted_at": None, "locked_at": None},
        ],
        "ai_screening": [
            {"application_id": "app-1", "application_track": "tir",
             "project_name": "Karkhana Robotics", "score_overall": 8.4,
             "confidence": 0.92, "score_problem": 8.6, "score_completeness": 8.2,
             "score_tech": 9.0, "score_founders": 7.8, "score_commitment": 8.4,
             "industry_category_id": "robotics"},
        ],
        "industry_categories": [
            {"id": "robotics", "label": "Robotics & Automation"},
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)

    r = client.get("/reviewer/queue")
    assert r.status_code == 200, r.text
    items = r.json()
    by_id = {item["id"]: item for item in items}

    a1 = by_id["app-1"]
    assert a1["applicationId"] == "TIR-26001"
    assert a1["name"] == "Karkhana Robotics"  # AI project_name wins
    assert a1["industry"] == "Robotics & Automation"
    assert a1["due"] == "2026-06-20T00:00:00+00:00"
    assert a1["ai"]["overall"] == 8.4
    assert a1["ai"]["solution"] == 8.2  # maps score_completeness
    assert a1["ai"]["conf"] == 92
    assert a1["reviewStatus"] == "submitted"
    assert a1["editWindowExpiresAt"] == "2026-06-03T01:00:00+00:00"

    a2 = by_id["app-2"]
    assert a2["applicationId"] == "SIP-26002"
    assert a2["ai"] is None
    assert a2["reviewStatus"] == "not-started"

    a3 = by_id["app-3"]
    assert a3["reviewStatus"] == "draft"

    # Sort order: due ascending, None last → app-3 (06-10), app-1 (06-20), app-2 (None)
    assert items[0]["id"] == "app-3"
    assert items[1]["id"] == "app-1"
    assert items[-1]["id"] == "app-2"


def test_queue_bulk_fetches_without_per_assignment_loop(
    client, monkeypatch, _clear_overrides,
):
    """Perf contract (Task 2): fetch_queue must batch its reads instead of
    looping 3 queries per assignment. With 3 active assignments (tir+sip mix)
    the reviewer_assignments / ai_screening / reviews tables must each be hit
    no more than twice — proving there's no per-assignment N+1.

    The fake's `.in_()` is a no-op (no filtering), so this test asserts on the
    assembled output + the table-call counts, never on fake-side filtering:
    production filters in Python after the bulk fetch.
    """
    me = "rev-1"
    fake = _install_db(monkeypatch, {
        "reviewer_assignments": [
            {"id": "asg-1", "application_id": "app-1", "application_track": "tir",
             "reviewer_user_id": me, "due_at": "2026-06-20T00:00:00+00:00",
             "declined_at": None, "reassigned_to": None},
            {"id": "asg-2", "application_id": "app-2", "application_track": "sip",
             "reviewer_user_id": me, "due_at": "2026-06-21T00:00:00+00:00",
             "declined_at": None, "reassigned_to": None},
            {"id": "asg-3", "application_id": "app-3", "application_track": "tir",
             "reviewer_user_id": me, "due_at": "2026-06-22T00:00:00+00:00",
             "declined_at": None, "reassigned_to": None},
        ],
        "tir_applications": [
            {"id": "app-1", "display_seq": 26001, "basic_full_name": "Aanya",
             "submitted_at": "2026-05-20T00:00:00+00:00", "basic_teammates": []},
            {"id": "app-3", "display_seq": 26003, "basic_full_name": "Rahul",
             "submitted_at": "2026-05-22T00:00:00+00:00", "basic_teammates": []},
        ],
        "sip_applications": [
            {"id": "app-2", "display_seq": 26002, "basic_full_name": "Priya",
             "submitted_at": "2026-05-21T00:00:00+00:00", "sip_founders": []},
        ],
        "reviews": [],
        "ai_screening": [],
        "industry_categories": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)

    r = client.get("/reviewer/queue")
    assert r.status_code == 200, r.text
    items = r.json()
    ids = {item["id"] for item in items}
    assert ids == {"app-1", "app-2", "app-3"}, ids

    counts = fake.table_call_counts()
    # No per-assignment loop: each of these is queried at most twice
    # (once is the expected single bulk read; allow 2 as headroom).
    assert counts.get("reviewer_assignments", 0) <= 2, counts
    assert counts.get("ai_screening", 0) <= 2, counts
    assert counts.get("reviews", 0) <= 2, counts


# ─── GET /reviewer/applications/{track}/{id}/content ───────────────────


def test_content_endpoint_returns_presenter_shape(client, monkeypatch, _clear_overrides):
    me = "rev-1"
    _install_db(monkeypatch, {
        "reviewer_assignments": [{
            "id": "asg-1", "application_id": "app-1", "application_track": "tir",
            "reviewer_user_id": me, "declined_at": None, "reassigned_to": None,
            "assigned_at": "2026-06-01T00:00:00+00:00"}],
        "tir_applications": [{
            "id": "app-1", "display_seq": 26001, "basic_full_name": "Aanya Mehta",
            "basic_org": "Karkhana", "problem_defined": "Yes",
            "problem_describe": "Robots are costly. Integration is slow.",
            "solution_stage": "Pilot-ready product",
            "submitted_at": "2026-05-20T00:00:00+00:00", "evidence_files": []}],
        "sip_applications": [],
        "reviews": [],
        "ai_screening": [
            {"application_id": "app-1", "application_track": "tir",
             "summary": "Strong robotics play.", "project_name": "Karkhana Robotics",
             "score_overall": 7.5, "score_completeness": 6.0}],
        "industry_categories": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)

    r = client.get("/reviewer/applications/tir/app-1/content")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["aiSummary"] == "Strong robotics play."
    assert body["name"] == "Karkhana Robotics"
    labels = {f["label"] for f in body["fields"]}
    assert {"Problem defined", "Problem description"} <= labels
    assert body["sections"][0]["num"] == "01"
    assert body["attachments"] == []
    # AI numeric block served straight from the content endpoint (no queue fetch).
    assert body["ai"] is not None
    assert body["ai"]["overall"] == 7.5
    assert body["ai"]["solution"] == 6.0  # score_completeness → solution (mig 016 naming)


def test_content_endpoint_404_when_not_assigned(client, monkeypatch, _clear_overrides):
    me = "rev-1"
    _install_db(monkeypatch, {
        "reviewer_assignments": [], "tir_applications": [], "sip_applications": [],
        "reviews": [], "ai_screening": [], "industry_categories": []})
    app.dependency_overrides[get_current_user] = _override_user(me)

    r = client.get("/reviewer/applications/tir/app-x/content")
    assert r.status_code == 404


# ─── GET /reviewer/history ─────────────────────────────────────────────


def test_history_rows_variance_and_admin_decision(
    client, monkeypatch, _clear_overrides,
):
    """Spec §4.5 — submitted reviews, AI variance, admin-decision mapping.
    Three submitted reviews exercise the three decision branches:
      app-1 shortlisted → approved, app-2 rejected → rejected,
      app-3 under_review → pending."""
    me = "rev-1"
    _install_db(monkeypatch, {
        "reviews": [
            {"id": "rv-1", "application_id": "app-1", "application_track": "tir",
             "reviewer_user_id": me,
             "score_problem": 8.0, "score_solution": 8.0, "score_tech": 8.0,
             "score_founders": 8.0, "score_commitment": 8.0,
             "recommendation": "yes",
             "submitted_at": "2026-06-03T00:00:00+00:00",
             "locked_at": "2026-06-03T01:00:00+00:00"},
            {"id": "rv-2", "application_id": "app-2", "application_track": "tir",
             "reviewer_user_id": me,
             "score_problem": 6.0, "score_solution": 6.0, "score_tech": 6.0,
             "score_founders": 6.0, "score_commitment": 6.0,
             "recommendation": "no",
             "submitted_at": "2026-06-02T00:00:00+00:00",
             "locked_at": "2026-06-02T01:00:00+00:00"},
            {"id": "rv-3", "application_id": "app-3", "application_track": "tir",
             "reviewer_user_id": me,
             "score_problem": 7.0, "score_solution": 7.0, "score_tech": 7.0,
             "score_founders": 7.0, "score_commitment": 7.0,
             "recommendation": "maybe",
             "submitted_at": "2026-06-01T00:00:00+00:00",
             "locked_at": "2026-06-01T01:00:00+00:00"},
            # A draft (no submitted_at) must NOT appear in history.
            {"id": "rv-4", "application_id": "app-4", "application_track": "tir",
             "reviewer_user_id": me, "submitted_at": None, "locked_at": None},
        ],
        "tir_applications": [
            {"id": "app-1", "display_seq": 26001, "basic_org": "Karkhana",
             "status": "shortlisted", "submitted_at": "2026-05-20T00:00:00+00:00"},
            {"id": "app-2", "display_seq": 26002, "basic_org": "Saathi",
             "status": "rejected", "submitted_at": "2026-05-19T00:00:00+00:00"},
            {"id": "app-3", "display_seq": 26003, "basic_org": "Vidya",
             "status": "under_review", "submitted_at": "2026-05-18T00:00:00+00:00"},
        ],
        "sip_applications": [],
        "ai_screening": [
            {"application_id": "app-1", "application_track": "tir",
             "score_overall": 8.5, "project_name": "Karkhana Robotics"},
        ],
        "reviewer_assignments": [], "industry_categories": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(me)

    r = client.get("/reviewer/history")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["stats"]["total"] == 3
    assert body["stats"]["consistencyPct"] is None
    assert body["stats"]["avgMinutes"] is None
    # Only app-1 has an AI overall → it's the only row with a variance.
    assert body["stats"]["avgVariance"] == 0.5

    by_id = {row["appId"]: row for row in body["rows"]}

    a1 = by_id["app-1"]
    assert a1["myScore"] == 8.0          # weighted mean of all-8s
    assert a1["aiScore"] == 8.5
    assert a1["variance"] == 0.5
    assert a1["adminDecision"] == "approved"   # shortlisted → approved
    assert a1["reco"] == "yes"
    assert a1["name"] == "Karkhana Robotics"   # AI project_name wins

    a2 = by_id["app-2"]
    assert a2["adminDecision"] == "rejected"   # rejected → rejected
    assert a2["aiScore"] is None               # no AI row
    assert a2["variance"] is None
    assert a2["name"] == "Saathi"              # falls back to basic_org

    a3 = by_id["app-3"]
    assert a3["adminDecision"] == "pending"    # under_review → pending

    # Newest submitted first.
    assert [row["appId"] for row in body["rows"]] == ["app-1", "app-2", "app-3"]


# ─── GET /reviewer/rubric ──────────────────────────────────────────────


def test_rubric_endpoint_versioned_and_weighted(client, _clear_overrides):
    app.dependency_overrides[get_current_user] = _override_user("rev-1")
    r = client.get("/reviewer/rubric?track=tir")
    assert r.status_code == 200
    body = r.json()
    assert body["version"] == "v3.1"
    assert sum(d["weight"] for d in body["dimensions"]) == 100
    assert [d["key"] for d in body["dimensions"]] == ["problem", "solution", "tech", "founders", "commit"]
    assert body["title"].startswith("TIR")
    # every dimension has all 5 anchor tiers
    for d in body["dimensions"]:
        assert set(d["anchors"].keys()) == {"10", "8", "6", "4", "2"}


def test_rubric_endpoint_sip_track_title(client, _clear_overrides):
    app.dependency_overrides[get_current_user] = _override_user("rev-1")
    r = client.get("/reviewer/rubric?track=sip")
    assert r.status_code == 200
    body = r.json()
    assert body["title"].startswith("VIP")


def test_rubric_weights_match_score_weights(client, _clear_overrides):
    """Guard: rubric dimension weights must stay in lockstep with _SCORE_WEIGHTS."""
    from app.services import rubric as rubric_service
    from app.services.reviewer_query import _SCORE_WEIGHTS

    # Map dimension key → _SCORE_WEIGHTS column name
    key_to_col = {
        "problem":   "score_problem",
        "solution":  "score_solution",
        "tech":      "score_tech",
        "founders":  "score_founders",
        "commit":    "score_commitment",
    }
    rubric = rubric_service.get_rubric("tir")
    for dim in rubric["dimensions"]:
        col = key_to_col[dim["key"]]
        assert dim["weight"] == _SCORE_WEIGHTS[col], (
            f"Rubric weight for '{dim['key']}' ({dim['weight']}) "
            f"differs from _SCORE_WEIGHTS['{col}'] ({_SCORE_WEIGHTS[col]})"
        )


def test_rubric_anchor_text_is_locked(client, _clear_overrides):
    """Guard: verbatim anchor text for two sentinel entries so an unintentional
    edit to rubric.py is caught immediately."""
    app.dependency_overrides[get_current_user] = _override_user("rev-1")
    r = client.get("/reviewer/rubric?track=tir")
    assert r.status_code == 200
    dims = r.json()["dimensions"]

    # dimensions[1] is 'solution' (weight 30)
    solution_dim = dims[1]
    assert solution_dim["key"] == "solution"
    assert solution_dim["anchors"]["10"] == (
        "Solution maps 1:1 to problem · differentiated vs all known alternatives"
    )

    # dimensions[4] is 'commit' (weight 12)
    commit_dim = dims[4]
    assert commit_dim["key"] == "commit"
    assert commit_dim["anchors"]["4"] == 'Partial commitment, "validating"'
