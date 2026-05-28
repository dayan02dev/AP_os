"""Tests for the leadership write endpoints (Session 6 / Tasks 20-22).

Two tiers (same pattern as test_leadership_reads + test_admin_users):
  - Unit tests using a fake Supabase admin client + dependency overrides
  - Staging integration smoke tests gated by RUN_STAGING_TESTS=1

Coverage matrix:
  * state_machine.assert_legal_transition — legal pass, illegal raises 422
  * PATCH /status — happy path writes status + status_log + audit
  * PATCH /status — illegal transition returns 422 with allowed[] payload
  * PATCH /status — no-op when from == to
  * POST /reviewers — happy path inserts, returns post-state
  * POST /reviewers — 3-cap returns 409 reviewer_limit_reached
  * POST /reviewers — idempotent re-assign returns 200 with already_assigned
  * POST /reviewers — self-assignment returns 409 self_assignment_blocked
  * DELETE /reviewers/{id} — happy path deletes
  * DELETE /reviewers/{id} — blocked when reviews.status=='submitted' exists
  * RBAC — reviewer-only role gets 403 on all three endpoints
  * 404 — non-existent application id
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
    assert legal_next_states("evaluated") == ["rejected", "shortlisted", "waitlisted", "withdrawn"]


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


# ─── PATCH /status ─────────────────────────────────────────────────────


def test_change_status_evaluated_to_shortlisted_succeeds(
    client, monkeypatch, _clear_overrides,
):
    app_id = "11111111-1111-1111-1111-111111111111"
    fake = _install_db(monkeypatch, {
        # tir_applications has this row in 'evaluated'
        "tir_applications": [
            {"id": app_id, "status": "evaluated", "user_id": "applicant-u"},
        ],
        "sip_applications": [],
        "application_status_log": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(["leadership"])

    res = client.patch(
        f"/leadership/applications/{app_id}/status",
        headers={"Authorization": "Bearer test-token"},
        json={"to_status": "shortlisted", "reason": "Gate 1 advance"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True
    assert body["from_status"] == "evaluated"
    assert body["to_status"] == "shortlisted"
    assert body["track"] == "tir"

    # Side effects: one update on tir_applications, one insert on status_log.
    assert any(name == "tir_applications" and payload == {"status": "shortlisted"}
               for name, payload, _eqs in fake.updates), fake.updates
    assert any(name == "application_status_log" for name, _ in fake.inserts), fake.inserts

    # Audit captured.
    assert len(_audit_calls) == 1
    assert _audit_calls[0]["action_type"] == "application.status_changed"
    assert _audit_calls[0]["before"] == {"status": "evaluated"}
    assert _audit_calls[0]["after"] == {"status": "shortlisted"}


def test_change_status_illegal_transition_returns_422_with_allowed_list(
    client, monkeypatch, _clear_overrides,
):
    app_id = "22222222-2222-2222-2222-222222222222"
    _install_db(monkeypatch, {
        # submitted → shortlisted is not legal (must pass through evaluated)
        "tir_applications": [
            {"id": app_id, "status": "submitted", "user_id": "applicant-u"},
        ],
        "sip_applications": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(["leadership"])

    res = client.patch(
        f"/leadership/applications/{app_id}/status",
        headers={"Authorization": "Bearer test-token"},
        json={"to_status": "shortlisted"},
    )
    assert res.status_code == 422
    detail = res.json()["detail"]
    assert detail["code"] == "illegal_transition"
    assert detail["from"] == "submitted"
    assert detail["to"] == "shortlisted"
    assert detail["allowed"] == ["withdrawn"]


def test_change_status_rewind_carries_phase_1_5_hint(
    client, monkeypatch, _clear_overrides,
):
    app_id = "33333333-3333-3333-3333-333333333333"
    _install_db(monkeypatch, {
        "tir_applications": [
            {"id": app_id, "status": "shortlisted", "user_id": "applicant-u"},
        ],
        "sip_applications": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(["leadership"])

    res = client.patch(
        f"/leadership/applications/{app_id}/status",
        headers={"Authorization": "Bearer test-token"},
        json={"to_status": "under_review"},
    )
    assert res.status_code == 422
    detail = res.json()["detail"]
    assert "Phase 1.5" in detail.get("hint", "")


def test_change_status_no_op_when_already_there(
    client, monkeypatch, _clear_overrides,
):
    app_id = "44444444-4444-4444-4444-444444444444"
    fake = _install_db(monkeypatch, {
        "tir_applications": [
            {"id": app_id, "status": "evaluated", "user_id": "applicant-u"},
        ],
        "sip_applications": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(["leadership"])

    res = client.patch(
        f"/leadership/applications/{app_id}/status",
        headers={"Authorization": "Bearer test-token"},
        json={"to_status": "evaluated"},
    )
    assert res.status_code == 200, res.text
    assert res.json().get("noop") is True
    # No update / no insert / no audit on no-op.
    assert fake.updates == []
    assert all(name != "application_status_log" for name, _ in fake.inserts)
    assert _audit_calls == []


def test_change_status_404_when_application_missing(
    client, monkeypatch, _clear_overrides,
):
    _install_db(monkeypatch, {"tir_applications": [], "sip_applications": []})
    app.dependency_overrides[get_current_user] = _override_user(["leadership"])

    res = client.patch(
        "/leadership/applications/55555555-5555-5555-5555-555555555555/status",
        headers={"Authorization": "Bearer test-token"},
        json={"to_status": "evaluated"},
    )
    assert res.status_code == 404
    assert res.json()["detail"]["code"] == "application_not_found"


def test_change_status_requires_change_app_status_capability(client, _clear_overrides):
    app.dependency_overrides[get_current_user] = _override_user(["reviewer"])
    res = client.patch(
        "/leadership/applications/anything/status",
        headers={"Authorization": "Bearer test-token"},
        json={"to_status": "shortlisted"},
    )
    assert res.status_code == 403
    assert res.json()["detail"]["code"] == "missing_capability"


# ─── POST /reviewers ───────────────────────────────────────────────────


def test_assign_reviewers_happy_path(client, monkeypatch, _clear_overrides):
    app_id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    fake = _install_db(monkeypatch, {
        "tir_applications": [
            {"id": app_id, "status": "under_review", "user_id": "applicant-u"},
        ],
        "sip_applications": [],
        "reviewer_assignments": [],  # nothing assigned yet
    })
    app.dependency_overrides[get_current_user] = _override_user(["leadership"])

    res = client.post(
        f"/leadership/applications/{app_id}/reviewers",
        headers={"Authorization": "Bearer test-token"},
        json={"reviewer_user_ids": ["rev-1", "rev-2"]},
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["added"] == ["rev-1", "rev-2"]
    assert body["already_assigned"] == []

    # Verify the insert rows have the expected shape (state='pending',
    # assigned_by=current user).
    insert_payload = next(
        payload for name, payload in fake.inserts if name == "reviewer_assignments"
    )
    assert all(r["state"] == "pending" for r in insert_payload)
    assert all(r["assigned_by"] == "leader-u" for r in insert_payload)

    assert len(_audit_calls) == 1
    assert _audit_calls[0]["action_type"] == "reviewer.assigned"


def test_assign_reviewers_idempotent_re_assign_returns_already_assigned(
    client, monkeypatch, _clear_overrides,
):
    app_id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    _install_db(monkeypatch, {
        "tir_applications": [
            {"id": app_id, "status": "under_review", "user_id": "applicant-u"},
        ],
        "sip_applications": [],
        # rev-1 already active.
        "reviewer_assignments": [
            {
                "id": "ra-1",
                "application_id": app_id,
                "application_track": "tir",
                "reviewer_user_id": "rev-1",
                "state": "pending",
            },
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user(["leadership"])

    res = client.post(
        f"/leadership/applications/{app_id}/reviewers",
        headers={"Authorization": "Bearer test-token"},
        json={"reviewer_user_ids": ["rev-1", "rev-2"]},
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["added"] == ["rev-2"]
    assert body["already_assigned"] == ["rev-1"]


def test_assign_reviewers_3_cap_blocked(client, monkeypatch, _clear_overrides):
    app_id = "cccccccc-cccc-cccc-cccc-cccccccccccc"
    _install_db(monkeypatch, {
        "tir_applications": [
            {"id": app_id, "status": "under_review", "user_id": "applicant-u"},
        ],
        "sip_applications": [],
        # Already 3 active assignees.
        "reviewer_assignments": [
            {"reviewer_user_id": "rev-1", "state": "pending"},
            {"reviewer_user_id": "rev-2", "state": "pending"},
            {"reviewer_user_id": "rev-3", "state": "accepted"},
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user(["leadership"])

    res = client.post(
        f"/leadership/applications/{app_id}/reviewers",
        headers={"Authorization": "Bearer test-token"},
        json={"reviewer_user_ids": ["rev-4"]},
    )
    assert res.status_code == 409
    detail = res.json()["detail"]
    assert detail["code"] == "reviewer_limit_reached"
    assert detail["max"] == 3
    assert detail["current_active"] == 3


def test_assign_reviewers_self_assignment_blocked(client, monkeypatch, _clear_overrides):
    app_id = "dddddddd-dddd-dddd-dddd-dddddddddddd"
    _install_db(monkeypatch, {
        "tir_applications": [
            {"id": app_id, "status": "under_review", "user_id": "applicant-u"},
        ],
        "sip_applications": [],
        "reviewer_assignments": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(["leadership"])

    res = client.post(
        f"/leadership/applications/{app_id}/reviewers",
        headers={"Authorization": "Bearer test-token"},
        json={"reviewer_user_ids": ["applicant-u"]},
    )
    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "self_assignment_blocked"


def test_assign_reviewers_request_validates_max_3_in_body(
    client, monkeypatch, _clear_overrides,
):
    """Pydantic-level max_length=3 on reviewer_user_ids — a request body with
    4+ ids is rejected before any business logic runs."""
    app_id = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"
    _install_db(monkeypatch, {
        "tir_applications": [{"id": app_id, "status": "under_review"}],
        "sip_applications": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(["leadership"])

    res = client.post(
        f"/leadership/applications/{app_id}/reviewers",
        headers={"Authorization": "Bearer test-token"},
        json={"reviewer_user_ids": ["a", "b", "c", "d"]},
    )
    assert res.status_code == 422  # pydantic validation


def test_assign_reviewers_requires_assign_reviewers_capability(client, _clear_overrides):
    app.dependency_overrides[get_current_user] = _override_user(["reviewer"])
    res = client.post(
        "/leadership/applications/anything/reviewers",
        headers={"Authorization": "Bearer test-token"},
        json={"reviewer_user_ids": ["rev-1"]},
    )
    assert res.status_code == 403
    assert res.json()["detail"]["code"] == "missing_capability"


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


# ─── GET /legal-next-statuses (the small convenience endpoint) ─────────


def test_legal_next_statuses_for_evaluated_app(client, monkeypatch, _clear_overrides):
    app_id = "13131313-1313-1313-1313-131313131313"
    _install_db(monkeypatch, {
        "tir_applications": [
            {"id": app_id, "status": "evaluated", "user_id": "applicant-u"},
        ],
        "sip_applications": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(["leadership"])

    res = client.get(
        f"/leadership/applications/{app_id}/legal-next-statuses",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["current_status"] == "evaluated"
    assert body["allowed"] == ["rejected", "shortlisted", "waitlisted", "withdrawn"]


# ─── Email hook integration (Session 8 / Task 26) ──────────────────────


class _FakeEmailService:
    """Capture-only stand-in for the EmailService singleton."""

    def __init__(self):
        self.reviewer_assigned_calls: list[dict] = []
        self.status_change_calls: list[dict] = []

    def send_reviewer_assigned(self, **kwargs):
        self.reviewer_assigned_calls.append(kwargs)
        return {"message_id": "test", "status": "sent"}

    def send_status_change(self, **kwargs):
        self.status_change_calls.append(kwargs)
        return {"message_id": "test", "status": "sent"}


def test_change_status_to_shortlisted_fires_email(client, monkeypatch, _clear_overrides):
    app_id = "77777777-7777-7777-7777-777777777777"
    _install_db(monkeypatch, {
        "tir_applications": [
            {
                "id": app_id,
                "status": "evaluated",
                "user_id": "applicant-u",
                "basic_email": "appy@example.com",
                "basic_full_name": "Appy McApp",
            },
        ],
        "sip_applications": [],
        "application_status_log": [],
    })
    fake_email = _FakeEmailService()
    monkeypatch.setattr(la_router, "get_email_service", lambda: fake_email)
    app.dependency_overrides[get_current_user] = _override_user(["leadership"])

    res = client.patch(
        f"/leadership/applications/{app_id}/status",
        headers={"Authorization": "Bearer test-token"},
        json={"to_status": "shortlisted", "reason": "Strong fit"},
    )
    assert res.status_code == 200, res.text
    assert len(fake_email.status_change_calls) == 1
    call = fake_email.status_change_calls[0]
    assert call["to"] == "appy@example.com"
    assert call["applicant_name"] == "Appy McApp"
    assert call["to_status"] == "shortlisted"
    assert call["track"] == "tir"
    assert call["reason"] == "Strong fit"


def test_change_status_to_evaluated_does_not_fire_email(client, monkeypatch, _clear_overrides):
    """Only Gate 1 outcomes (shortlisted/rejected/waitlisted) trigger email.
    Moving to `evaluated` is an internal state change — applicants don't
    learn about it until a final decision lands."""
    app_id = "88888888-8888-8888-8888-888888888888"
    _install_db(monkeypatch, {
        "tir_applications": [
            {"id": app_id, "status": "under_review", "user_id": "applicant-u",
             "basic_email": "appy@example.com"},
        ],
        "sip_applications": [],
    })
    fake_email = _FakeEmailService()
    monkeypatch.setattr(la_router, "get_email_service", lambda: fake_email)
    app.dependency_overrides[get_current_user] = _override_user(["leadership"])

    res = client.patch(
        f"/leadership/applications/{app_id}/status",
        headers={"Authorization": "Bearer test-token"},
        json={"to_status": "evaluated"},
    )
    assert res.status_code == 200, res.text
    assert fake_email.status_change_calls == []


def test_change_status_swallows_email_failures(client, monkeypatch, _clear_overrides):
    """Email-send raising must NOT break the status transition or roll back
    the DB write."""
    from app.services.email_service import EmailDeliveryError

    class _RaisingEmail:
        def send_status_change(self, **_kwargs):
            raise EmailDeliveryError("resend 503")

    app_id = "99999999-9999-9999-9999-999999999999"
    _install_db(monkeypatch, {
        "tir_applications": [
            {"id": app_id, "status": "evaluated", "user_id": "applicant-u",
             "basic_email": "x@y.com"},
        ],
        "sip_applications": [],
    })
    monkeypatch.setattr(la_router, "get_email_service", lambda: _RaisingEmail())
    app.dependency_overrides[get_current_user] = _override_user(["leadership"])

    res = client.patch(
        f"/leadership/applications/{app_id}/status",
        headers={"Authorization": "Bearer test-token"},
        json={"to_status": "rejected"},
    )
    assert res.status_code == 200, res.text


def test_assign_reviewers_fires_email_for_each_new_reviewer(
    client, monkeypatch, _clear_overrides,
):
    app_id = "10101010-1010-1010-1010-101010101010"
    _install_db(monkeypatch, {
        "tir_applications": [
            {"id": app_id, "status": "under_review", "user_id": "applicant-u",
             "basic_full_name": "Appy McApp"},
        ],
        "sip_applications": [],
        "reviewer_assignments": [],
        # The router does a batched in_("id", ...) lookup on profiles for
        # each new reviewer; the FakeQuery in_() is a no-op and execute()
        # returns whatever's pre-loaded. Pre-load both reviewers' profiles.
        "profiles": [
            {"id": "rev-1", "email": "r1@x.com", "full_name": "Reviewer One"},
            {"id": "rev-2", "email": "r2@x.com", "full_name": "Reviewer Two"},
        ],
    })
    fake_email = _FakeEmailService()
    monkeypatch.setattr(la_router, "get_email_service", lambda: fake_email)
    app.dependency_overrides[get_current_user] = _override_user(["leadership"])

    res = client.post(
        f"/leadership/applications/{app_id}/reviewers",
        headers={"Authorization": "Bearer test-token"},
        json={"reviewer_user_ids": ["rev-1", "rev-2"]},
    )
    assert res.status_code == 201, res.text
    assert len(fake_email.reviewer_assigned_calls) == 2
    by_to = {c["to"]: c for c in fake_email.reviewer_assigned_calls}
    assert set(by_to) == {"r1@x.com", "r2@x.com"}
    for c in fake_email.reviewer_assigned_calls:
        assert c["applicant_name"] == "Appy McApp"
        assert c["track"] == "tir"
        assert c["application_id"] == app_id
        assert c["inbox_url"].endswith("/reviewer/inbox")


def test_assign_reviewers_idempotent_path_does_not_re_email(
    client, monkeypatch, _clear_overrides,
):
    """Already-active reviewers don't trigger a duplicate email."""
    app_id = "20202020-2020-2020-2020-202020202020"
    _install_db(monkeypatch, {
        "tir_applications": [
            {"id": app_id, "status": "under_review", "user_id": "applicant-u"},
        ],
        "sip_applications": [],
        "reviewer_assignments": [
            {"reviewer_user_id": "rev-1", "state": "pending"},
        ],
        "profiles": [
            {"id": "rev-1", "email": "r1@x.com", "full_name": "R1"},
        ],
    })
    fake_email = _FakeEmailService()
    monkeypatch.setattr(la_router, "get_email_service", lambda: fake_email)
    app.dependency_overrides[get_current_user] = _override_user(["leadership"])

    res = client.post(
        f"/leadership/applications/{app_id}/reviewers",
        headers={"Authorization": "Bearer test-token"},
        json={"reviewer_user_ids": ["rev-1"]},
    )
    assert res.status_code == 201, res.text
    # rev-1 was already active → no new add → no email sent.
    assert fake_email.reviewer_assigned_calls == []


# ─── Auth (401 on missing Bearer for each route) ───────────────────────


def test_change_status_without_auth_returns_401(client):
    res = client.patch(
        "/leadership/applications/any/status",
        json={"to_status": "evaluated"},
    )
    assert res.status_code == 401


def test_assign_reviewers_without_auth_returns_401(client):
    res = client.post(
        "/leadership/applications/any/reviewers",
        json={"reviewer_user_ids": ["rev-1"]},
    )
    assert res.status_code == 401


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
    def test_change_status_as_reviewer_returns_403(
        self, staging_reviewer_token, staging_base_url,
    ):
        import httpx
        r = httpx.patch(
            f"{staging_base_url}/leadership/applications/00000000-0000-0000-0000-000000000000/status",
            headers={"Authorization": f"Bearer {staging_reviewer_token}"},
            json={"to_status": "shortlisted"},
            timeout=30.0,
        )
        assert r.status_code == 403
        assert r.json()["detail"]["code"] == "missing_capability"

    @_staging_skip
    def test_assign_reviewers_as_reviewer_returns_403(
        self, staging_reviewer_token, staging_base_url,
    ):
        import httpx
        r = httpx.post(
            f"{staging_base_url}/leadership/applications/00000000-0000-0000-0000-000000000000/reviewers",
            headers={"Authorization": f"Bearer {staging_reviewer_token}"},
            json={"reviewer_user_ids": ["someone"]},
            timeout=30.0,
        )
        assert r.status_code == 403
        assert r.json()["detail"]["code"] == "missing_capability"

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
