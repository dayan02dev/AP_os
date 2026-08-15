"""The venture name must come from ai_screening, not from a phantom embed.

Regression guard: `_project_name` used to read an `ai_screening_project_name`
key off the application row, which `require_founder_access` never selects, so
it returned "" for every founder — blanking the venture name in the MOU body,
the signed PDF and the dashboard heading.
"""
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
    return lambda: {"user_id": user_id, "email": f"{user_id}@x.com",
                    "track": "tir", "roles": ["applicant"]}


def _install(monkeypatch, tables: dict) -> FakeSupabase:
    from app.routers import founder as founder_router
    from app.services import founder_query
    fake = FakeSupabase(tables)
    monkeypatch.setattr(founder_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(founder_query, "get_admin_client", lambda: fake)
    return fake


def test_me_returns_the_project_name_from_ai_screening(client, monkeypatch, _clear):
    _install(monkeypatch, {
        "tir_applications": [
            {"id": "app1", "user_id": "u1", "status": "onboarded",
             "grant_amount": 2500000, "submitted_at": "2026-07-01"},
        ],
        "ai_screening": [
            {"application_id": "app1", "application_track": "tir",
             "project_name": "Neonatal sepsis monitor"},
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.get("/founder/me")
    assert r.status_code == 200, r.text
    assert r.json()["project_name"] == "Neonatal sepsis monitor"


def test_project_name_is_scoped_to_the_track(client, monkeypatch, _clear):
    """A sip row with the same application_id must not leak into a tir read."""
    _install(monkeypatch, {
        "tir_applications": [
            {"id": "app1", "user_id": "u1", "status": "onboarded",
             "grant_amount": 2500000, "submitted_at": "2026-07-01"},
        ],
        "ai_screening": [
            {"application_id": "app1", "application_track": "sip",
             "project_name": "Wrong track"},
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.get("/founder/me")
    assert r.status_code == 200, r.text
    assert r.json()["project_name"] == ""


def test_missing_ai_screening_row_yields_empty_string(client, monkeypatch, _clear):
    _install(monkeypatch, {
        "tir_applications": [
            {"id": "app1", "user_id": "u1", "status": "onboarded",
             "grant_amount": 2500000, "submitted_at": "2026-07-01"},
        ],
        "ai_screening": [],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.get("/founder/me")
    assert r.status_code == 200, r.text
    assert r.json()["project_name"] == ""
