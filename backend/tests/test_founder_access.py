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


def _override_user(user_id: str, email: str | None = None):
    def _f():
        return {
            "user_id": user_id,
            "email": f"{user_id}@x.com" if email is None else email,
            "track": "tir",
            "roles": ["applicant"],
        }
    return _f


@pytest.fixture
def _allowlist(monkeypatch):
    """Set FOUNDER_PORTAL_ALLOWLIST on the live settings object."""
    from app.config import settings

    def _set(value: str):
        monkeypatch.setattr(settings, "founder_portal_allowlist", value)
    return _set


_OFFERED_APP = {
    "tir_applications": [
        {"id": "app1", "user_id": "u1", "status": "offered",
         "grant_amount": 2500000, "submitted_at": "2026-07-01"},
    ],
}


def _install(monkeypatch, tables: dict) -> FakeSupabase:
    from app.routers import founder as founder_router
    from app.services import founder_query
    fake = FakeSupabase(tables)
    monkeypatch.setattr(founder_router, "get_admin_client", lambda: fake)
    # /founder/me (Task 8) also reads via founder_query.fetch_mou, which uses
    # its own get_admin_client() reference — patch it too or it hits the network.
    monkeypatch.setattr(founder_query, "get_admin_client", lambda: fake)
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


# ── soft-launch allow-list ────────────────────────────────────────────


def test_allowlisted_email_gets_access(client, monkeypatch, _clear, _allowlist):
    _allowlist("founder@artpark.in")
    _install(monkeypatch, _OFFERED_APP)
    app.dependency_overrides[get_current_user] = _override_user("u1", "founder@artpark.in")
    r = client.get("/founder/me")
    assert r.status_code == 200, r.text


def test_allowlist_is_case_insensitive(client, monkeypatch, _clear, _allowlist):
    _allowlist("Founder@ArtPark.IN")
    _install(monkeypatch, _OFFERED_APP)
    app.dependency_overrides[get_current_user] = _override_user("u1", "FOUNDER@artpark.in")
    r = client.get("/founder/me")
    assert r.status_code == 200, r.text


def test_non_allowlisted_email_denied_even_when_offered(client, monkeypatch, _clear, _allowlist):
    """The whole point of the soft-launch gate: an 'offered' application is
    NOT sufficient while the allow-list is set."""
    _allowlist("founder@artpark.in")
    _install(monkeypatch, _OFFERED_APP)
    app.dependency_overrides[get_current_user] = _override_user("u1", "someone.else@gmail.com")
    r = client.get("/founder/me")
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "founder_access_denied"


def test_empty_allowlist_allows_any_offered_founder(client, monkeypatch, _clear, _allowlist):
    _allowlist("")
    _install(monkeypatch, _OFFERED_APP)
    app.dependency_overrides[get_current_user] = _override_user("u1", "anyone@gmail.com")
    r = client.get("/founder/me")
    assert r.status_code == 200, r.text


def test_missing_email_denied_when_allowlist_set(client, monkeypatch, _clear, _allowlist):
    _allowlist("founder@artpark.in")
    _install(monkeypatch, _OFFERED_APP)
    app.dependency_overrides[get_current_user] = _override_user("u1", "")
    r = client.get("/founder/me")
    assert r.status_code == 403


def test_multi_entry_allowlist_parses(client, monkeypatch, _clear, _allowlist):
    _allowlist(" a@x.com , founder@artpark.in ,, b@y.com ")
    _install(monkeypatch, _OFFERED_APP)
    app.dependency_overrides[get_current_user] = _override_user("u1", "founder@artpark.in")
    r = client.get("/founder/me")
    assert r.status_code == 200, r.text


# ── Founders Resources availability map (server-driven, per-item release) ──


def test_me_reports_all_resources_locked_by_default(client, monkeypatch, _clear):
    _install(monkeypatch, _OFFERED_APP)
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.get("/founder/me")
    assert r.json()["resources_available"] == {
        "store": False, "fundraising": False, "partners": False,
        "assets": False, "support": False,
    }


def test_me_reports_only_enabled_resources_as_available(client, monkeypatch, _clear):
    from app.config import settings
    monkeypatch.setattr(settings, "founder_resources_enabled", "store, assets")
    _install(monkeypatch, _OFFERED_APP)
    app.dependency_overrides[get_current_user] = _override_user("u1")
    body = client.get("/founder/me").json()
    assert body["resources_available"]["store"] is True
    assert body["resources_available"]["assets"] is True
    assert body["resources_available"]["fundraising"] is False
