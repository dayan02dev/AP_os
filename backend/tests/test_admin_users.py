"""Tests for /admin/users — unit tests + staging smoke tests.

The unit tests at the top of this file use the `_FakeAdminClient` pattern
from `tests/test_admin.py`. They monkeypatch the Supabase client and
override `get_current_user` so they run offline as part of normal CI.

The three staging smoke tests at the bottom are gated by RUN_STAGING_TESTS=1
because they actually create users in the staging Supabase project. Run them
manually with:

    RUN_STAGING_TESTS=1 pytest tests/test_admin_users.py -v
"""

from __future__ import annotations

import os
import secrets
from types import SimpleNamespace
from typing import Any

import pytest

from app.deps import get_current_user
from app.main import app
from app.routers import admin_users as admin_users_router


# ─── Fake Supabase client (mirrors tests/test_admin.py) ────────────────


class _FakeQuery:
    """Minimal chainable stand-in for the supabase-py table builder."""

    def __init__(self, data: list[dict[str, Any]] | None = None, count: int = 0):
        self._data = data or []
        self._count = count

    def select(self, *_args, **_kwargs): return self
    def eq(self, *_args, **_kwargs): return self
    def in_(self, *_args, **_kwargs): return self
    def order(self, *_args, **_kwargs): return self
    def limit(self, *_args, **_kwargs): return self
    def range(self, *_args, **_kwargs): return self
    def or_(self, *_args, **_kwargs): return self
    def update(self, *_args, **_kwargs): return self
    def insert(self, *_args, **_kwargs): return self
    def upsert(self, *_args, **_kwargs): return self
    def delete(self, *_args, **_kwargs): return self

    def execute(self):
        return SimpleNamespace(data=self._data, count=self._count)


class _FakeAuth:
    """Minimal stand-in for client.auth (and client.auth.admin).

    Used by the reset-password + deactivate tests below. Pre-existing
    tests don't touch .auth so default construction is safe.
    """

    def __init__(self, *, raises_on_reset: Exception | None = None,
                 raises_on_ban: Exception | None = None):
        self._raises_on_reset = raises_on_reset
        self._raises_on_ban = raises_on_ban
        self.last_reset_email: str | None = None
        self.last_ban: tuple[str, dict] | None = None
        # client.auth.admin.update_user_by_id(...) — admin namespace is self.
        self.admin = self

    def reset_password_for_email(self, email):
        if self._raises_on_reset:
            raise self._raises_on_reset
        self.last_reset_email = email

    def update_user_by_id(self, user_id, payload):
        if self._raises_on_ban:
            raise self._raises_on_ban
        self.last_ban = (user_id, payload)


class _FakeAdminClient:
    def __init__(self, rows: dict[str, list[dict]] | None = None,
                 counts: dict[str, int] | None = None,
                 auth: _FakeAuth | None = None):
        self._rows = rows or {}
        self._counts = counts or {}
        self.auth = auth if auth is not None else _FakeAuth()

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(
            data=self._rows.get(name, []),
            count=self._counts.get(name, len(self._rows.get(name, []))),
        )


def _override_user(roles: list[str]):
    def _f():
        return {"user_id": "u-admin", "email": "admin@x.com", "roles": roles}
    return _f


@pytest.fixture
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


# ─── Audit capture (Task 15) ───────────────────────────────────────────


_audit_calls: list[dict] = []


def _capture_audit(**kwargs):
    _audit_calls.append(kwargs)


@pytest.fixture(autouse=True)
def _capture_audit_writes(monkeypatch):
    """Replace write_audit in the admin_users router with a capture list.

    Autouse so every test in this module sees the patched version; clears
    the list before each test so assertions stay scoped to one handler call.
    """
    _audit_calls.clear()
    monkeypatch.setattr(admin_users_router, "write_audit", _capture_audit)
    yield


# ─── Unit tests: GET /admin/users ──────────────────────────────────────


def test_list_users_returns_users_and_roles(client, monkeypatch, _clear_overrides):
    fake = _FakeAdminClient(
        rows={
            "profiles": [
                {
                    "id": "u-1",
                    "email": "alice@x.com",
                    "full_name": "Alice",
                    "phone": None,
                    "location_city": "Bangalore",
                    "active_role": "admin",
                    "created_at": "2026-05-01T00:00:00Z",
                },
                {
                    "id": "u-2",
                    "email": "bob@x.com",
                    "full_name": "Bob",
                    "phone": None,
                    "location_city": "Mumbai",
                    "active_role": "reviewer",
                    "created_at": "2026-05-02T00:00:00Z",
                },
            ],
            "user_roles": [
                {"user_id": "u-1", "role": "admin", "granted_at": "2026-05-01T00:00:00Z"},
                {"user_id": "u-1", "role": "leadership", "granted_at": "2026-05-01T00:00:00Z"},
                {"user_id": "u-2", "role": "reviewer", "granted_at": "2026-05-02T00:00:00Z"},
            ],
        }
    )
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    res = client.get(
        "/admin/users",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 2
    assert len(body["users"]) == 2

    by_id = {u["id"]: u for u in body["users"]}
    assert sorted(by_id["u-1"]["roles"]) == ["admin", "leadership"]
    assert by_id["u-2"]["roles"] == ["reviewer"]


def test_list_users_role_filter_narrows_results(client, monkeypatch, _clear_overrides):
    fake = _FakeAdminClient(
        rows={
            "profiles": [
                {
                    "id": "u-1",
                    "email": "alice@x.com",
                    "full_name": "Alice",
                    "phone": None,
                    "location_city": "Bangalore",
                    "active_role": "admin",
                    "created_at": "2026-05-01T00:00:00Z",
                },
                {
                    "id": "u-2",
                    "email": "bob@x.com",
                    "full_name": "Bob",
                    "phone": None,
                    "location_city": "Mumbai",
                    "active_role": "reviewer",
                    "created_at": "2026-05-02T00:00:00Z",
                },
            ],
            "user_roles": [
                {"user_id": "u-1", "role": "admin", "granted_at": "2026-05-01T00:00:00Z"},
                {"user_id": "u-1", "role": "leadership", "granted_at": "2026-05-01T00:00:00Z"},
                {"user_id": "u-2", "role": "reviewer", "granted_at": "2026-05-02T00:00:00Z"},
            ],
        }
    )
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    res = client.get(
        "/admin/users?role=reviewer",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 1
    assert body["users"][0]["id"] == "u-2"
    assert body["users"][0]["roles"] == ["reviewer"]


def test_list_users_role_filter_returns_empty_when_no_grants(
    client, monkeypatch, _clear_overrides,
):
    """Regression test for the staging bug where the role filter ran AFTER
    a `limit(200)` on profiles ordered by created_at desc, silently dropping
    older reviewers. The fix queries user_roles first; if no rows match the
    role, we return early with an empty list (no profiles fetched)."""
    fake = _FakeAdminClient(
        rows={
            "profiles": [
                {"id": "u-1", "email": "a@x.com", "full_name": "A", "phone": None,
                 "location_city": None, "active_role": None,
                 "created_at": "2026-05-01T00:00:00Z"},
            ],
            "user_roles": [
                # `u-1` has admin but NOT reviewer
                {"user_id": "u-1", "role": "admin", "granted_at": "2026-05-01T00:00:00Z"},
            ],
        }
    )
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    res = client.get(
        "/admin/users?role=reviewer",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 0
    assert body["users"] == []


def test_list_users_search_uses_ilike_filter(client, monkeypatch, _clear_overrides):
    """Exercise the `search=...` query param so the q.or_(email.ilike, full_name.ilike)
    branch in list_users is covered. The fake _FakeQuery.or_() is a no-op, so we
    pre-filter the profiles rows down to the expected match and just verify the
    handler doesn't crash on the search path and merges roles correctly."""
    fake = _FakeAdminClient(
        rows={
            "profiles": [
                {
                    "id": "u-1",
                    "email": "foo@x.com",
                    "full_name": "Foo Bar",
                    "phone": None,
                    "location_city": "Bangalore",
                    "active_role": "admin",
                    "created_at": "2026-05-01T00:00:00Z",
                },
            ],
            "user_roles": [
                {"user_id": "u-1", "role": "admin", "granted_at": "2026-05-01T00:00:00Z"},
            ],
        }
    )
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    res = client.get(
        "/admin/users?search=foo",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 1
    assert body["users"][0]["id"] == "u-1"
    assert body["users"][0]["email"] == "foo@x.com"
    assert body["users"][0]["roles"] == ["admin"]


def test_list_users_requires_manage_users_capability(client, _clear_overrides):
    app.dependency_overrides[get_current_user] = _override_user(["reviewer"])

    res = client.get(
        "/admin/users",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 403
    assert res.json()["detail"]["code"] == "missing_capability"


# ─── Unit tests: GET /admin/users/{user_id} ────────────────────────────


def test_get_user_returns_profile_and_roles(client, monkeypatch, _clear_overrides):
    fake = _FakeAdminClient(
        rows={
            "profiles": [
                {
                    "id": "u-1",
                    "email": "a@b.com",
                    "full_name": "A",
                    "phone": "+91 1111",
                    "location_city": "Bangalore",
                    "active_role": "reviewer",
                    "created_at": "2026-05-01T00:00:00Z",
                },
            ],
            "user_roles": [
                {
                    "role": "reviewer",
                    "granted_at": "2026-05-01T00:00:00Z",
                    "granted_by": "u-admin",
                },
            ],
        }
    )
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    res = client.get(
        "/admin/users/u-1",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["id"] == "u-1"
    assert body["email"] == "a@b.com"
    assert body["full_name"] == "A"
    assert body["roles"] == [
        {
            "role": "reviewer",
            "granted_at": "2026-05-01T00:00:00Z",
            "granted_by": "u-admin",
        }
    ]


def test_get_user_returns_404_for_missing_user(client, monkeypatch, _clear_overrides):
    fake = _FakeAdminClient(rows={"profiles": [], "user_roles": []})
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    res = client.get(
        "/admin/users/nope",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 404
    assert res.json()["detail"]["code"] == "user_not_found"


def test_get_user_requires_manage_users_capability(client, _clear_overrides):
    app.dependency_overrides[get_current_user] = _override_user(["reviewer"])

    res = client.get(
        "/admin/users/u-1",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 403
    assert res.json()["detail"]["code"] == "missing_capability"


# ─── Unit tests: PATCH /admin/users/{user_id} ──────────────────────────


def test_patch_user_updates_profile_fields(client, monkeypatch, _clear_overrides):
    fake = _FakeAdminClient(rows={"profiles": [], "user_roles": []})
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    res = client.patch(
        "/admin/users/u-1",
        headers={"Authorization": "Bearer test-token"},
        json={"full_name": "New Name", "phone": "+91 1234"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True
    assert body["patched"] == ["full_name", "phone"]

    # Audit hook fired exactly once with the expected action + patched keys.
    assert len(_audit_calls) == 1
    call = _audit_calls[0]
    assert call["action_type"] == "user.profile_updated"
    assert call["target_table"] == "profiles"
    assert call["target_id"] == "u-1"
    assert call["after"] == {"patched": ["full_name", "phone"]}


def test_patch_user_maps_organization_to_location_city(client, monkeypatch, _clear_overrides):
    fake = _FakeAdminClient(rows={"profiles": [], "user_roles": []})
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    res = client.patch(
        "/admin/users/u-1",
        headers={"Authorization": "Bearer test-token"},
        json={"organization": "IISc"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True
    assert "location_city" in body["patched"]
    assert "organization" not in body["patched"]


def test_patch_user_drops_role_title_silently(client, monkeypatch, _clear_overrides):
    fake = _FakeAdminClient(rows={"profiles": [], "user_roles": []})
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    res = client.patch(
        "/admin/users/u-1",
        headers={"Authorization": "Bearer test-token"},
        json={"role_title": "Engineer", "phone": "+91 999"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ok"] is True
    assert body["patched"] == ["phone"]


def test_patch_user_rejects_empty_patch(client, monkeypatch, _clear_overrides):
    fake = _FakeAdminClient(rows={"profiles": [], "user_roles": []})
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    res = client.patch(
        "/admin/users/u-1",
        headers={"Authorization": "Bearer test-token"},
        json={},
    )
    assert res.status_code == 400
    assert res.json()["detail"]["code"] == "empty_patch"


def test_patch_user_requires_manage_users_capability(client, _clear_overrides):
    app.dependency_overrides[get_current_user] = _override_user(["reviewer"])

    res = client.patch(
        "/admin/users/u-1",
        headers={"Authorization": "Bearer test-token"},
        json={"full_name": "X"},
    )
    assert res.status_code == 403
    assert res.json()["detail"]["code"] == "missing_capability"


# ─── Unit tests: POST /admin/users/{user_id}/roles ─────────────────────


class _RaisingInsertQuery(_FakeQuery):
    """Variant whose insert().execute() raises a configured exception."""

    def __init__(self, error_msg: str):
        super().__init__()
        self._error_msg = error_msg
        self._insert_called = False

    def insert(self, *_args, **_kwargs):
        self._insert_called = True
        return self

    def execute(self):
        if self._insert_called:
            raise Exception(self._error_msg)
        return SimpleNamespace(data=self._data, count=self._count)


class _FakeAdminClientThatRaises:
    """Admin client whose user_roles.insert() raises a configured error."""

    def __init__(self, error_msg: str):
        self._error_msg = error_msg

    def table(self, _name: str) -> _RaisingInsertQuery:
        return _RaisingInsertQuery(self._error_msg)


def test_grant_role_success(client, monkeypatch, _clear_overrides):
    fake = _FakeAdminClient(rows={"user_roles": []})
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    res = client.post(
        "/admin/users/u-1/roles",
        headers={"Authorization": "Bearer test-token"},
        json={"role": "reviewer"},
    )
    assert res.status_code == 201, res.text
    assert res.json() == {"ok": True, "role": "reviewer"}

    assert len(_audit_calls) == 1
    call = _audit_calls[0]
    assert call["action_type"] == "role.granted"
    assert call["target_table"] == "user_roles"
    assert call["target_id"] == "u-1"
    assert call["after"] == {"role": "reviewer"}


def test_grant_role_invalid_role(client, monkeypatch, _clear_overrides):
    fake = _FakeAdminClient(rows={"user_roles": []})
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    res = client.post(
        "/admin/users/u-1/roles",
        headers={"Authorization": "Bearer test-token"},
        json={"role": "wizard"},
    )
    assert res.status_code == 400
    assert res.json()["detail"]["code"] == "invalid_role"


def test_grant_role_duplicate_returns_409(client, monkeypatch, _clear_overrides):
    fake = _FakeAdminClientThatRaises(
        "duplicate key value violates unique constraint ... 23505"
    )
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    res = client.post(
        "/admin/users/u-1/roles",
        headers={"Authorization": "Bearer test-token"},
        json={"role": "reviewer"},
    )
    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "already_granted"


def test_grant_role_requires_grant_role_capability(client, _clear_overrides):
    app.dependency_overrides[get_current_user] = _override_user(["reviewer"])

    res = client.post(
        "/admin/users/u-1/roles",
        headers={"Authorization": "Bearer test-token"},
        json={"role": "reviewer"},
    )
    assert res.status_code == 403
    assert res.json()["detail"]["code"] == "missing_capability"


# ─── Unit tests: DELETE /admin/users/{user_id}/roles/{role} ────────────


def test_revoke_role_success(client, monkeypatch, _clear_overrides):
    fake = _FakeAdminClient(rows={"user_roles": []})
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    res = client.delete(
        "/admin/users/u-1/roles/reviewer",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 200, res.text
    assert res.json() == {"ok": True, "role": "reviewer"}

    assert len(_audit_calls) == 1
    call = _audit_calls[0]
    assert call["action_type"] == "role.revoked"
    assert call["target_table"] == "user_roles"
    assert call["target_id"] == "u-1"
    assert call["before"] == {"role": "reviewer"}


def test_revoke_role_invalid_role_returns_400(client, monkeypatch, _clear_overrides):
    fake = _FakeAdminClient(rows={"user_roles": []})
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    res = client.delete(
        "/admin/users/u-1/roles/wizard",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 400
    assert res.json()["detail"]["code"] == "invalid_role"


def test_revoke_admin_when_only_one_admin_blocked(client, monkeypatch, _clear_overrides):
    fake = _FakeAdminClient(
        rows={"user_roles": []},
        counts={"user_roles": 1},
    )
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    res = client.delete(
        "/admin/users/u-1/roles/admin",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "last_admin_protection"


def test_revoke_admin_with_multiple_admins_succeeds(client, monkeypatch, _clear_overrides):
    fake = _FakeAdminClient(
        rows={"user_roles": []},
        counts={"user_roles": 2},
    )
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    res = client.delete(
        "/admin/users/u-1/roles/admin",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 200, res.text
    assert res.json() == {"ok": True, "role": "admin"}


def test_revoke_role_requires_revoke_role_capability(client, _clear_overrides):
    app.dependency_overrides[get_current_user] = _override_user(["reviewer"])

    res = client.delete(
        "/admin/users/u-1/roles/reviewer",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 403
    assert res.json()["detail"]["code"] == "missing_capability"


# ─── Unit tests: POST /admin/users/{user_id}/reset-password ────────────


def test_reset_password_success(client, monkeypatch, _clear_overrides):
    auth = _FakeAuth()
    fake = _FakeAdminClient(
        rows={"profiles": [{"id": "u-1", "email": "a@b.com"}]},
        auth=auth,
    )
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    res = client.post(
        "/admin/users/u-1/reset-password",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 200, res.text
    assert res.json() == {"ok": True, "email_sent_to": "a@b.com"}
    assert auth.last_reset_email == "a@b.com"

    assert len(_audit_calls) == 1
    call = _audit_calls[0]
    assert call["action_type"] == "user.password_reset_triggered"
    assert call["target_table"] == "profiles"
    assert call["target_id"] == "u-1"
    assert call["after"] == {"email": "a@b.com"}


def test_reset_password_user_not_found(client, monkeypatch, _clear_overrides):
    fake = _FakeAdminClient(rows={"profiles": []})
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    res = client.post(
        "/admin/users/nope/reset-password",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 404
    assert res.json()["detail"]["code"] == "user_not_found"


def test_reset_password_supabase_failure_returns_502(client, monkeypatch, _clear_overrides):
    auth = _FakeAuth(raises_on_reset=Exception("smtp down"))
    fake = _FakeAdminClient(
        rows={"profiles": [{"id": "u-1", "email": "a@b.com"}]},
        auth=auth,
    )
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    res = client.post(
        "/admin/users/u-1/reset-password",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 502
    detail = res.json()["detail"]
    assert detail["code"] == "reset_send_failed"
    assert "smtp" in detail["message"]


def test_reset_password_requires_reset_password_capability(client, _clear_overrides):
    app.dependency_overrides[get_current_user] = _override_user(["reviewer"])

    res = client.post(
        "/admin/users/u-1/reset-password",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 403
    assert res.json()["detail"]["code"] == "missing_capability"


def test_reset_password_admin_has_capability(client, monkeypatch, _clear_overrides):
    fake = _FakeAdminClient(
        rows={"profiles": [{"id": "u-1", "email": "a@b.com"}]},
    )
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    res = client.post(
        "/admin/users/u-1/reset-password",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 200, res.text


# ─── Unit tests: POST /admin/users/{user_id}/deactivate ────────────────


def test_deactivate_user_success(client, monkeypatch, _clear_overrides):
    auth = _FakeAuth()
    fake = _FakeAdminClient(
        rows={"profiles": [{"id": "u-1", "email": "a@b.com"}]},
        auth=auth,
    )
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    res = client.post(
        "/admin/users/u-1/deactivate",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 200, res.text
    assert res.json() == {"ok": True, "user_id": "u-1", "email": "a@b.com"}
    assert auth.last_ban == ("u-1", {"ban_duration": "876600h"})

    assert len(_audit_calls) == 1
    call = _audit_calls[0]
    assert call["action_type"] == "user.deactivated"
    assert call["target_table"] == "profiles"
    assert call["target_id"] == "u-1"
    assert call["after"] == {"email": "a@b.com"}


def test_deactivate_user_not_found(client, monkeypatch, _clear_overrides):
    fake = _FakeAdminClient(rows={"profiles": []})
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    res = client.post(
        "/admin/users/nope/deactivate",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 404
    assert res.json()["detail"]["code"] == "user_not_found"


def test_deactivate_supabase_failure_returns_502(client, monkeypatch, _clear_overrides):
    auth = _FakeAuth(raises_on_ban=Exception("gotrue 500"))
    fake = _FakeAdminClient(
        rows={"profiles": [{"id": "u-1", "email": "a@b.com"}]},
        auth=auth,
    )
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    res = client.post(
        "/admin/users/u-1/deactivate",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 502
    detail = res.json()["detail"]
    assert detail["code"] == "deactivate_failed"
    assert "gotrue" in detail["message"]


def test_deactivate_requires_manage_users_capability(client, _clear_overrides):
    app.dependency_overrides[get_current_user] = _override_user(["reviewer"])

    res = client.post(
        "/admin/users/u-1/deactivate",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 403
    assert res.json()["detail"]["code"] == "missing_capability"


def test_deactivate_leadership_role_lacks_capability(client, _clear_overrides):
    app.dependency_overrides[get_current_user] = _override_user(["leadership"])

    res = client.post(
        "/admin/users/u-1/deactivate",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 403
    assert res.json()["detail"]["code"] == "missing_capability"


# ─── Unit test: POST /admin/users writes an audit row (Task 15) ────────


class _FakeCreateAuth(_FakeAuth):
    """_FakeAuth extension that supports invite/create flows used by
    create_user. Returns a dummy user with a deterministic id."""

    def __init__(self, new_user_id: str = "u-new"):
        super().__init__()
        self._new_user_id = new_user_id

    def invite_user_by_email(self, _email):
        return SimpleNamespace(user=SimpleNamespace(id=self._new_user_id))

    def create_user(self, _payload):
        return SimpleNamespace(user=SimpleNamespace(id=self._new_user_id))


# ─── Email hook integration ────────────────────────────────────────────


class _FakeEmailService:
    """Capture-only stand-in for the EmailService singleton."""

    def __init__(self):
        self.role_granted_calls: list[dict] = []

    def send_role_granted(self, **kwargs):
        self.role_granted_calls.append(kwargs)
        return {"message_id": "test", "status": "sent"}


def test_grant_role_fires_role_granted_email(client, monkeypatch, _clear_overrides):
    """Happy path: grant_role looks up the user's email + name and invokes
    send_role_granted with the right kwargs. Pre-existing tests have no
    profiles row so the email is silently skipped; this one provides one."""
    fake = _FakeAdminClient(
        rows={
            "user_roles": [],
            "profiles": [
                {"id": "u-1", "email": "newrev@x.com", "full_name": "New Reviewer"},
            ],
        }
    )
    fake_email = _FakeEmailService()
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(admin_users_router, "get_email_service", lambda: fake_email)
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    res = client.post(
        "/admin/users/u-1/roles",
        headers={"Authorization": "Bearer test-token"},
        json={"role": "reviewer"},
    )
    assert res.status_code == 201, res.text
    assert len(fake_email.role_granted_calls) == 1
    call = fake_email.role_granted_calls[0]
    assert call["to"] == "newrev@x.com"
    assert call["role"] == "reviewer"
    assert call["user_name"] == "New Reviewer"
    assert call["granted_by"] == "admin@x.com"
    assert call["signin_url"].endswith("/apply/signin")


def test_grant_role_swallows_email_failures(client, monkeypatch, _clear_overrides):
    """A 5xx from Resend (or any send-side exception) must NOT break the
    grant — the row is already in user_roles + audit_log_v2 by then."""
    from app.services.email_service import EmailDeliveryError

    class _RaisingEmailService:
        def send_role_granted(self, **_kwargs):
            raise EmailDeliveryError("resend 503")

    fake = _FakeAdminClient(
        rows={
            "user_roles": [],
            "profiles": [{"id": "u-1", "email": "x@y.com", "full_name": "X"}],
        }
    )
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(admin_users_router, "get_email_service", lambda: _RaisingEmailService())
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    res = client.post(
        "/admin/users/u-1/roles",
        headers={"Authorization": "Bearer test-token"},
        json={"role": "reviewer"},
    )
    # Still 201 — the grant landed even though Resend failed.
    assert res.status_code == 201, res.text


def test_grant_role_skips_email_when_profile_missing(client, monkeypatch, _clear_overrides):
    """User has no profile row (or no email column) → grant still succeeds,
    no email attempt is made. Common path for users created via OAuth that
    haven't yet completed the wizard."""
    fake = _FakeAdminClient(rows={"user_roles": [], "profiles": []})
    fake_email = _FakeEmailService()
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(admin_users_router, "get_email_service", lambda: fake_email)
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    res = client.post(
        "/admin/users/u-1/roles",
        headers={"Authorization": "Bearer test-token"},
        json={"role": "reviewer"},
    )
    assert res.status_code == 201, res.text
    assert fake_email.role_granted_calls == []


# ─── (original test follows) ───────────────────────────────────────────


def test_create_user_writes_audit(client, monkeypatch, _clear_overrides):
    """Mirrors the create-user happy path on the fake client and verifies
    the audit hook is invoked with the expected payload."""
    auth = _FakeCreateAuth(new_user_id="u-new")
    fake = _FakeAdminClient(rows={"profiles": [], "user_roles": []}, auth=auth)
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    res = client.post(
        "/admin/users",
        headers={"Authorization": "Bearer test-token"},
        json={
            "email": "new@x.com",
            "full_name": "New Reviewer",
            "roles": ["reviewer"],
            "send_invite": True,
        },
    )
    assert res.status_code == 201, res.text

    assert len(_audit_calls) == 1
    call = _audit_calls[0]
    assert call["action_type"] == "user.created"
    assert call["target_table"] == "profiles"
    assert call["target_id"] == "u-new"
    assert call["after"] == {
        "email": "new@x.com",
        "roles": ["reviewer"],
        "invite_sent": True,
        "existing_user": False,
    }


# ─── Staging smoke tests (skipped unless RUN_STAGING_TESTS=1) ──────────


_staging_skip = pytest.mark.skipif(
    not os.getenv("RUN_STAGING_TESTS"),
    reason="set RUN_STAGING_TESTS=1 to enable",
)


@_staging_skip
def test_admin_can_create_reviewer(staging_admin_token, staging_base_url):
    """Admin creates a brand-new reviewer via the non-invite path and
    verifies the response shape includes a temp password."""
    import httpx

    rand_email = f"test-rv-{secrets.token_hex(4)}@artpark.in"
    r = httpx.post(
        f"{staging_base_url}/admin/users",
        headers={"Authorization": f"Bearer {staging_admin_token}"},
        json={
            "email": rand_email,
            "full_name": "Test Reviewer",
            "phone": "+91 99999 00000",
            "roles": ["reviewer"],
            "send_invite": False,
        },
        timeout=30.0,
    )
    assert r.status_code == 201, r.text
    data = r.json()
    assert data["email"] == rand_email
    assert data["roles"] == ["reviewer"]
    assert data["temp_password"]  # not None since send_invite=false
    assert data["invite_sent"] is False


@_staging_skip
def test_invalid_role_rejected(staging_admin_token, staging_base_url):
    """Unknown role names get 400 with the list of valid roles."""
    import httpx

    r = httpx.post(
        f"{staging_base_url}/admin/users",
        headers={"Authorization": f"Bearer {staging_admin_token}"},
        json={
            "email": f"bad-{secrets.token_hex(4)}@artpark.in",
            "full_name": "Should Fail",
            "roles": ["wizard"],
            "send_invite": False,
        },
        timeout=30.0,
    )
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "invalid_role"


class _RecordingCreateAuth(_FakeCreateAuth):
    def __init__(self, new_user_id="u-new"):
        super().__init__(new_user_id)
        self.invited = False
        self.created = False
    def invite_user_by_email(self, email):
        self.invited = True
        return super().invite_user_by_email(email)
    def create_user(self, payload):
        self.created = True
        return super().create_user(payload)


class _InviteEmailService:
    def __init__(self):
        self.reviewer_invite_calls = []
    def send_reviewer_invite(self, **kwargs):
        self.reviewer_invite_calls.append(kwargs)
        return {"message_id": "test", "status": "sent"}


def test_reviewer_invite_emails_credentials(client, monkeypatch, _clear_overrides):
    auth = _RecordingCreateAuth()
    fake = _FakeAdminClient(rows={"profiles": [], "user_roles": []}, auth=auth)
    fake_email = _InviteEmailService()
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(admin_users_router, "get_email_service", lambda: fake_email)
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    res = client.post(
        "/admin/users",
        headers={"Authorization": "Bearer test-token"},
        json={"email": "rev@x.com", "full_name": "Rev", "roles": ["reviewer"], "send_invite": True},
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert auth.created and not auth.invited           # password path, not magic link
    assert body["temp_password"]                        # returned so the modal shows the real one
    assert len(fake_email.reviewer_invite_calls) == 1
    call = fake_email.reviewer_invite_calls[0]
    assert call["to"] == "rev@x.com"
    assert call["temp_password"] == body["temp_password"]


@_staging_skip
def test_non_admin_gets_403(staging_reviewer_token, staging_base_url):
    """A reviewer-only user calling /admin/users gets 403 missing_capability."""
    import httpx

    r = httpx.post(
        f"{staging_base_url}/admin/users",
        headers={"Authorization": f"Bearer {staging_reviewer_token}"},
        json={
            "email": f"x-{secrets.token_hex(4)}@artpark.in",
            "full_name": "Doesn't matter",
            "roles": ["reviewer"],
            "send_invite": False,
        },
        timeout=30.0,
    )
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "missing_capability"


class _ConvertAuth(_FakeCreateAuth):
    def __init__(self, new_user_id="u-new"):
        super().__init__(new_user_id)
        self.created = False
        self.updated = None
    def create_user(self, payload):
        self.created = True
        return super().create_user(payload)
    def update_user_by_id(self, uid, payload):
        self.updated = (uid, payload)


class _InviteEmailSpy:
    def __init__(self):
        self.calls = []
    def send_reviewer_invite(self, **kwargs):
        self.calls.append(kwargs); return {"message_id": "t", "status": "sent"}


def test_reviewer_invite_new_email_uses_provided_password(client, monkeypatch, _clear_overrides):
    auth = _ConvertAuth()
    fake = _FakeAdminClient(rows={"profiles": [], "user_roles": []}, auth=auth)
    spy = _InviteEmailSpy()
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(admin_users_router, "get_email_service", lambda: spy)
    app.dependency_overrides[get_current_user] = _override_user(["admin"])
    res = client.post("/admin/users", headers={"Authorization": "Bearer t"},
        json={"email": "new-rev@x.com", "full_name": "New Rev", "roles": ["reviewer"],
              "send_invite": True, "temp_password": "GoodPass1!xy"})
    assert res.status_code == 201, res.text
    b = res.json()
    assert auth.created and auth.updated is None
    assert b["existing_user"] is False
    assert b["roles"] == ["reviewer"]
    assert b["temp_password"] == "GoodPass1!xy"
    assert spy.calls and spy.calls[0]["temp_password"] == "GoodPass1!xy"


def test_reviewer_invite_existing_email_converts_to_reviewer(client, monkeypatch, _clear_overrides):
    auth = _ConvertAuth()
    fake = _FakeAdminClient(rows={
        "profiles": [{"id": "u-exist", "email": "old@x.com", "full_name": "Old"}],
        "user_roles": [{"role": "applicant"}],
    }, auth=auth)
    spy = _InviteEmailSpy()
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(admin_users_router, "get_email_service", lambda: spy)
    app.dependency_overrides[get_current_user] = _override_user(["admin"])
    res = client.post("/admin/users", headers={"Authorization": "Bearer t"},
        json={"email": "old@x.com", "full_name": "Old", "roles": ["reviewer"],
              "send_invite": True, "temp_password": "GoodPass1!xy"})
    assert res.status_code == 201, res.text
    b = res.json()
    assert not auth.created
    assert auth.updated == ("u-exist", {"password": "GoodPass1!xy"})
    assert b["existing_user"] is True
    assert b["roles"] == ["reviewer"]
    assert spy.calls and spy.calls[0]["to"] == "old@x.com"


def test_reviewer_invite_existing_admin_role_preserved(client, monkeypatch, _clear_overrides):
    auth = _ConvertAuth()
    fake = _FakeAdminClient(rows={
        "profiles": [{"id": "u-exist", "email": "boss@x.com"}],
        "user_roles": [{"role": "applicant"}, {"role": "admin"}],
    }, auth=auth)
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(admin_users_router, "get_email_service", lambda: _InviteEmailSpy())
    app.dependency_overrides[get_current_user] = _override_user(["admin"])
    res = client.post("/admin/users", headers={"Authorization": "Bearer t"},
        json={"email": "boss@x.com", "full_name": "Boss", "roles": ["reviewer"],
              "send_invite": True, "temp_password": "GoodPass1!xy"})
    assert res.status_code == 201, res.text
    assert res.json()["roles"] == ["admin", "reviewer"]


def test_invite_rejects_weak_password(client, monkeypatch, _clear_overrides):
    fake = _FakeAdminClient(rows={"profiles": [], "user_roles": []}, auth=_ConvertAuth())
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(admin_users_router, "get_email_service", lambda: _InviteEmailSpy())
    app.dependency_overrides[get_current_user] = _override_user(["admin"])
    res = client.post("/admin/users", headers={"Authorization": "Bearer t"},
        json={"email": "x@x.com", "full_name": "X", "roles": ["reviewer"],
              "send_invite": True, "temp_password": "weak"})
    assert res.status_code == 400
    assert res.json()["detail"]["code"] == "weak_password"


# ─── Fix 4: invite persists expertise_domains + batch_id ──────────────────


class _TrackingQuery(_FakeQuery):
    """_FakeQuery extension that records upsert + insert payloads by table name."""

    def __init__(self, client_ref, name: str, data=None):
        super().__init__(data=data or [], count=0)
        self._client_ref = client_ref
        self._name = name

    def upsert(self, payload, **_kw):
        self._client_ref.upserts.append((self._name, payload))
        return self

    def insert(self, payload, **_kw):
        self._client_ref.inserts.append((self._name, payload))
        return self

    def execute(self):
        return SimpleNamespace(data=self._data, count=len(self._data))


class _TrackingAdminClient(_FakeAdminClient):
    """Extends _FakeAdminClient to record upsert + insert calls per table."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.upserts: list[tuple[str, Any]] = []
        self.inserts: list[tuple[str, Any]] = []

    def table(self, name: str) -> _FakeQuery:
        return _TrackingQuery(self, name, data=self._rows.get(name, []))


def test_reviewer_invite_persists_expertise_domains_and_batch_id(
    client, monkeypatch, _clear_overrides,
):
    """create_user with roles=[reviewer] + expertise_domains + a REAL batch_id
    upserts a reviewer_profiles row carrying the domains and the batch pointer."""
    auth = _ConvertAuth()
    batch_uuid = "b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1"
    fake = _TrackingAdminClient(
        rows={
            "profiles": [], "user_roles": [],
            "batches": [{"id": batch_uuid, "name": "Batch A"}],
        },
        auth=auth,
    )
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(admin_users_router, "get_email_service", lambda: _InviteEmailSpy())
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    res = client.post(
        "/admin/users",
        headers={"Authorization": "Bearer test-token"},
        json={
            "email": "rev-domains@x.com",
            "full_name": "Domains Rev",
            "roles": ["reviewer"],
            "send_invite": True,
            "temp_password": "GoodPass1!xy",
            "expertise_domains": ["Robotics", "AI"],
            "batch_id": batch_uuid,
        },
    )
    assert res.status_code == 201, res.text

    rp_upserts = [p for (tbl, p) in fake.upserts if tbl == "reviewer_profiles"]
    assert rp_upserts, "expected at least one reviewer_profiles upsert"
    rp = rp_upserts[-1]
    assert rp["expertise_domains"] == ["Robotics", "AI"]
    assert rp["batch_id"] == batch_uuid
    assert rp["reviewer_user_id"] == "u-new"


def test_reviewer_invite_persists_empty_domains_when_omitted(
    client, monkeypatch, _clear_overrides,
):
    """When expertise_domains is omitted, reviewer_profiles must be upserted
    with an empty list (not None)."""
    auth = _ConvertAuth()
    fake = _TrackingAdminClient(
        rows={"profiles": [], "user_roles": []}, auth=auth
    )
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(admin_users_router, "get_email_service", lambda: _InviteEmailSpy())
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    res = client.post(
        "/admin/users",
        headers={"Authorization": "Bearer test-token"},
        json={
            "email": "rev-nodom@x.com",
            "full_name": "No Domains Rev",
            "roles": ["reviewer"],
            "send_invite": True,
            "temp_password": "GoodPass1!xy",
        },
    )
    assert res.status_code == 201, res.text

    rp_upserts = [p for (tbl, p) in fake.upserts if tbl == "reviewer_profiles"]
    assert rp_upserts, "expected reviewer_profiles upsert even with no domains"
    rp = rp_upserts[-1]
    assert rp["expertise_domains"] == []
    # No batch requested → batch_id is omitted from the upsert entirely.
    assert rp.get("batch_id") is None


def test_reviewer_invite_unknown_batch_still_persists_domains(
    client, monkeypatch, _clear_overrides,
):
    """Regression for the prod bug: the invite modal sent a batch *name* into the
    `batch_id` uuid column, so the combined upsert threw and BOTH domain + batch
    were lost (roster showed "—"). The batch now must resolve to a real batches
    row; an unknown/invalid batch is ignored and the domains still persist."""
    auth = _ConvertAuth()
    # No batches seeded → any batch_id fails to resolve.
    fake = _TrackingAdminClient(rows={"profiles": [], "user_roles": []}, auth=auth)
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(admin_users_router, "get_email_service", lambda: _InviteEmailSpy())
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    res = client.post(
        "/admin/users",
        headers={"Authorization": "Bearer test-token"},
        json={
            "email": "rev-badbatch@x.com",
            "full_name": "Bad Batch Rev",
            "roles": ["reviewer"],
            "send_invite": True,
            "temp_password": "GoodPass1!xy",
            "expertise_domains": ["Robotics"],
            "batch_id": "Batch A",  # a NAME, not a uuid — the historical bug
        },
    )
    assert res.status_code == 201, res.text

    rp_upserts = [p for (tbl, p) in fake.upserts if tbl == "reviewer_profiles"]
    assert rp_upserts, "domains must still be upserted even when the batch is bad"
    rp = rp_upserts[-1]
    assert rp["expertise_domains"] == ["Robotics"]   # domains survived
    assert rp.get("batch_id") is None                # invalid batch dropped
    # No assignment rows should have been created for an unresolved batch.
    assert not [p for (tbl, p) in fake.inserts if tbl == "reviewer_assignments"]


def test_reviewer_invite_valid_batch_assigns_apps_without_assignment_email(
    client, monkeypatch, _clear_overrides,
):
    """A real batch assignment fans out reviewer_assignments for every app in the
    batch (so the roster shows 'N of Batch X'), and does NOT send the separate
    reviewer-assigned email — the invite credentials email already went out."""
    auth = _ConvertAuth()
    batch_uuid = "b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2"
    fake = _TrackingAdminClient(
        rows={
            "profiles": [], "user_roles": [],
            "batches": [{"id": batch_uuid, "name": "Batch A"}],
            "application_batches": [
                {"application_id": "app-1", "application_track": "tir", "batch_id": batch_uuid},
                {"application_id": "app-2", "application_track": "sip", "batch_id": batch_uuid},
            ],
            "reviewer_assignments": [],
        },
        auth=auth,
    )
    spy = _InviteEmailSpy()
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(admin_users_router, "get_email_service", lambda: spy)
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    res = client.post(
        "/admin/users",
        headers={"Authorization": "Bearer test-token"},
        json={
            "email": "rev-batch@x.com",
            "full_name": "Batch Rev",
            "roles": ["reviewer"],
            "send_invite": True,
            "temp_password": "GoodPass1!xy",
            "expertise_domains": ["AI"],
            "batch_id": batch_uuid,
        },
    )
    assert res.status_code == 201, res.text

    # One reviewer_assignments insert carrying a row per app in the batch.
    ra_inserts = [p for (tbl, p) in fake.inserts if tbl == "reviewer_assignments"]
    assert ra_inserts, "expected reviewer_assignments to be created for the batch"
    created = [row for payload in ra_inserts
               for row in (payload if isinstance(payload, list) else [payload])]
    assigned_apps = {(r["application_id"], r["application_track"]) for r in created}
    assert assigned_apps == {("app-1", "tir"), ("app-2", "sip")}
    assert all(r["reviewer_user_id"] == "u-new" for r in created)

    # The invite credentials email is sent; NO reviewer-assigned email exists in
    # this flow (create_user never imports notify_reviewers_assigned).
    assert len(spy.calls) == 1  # exactly the invite credentials email
