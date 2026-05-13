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
    def order(self, *_args, **_kwargs): return self
    def limit(self, *_args, **_kwargs): return self
    def range(self, *_args, **_kwargs): return self
    def or_(self, *_args, **_kwargs): return self

    def execute(self):
        return SimpleNamespace(data=self._data, count=self._count)


class _FakeAdminClient:
    def __init__(self, rows: dict[str, list[dict]] | None = None,
                 counts: dict[str, int] | None = None):
        self._rows = rows or {}
        self._counts = counts or {}

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
