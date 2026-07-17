"""require_founder_access: gate on ownership + offered/onboarded status."""
from __future__ import annotations

import pytest

from app.deps import get_current_user
from app.main import app
from tests.fixtures.fake_supabase import FakeSupabase


@pytest.fixture
def _clear():
    yield
    app.dependency_overrides.clear()


def _override_user(user_id: str):
    def _f():
        return {"user_id": user_id, "email": f"{user_id}@x.com", "track": "tir", "roles": ["applicant"]}
    return _f


def _install(monkeypatch, tables: dict) -> FakeSupabase:
    from app.routers import founder as founder_router
    fake = FakeSupabase(tables)
    monkeypatch.setattr(founder_router, "get_admin_client", lambda: fake)
    return fake


def test_offered_owner_gets_access(client, monkeypatch, _clear):
    _install(monkeypatch, {
        "tir_applications": [
            {"id": "app1", "user_id": "u1", "status": "offered", "grant_amount": 2500000, "submitted_at": "2026-07-01"},
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.get("/founder/me")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "offered"


def test_non_offered_user_is_denied(client, monkeypatch, _clear):
    _install(monkeypatch, {
        "tir_applications": [
            {"id": "app1", "user_id": "u1", "status": "submitted", "grant_amount": 2500000, "submitted_at": "2026-07-01"},
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.get("/founder/me")
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "founder_access_denied"


def test_other_users_app_is_not_visible(client, monkeypatch, _clear):
    _install(monkeypatch, {
        "tir_applications": [
            {"id": "app1", "user_id": "someone_else", "status": "onboarded", "grant_amount": 2500000, "submitted_at": "2026-07-01"},
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.get("/founder/me")
    assert r.status_code == 403
