"""Tests for the leadership write endpoints (Session 6 / Tasks 20-22).

Two tiers (same pattern as test_leadership_reads + test_admin_users):
  - Unit tests using a fake Supabase admin client + dependency overrides
  - Staging integration smoke tests gated by RUN_STAGING_TESTS=1

Coverage matrix:
  * state_machine.assert_legal_transition — legal pass, illegal raises 422
  * DELETE /reviewers/{id} — happy path deletes
  * DELETE /reviewers/{id} — blocked when reviews.status=='submitted' exists
  * RBAC — reviewer-only role gets 403 on the unassign endpoint
"""

from __future__ import annotations

import os
from types import SimpleNamespace
from typing import Any

import pytest

from app.deps import get_current_user
from app.main import app
from app.routers import leadership_actions as la_router
from app.services import applications_query
from app.services.state_machine import (
    LEGAL_TRANSITIONS,
    assert_legal_transition,
    legal_next_states,
)
from fastapi import HTTPException


# ─── State machine unit tests ──────────────────────────────────────────


def test_legal_transitions_evaluated_to_shortlisted_is_legal():
    # No raise.
    assert_legal_transition("evaluated", "shortlisted")


def test_legal_transitions_evaluated_to_rejected_is_legal():
    assert_legal_transition("evaluated", "rejected")


def test_legal_transitions_evaluated_to_waitlisted_is_legal():
    assert_legal_transition("evaluated", "waitlisted")


def test_legal_transitions_under_review_to_evaluated_is_legal():
    assert_legal_transition("under_review", "evaluated")


def test_legal_transitions_any_to_withdrawn_is_legal():
    for src in ("submitted", "under_review", "evaluated", "shortlisted", "rejected"):
        assert_legal_transition(src, "withdrawn")


def test_legal_transitions_draft_to_anything_is_illegal():
    # `draft` is not in the map at all — applicant-initiated only.
    with pytest.raises(HTTPException) as exc:
        assert_legal_transition("draft", "submitted")
    assert exc.value.status_code == 422
    assert exc.value.detail["code"] == "illegal_transition"


def test_legal_transitions_rewind_evaluated_to_under_review_is_illegal_with_hint():
    with pytest.raises(HTTPException) as exc:
        assert_legal_transition("evaluated", "under_review")
    assert exc.value.status_code == 422
    assert exc.value.detail["code"] == "illegal_transition"
    assert "hint" in exc.value.detail
    assert "Phase 1.5" in exc.value.detail["hint"]


def test_legal_transitions_withdrawn_is_terminal():
    with pytest.raises(HTTPException) as exc:
        assert_legal_transition("withdrawn", "shortlisted")
    assert exc.value.status_code == 422
    assert exc.value.detail["allowed"] == []


def test_legal_next_states_for_evaluated():
    # on_hold added in Task 4 (state-machine expansion)
    assert legal_next_states("evaluated") == ["on_hold", "rejected", "shortlisted", "waitlisted", "withdrawn"]


def test_legal_next_states_for_none_returns_empty():
    assert legal_next_states(None) == []


def test_legal_next_states_for_unknown_returns_empty():
    assert legal_next_states("blarg") == []


def test_legal_transitions_map_covers_all_phase_1_post_submit_states():
    """Every non-draft Phase 1 status must have a transition entry so
    `legal_next_states(status)` is well-defined for the frontend mirror.

    Statuses with `frozenset()` (terminal/auto) are intentional and excluded
    from the must-have-options check — `withdrawn` is the only such today."""
    expected = {
        "submitted", "ai_screening", "screening_failed", "under_review",
        "evaluated", "shortlisted", "interview", "offered", "onboarded",
        "rejected", "waitlisted", "withdrawn",
    }
    assert expected.issubset(set(LEGAL_TRANSITIONS.keys()))


# ─── Fake admin client (mirrors test_admin_users) ──────────────────────


class _FakeQuery:
    """Chainable stub for supabase-py's table builder.

    Records `inserted`, `updated`, `deleted` payloads so tests can assert
    side effects. Each method returns self so the chain keeps working;
    `execute()` returns whatever pre-loaded data the parent client supplied
    for the table being queried (selects) or a dummy ack (writes).
    """

    def __init__(self, parent, name: str):
        self._parent = parent
        self._name = name
        self._mode: str = "select"  # 'select' | 'insert' | 'update' | 'delete'
        self._payload: Any = None
        self._eqs: list[tuple[str, Any]] = []

    def select(self, *_a, **_k):  return self
    def order(self, *_a, **_k):   return self
    def limit(self, *_a, **_k):   return self
    def in_(self, *_a, **_k):     return self
    def or_(self, *_a, **_k):     return self
    def range(self, *_a, **_k):   return self
    def upsert(self, *_a, **_k):  return self
    def neq(self, *_a, **_k):     return self

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

    def delete(self):
        self._mode = "delete"
        self._parent.deletes.append((self._name, list(self._eqs)))
        return self

    def execute(self):
        if self._mode in ("insert", "update", "delete"):
            # Mimic supabase-py's "returning='representation'" default which
            # echoes the rows back.
            data = self._payload if isinstance(self._payload, list) else (
                [self._payload] if self._payload else [{"ok": True}]
            )
            return SimpleNamespace(data=data, count=len(data))
        # Select — return whatever the table is pre-loaded with.
        rows = self._parent.tables.get(self._name, [])
        return SimpleNamespace(data=rows, count=len(rows))


class _FakeAdminClient:
    def __init__(self, tables: dict[str, list[dict]] | None = None):
        self.tables = tables or {}
        self.inserts: list[tuple[str, Any]] = []
        self.updates: list[tuple[str, Any, list]] = []
        self.deletes: list[tuple[str, list]] = []

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(self, name)


class _RaisingInsertFake(_FakeAdminClient):
    """Variant whose insert().execute() raises a configured exception. Used
    by the UNIQUE-violation conflict test."""

    def __init__(self, tables, error_msg: str):
        super().__init__(tables=tables)
        self._error_msg = error_msg

    def table(self, name):  # noqa: D401
        q = _FakeQuery(self, name)

        def _exec_raise():
            if q._mode == "insert":
                raise Exception(self._error_msg)
            return SimpleNamespace(
                data=self.tables.get(name, []),
                count=len(self.tables.get(name, [])),
            )

        q.execute = _exec_raise  # type: ignore[assignment]
        return q


def _override_user(roles: list[str], user_id: str = "leader-u"):
    def _f():
        return {"user_id": user_id, "email": "leader@x.com", "roles": roles}
    return _f


@pytest.fixture
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


_audit_calls: list[dict] = []


def _capture_audit(**kwargs):
    _audit_calls.append(kwargs)


@pytest.fixture(autouse=True)
def _capture_audit_writes(monkeypatch):
    """Autouse so every test sees write_audit captured into the local list."""
    _audit_calls.clear()
    monkeypatch.setattr(la_router, "write_audit", _capture_audit)
    yield


# ─── Helpers to install a fake DB for a given test scenario ────────────


def _install_db(monkeypatch, tables: dict[str, list[dict]]):
    """Wire the fake admin client into both the router and the
    applications_query module (used by find_application_with_track and the
    re-fetch after reviewer assignment)."""
    fake = _FakeAdminClient(tables=tables)
    monkeypatch.setattr(la_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(applications_query, "get_admin_client", lambda: fake)
    return fake


# ─── DELETE /reviewers/{reviewer_user_id} ──────────────────────────────


def test_unassign_reviewer_happy_path(client, monkeypatch, _clear_overrides):
    app_id = "ffffffff-ffff-ffff-ffff-ffffffffffff"
    fake = _install_db(monkeypatch, {
        "tir_applications": [
            {"id": app_id, "status": "under_review", "user_id": "applicant-u"},
        ],
        "sip_applications": [],
        # No submitted review for rev-1 — unassign allowed.
        "reviews": [],
        "reviewer_assignments": [
            {"reviewer_user_id": "rev-1", "state": "pending"},
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user(["leadership"])

    res = client.delete(
        f"/leadership/applications/{app_id}/reviewers/rev-1",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True
    assert body["reviewer_user_id"] == "rev-1"

    # One delete recorded against reviewer_assignments.
    assert any(name == "reviewer_assignments" for name, _eqs in fake.deletes), fake.deletes

    assert len(_audit_calls) == 1
    assert _audit_calls[0]["action_type"] == "reviewer.unassigned"


def test_unassign_reviewer_blocked_when_review_submitted(
    client, monkeypatch, _clear_overrides,
):
    app_id = "12121212-1212-1212-1212-121212121212"
    _install_db(monkeypatch, {
        "tir_applications": [
            {"id": app_id, "status": "under_review", "user_id": "applicant-u"},
        ],
        "sip_applications": [],
        "reviews": [
            {"id": "rev-row-1", "status": "submitted"},
        ],
        "reviewer_assignments": [
            {"reviewer_user_id": "rev-1", "state": "completed"},
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user(["leadership"])

    res = client.delete(
        f"/leadership/applications/{app_id}/reviewers/rev-1",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "review_already_submitted"


def test_unassign_reviewer_requires_assign_reviewers_capability(client, _clear_overrides):
    app.dependency_overrides[get_current_user] = _override_user(["reviewer"])
    res = client.delete(
        "/leadership/applications/anything/reviewers/rev-1",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 403
    assert res.json()["detail"]["code"] == "missing_capability"


# ─── Auth (401 on missing Bearer) ──────────────────────────────────────


def test_unassign_reviewer_without_auth_returns_401(client):
    res = client.delete("/leadership/applications/any/reviewers/rev-1")
    assert res.status_code == 401


# ─── Staging integration smoke tests (gated) ───────────────────────────


_staging_skip = pytest.mark.skipif(
    not os.getenv("RUN_STAGING_TESTS"),
    reason="set RUN_STAGING_TESTS=1 to enable",
)

_DEFAULT_STAGING_BASE_URL = "https://cdw51c7gid.execute-api.ap-south-1.amazonaws.com"


@pytest.fixture
def staging_base_url() -> str:
    return os.getenv("STAGING_BASE_URL", _DEFAULT_STAGING_BASE_URL)


@pytest.fixture
def staging_leadership_token() -> str:
    tok = os.getenv("STAGING_LEADERSHIP_TOKEN")
    if not tok:
        pytest.skip("STAGING_LEADERSHIP_TOKEN not set; skipping integration test")
    return tok


@pytest.fixture
def staging_reviewer_token() -> str:
    tok = os.getenv("STAGING_REVIEWER_TOKEN")
    if not tok:
        pytest.skip("STAGING_REVIEWER_TOKEN not set; skipping integration test")
    return tok


class TestLeadershipWritesStagingIntegration:
    """Real-network checks against the staging Lambda. RBAC-only assertions
    so we don't mutate live data; status + reviewer mutation paths get
    exercised by manual smoke per the Session 6 acceptance checklist."""

    @_staging_skip
    def test_unassign_reviewer_as_reviewer_returns_403(
        self, staging_reviewer_token, staging_base_url,
    ):
        import httpx
        r = httpx.delete(
            f"{staging_base_url}/leadership/applications/00000000-0000-0000-0000-000000000000/reviewers/whoever",
            headers={"Authorization": f"Bearer {staging_reviewer_token}"},
            timeout=30.0,
        )
        assert r.status_code == 403
        assert r.json()["detail"]["code"] == "missing_capability"


# ─── POST /reviewers bulk assignment ──────────────────────────────────────


def test_assign_reviewers_bulk_creates_rows(client, monkeypatch, _clear_overrides):
    """Happy path: two valid reviewers are created as pending assignments."""
    app_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    fake = _install_db(monkeypatch, {
        "tir_applications": [
            {"id": app_id, "status": "under_review"},
        ],
        "sip_applications": [],
        "user_roles": [
            {"user_id": "rev-1", "role": "reviewer"},
            {"user_id": "rev-2", "role": "reviewer"},
        ],
        "reviewer_assignments": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(["leadership"], user_id="leader-u")

    res = client.post(
        f"/leadership/applications/{app_id}/reviewers",
        json={"reviewer_user_ids": ["rev-1", "rev-2"], "due_at": "2026-06-20T00:00:00Z"},
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["application_id"] == app_id
    assert body["track"] == "tir"

    results_by_id = {r["reviewer_user_id"]: r for r in body["results"]}
    assert results_by_id["rev-1"]["status"] == "created"
    assert results_by_id["rev-2"]["status"] == "created"

    # Two inserts into reviewer_assignments.
    ra_inserts = [payload for name, payload in fake.inserts if name == "reviewer_assignments"]
    assert len(ra_inserts) == 2

    inserted_ids = {row["reviewer_user_id"] for row in ra_inserts}
    assert inserted_ids == {"rev-1", "rev-2"}

    for row in ra_inserts:
        assert row["assigned_by"] == "leader-u"
        assert row["application_track"] == "tir"
        assert row["due_at"] == "2026-06-20T00:00:00Z"
        assert row["state"] == "pending"


def test_assign_reviewers_conflict_and_not_reviewer(client, monkeypatch, _clear_overrides):
    """rev-1 already assigned → already_assigned; stranger-9 has no reviewer role → not_a_reviewer."""
    app_id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    fake = _install_db(monkeypatch, {
        "tir_applications": [
            {"id": app_id, "status": "under_review"},
        ],
        "sip_applications": [],
        "user_roles": [
            {"user_id": "rev-1", "role": "reviewer"},
        ],
        "reviewer_assignments": [
            {"reviewer_user_id": "rev-1", "application_id": app_id, "application_track": "tir", "state": "pending"},
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user(["leadership"])

    res = client.post(
        f"/leadership/applications/{app_id}/reviewers",
        json={"reviewer_user_ids": ["rev-1", "stranger-9"]},
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 200, res.text
    body = res.json()

    results_by_id = {r["reviewer_user_id"]: r for r in body["results"]}
    assert results_by_id["rev-1"]["status"] == "already_assigned"
    assert results_by_id["stranger-9"]["status"] == "not_a_reviewer"

    # No new inserts for reviewer_assignments.
    ra_inserts = [payload for name, payload in fake.inserts if name == "reviewer_assignments"]
    assert ra_inserts == []


def test_assign_reviewers_rejects_empty_id(client, monkeypatch, _clear_overrides):
    """Empty string in reviewer_user_ids → 422 from Pydantic field validator."""
    app_id = "dddddddd-dddd-dddd-dddd-dddddddddddd"
    _install_db(monkeypatch, {
        "tir_applications": [
            {"id": app_id, "status": "under_review"},
        ],
        "sip_applications": [],
        "user_roles": [
            {"user_id": "rev-1", "role": "reviewer"},
        ],
        "reviewer_assignments": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(["leadership"])

    res = client.post(
        f"/leadership/applications/{app_id}/reviewers",
        json={"reviewer_user_ids": ["", "rev-1"]},
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 422


def test_assign_reviewers_404_when_app_missing(client, monkeypatch, _clear_overrides):
    """Application not found in either track table → 404 application_not_found."""
    _install_db(monkeypatch, {
        "tir_applications": [],
        "sip_applications": [],
        "user_roles": [],
        "reviewer_assignments": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(["leadership"])

    res = client.post(
        "/leadership/applications/cccccccc-cccc-cccc-cccc-cccccccccccc/reviewers",
        json={"reviewer_user_ids": ["rev-1"]},
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 404
    assert res.json()["detail"]["code"] == "application_not_found"
