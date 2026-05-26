"""Tests for PATCH /auth/me/track.

Why this endpoint exists
========================

The SIP RLS policies (migration 011_sip_track.sql) gate every read/write
on sip_applications + SIP storage buckets behind
`EXISTS(... profiles WHERE id=auth.uid() AND track='sip')`. The TIR
policies have no such gate. So when a user picks SIP at the chooser their
`profiles.track` MUST flip to 'sip', and back to 'tir' when they pick TIR,
otherwise RLS blocks drafting / viewing in the other track.

This endpoint is the safe, audited way the frontend chooser performs that
flip without dropping the RLS gate (which would be the only alternative).
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from app.deps import get_current_user
from app.main import app as fastapi_app
from app.routers import auth as auth_mod


@pytest.fixture(autouse=True)
def _clear_dependency_overrides():
    yield
    fastapi_app.dependency_overrides.clear()


@pytest.fixture
def mock_supabase(monkeypatch):
    anon = MagicMock(name="anon-client")
    admin = MagicMock(name="admin-client")
    monkeypatch.setattr(auth_mod, "get_anon_client", lambda: anon)
    monkeypatch.setattr(auth_mod, "get_admin_client", lambda: admin)
    return anon, admin


def _override_user(user_id: str = "u-123", email: str = "user@example.com") -> None:
    fastapi_app.dependency_overrides[get_current_user] = lambda: {
        "user_id": user_id,
        "email": email,
    }


# ─── Happy path ────────────────────────────────────────────────────

def test_patch_track_sip_success(client, mock_supabase):
    """Valid track='sip' → 200, admin client updates profiles row."""
    _anon, admin = mock_supabase
    _override_user("u-123")

    # admin.table('profiles').update({...}).eq('id', ...).execute()
    admin.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[{"id": "u-123", "track": "sip"}],
    )

    res = client.patch(
        "/auth/me/track",
        headers={"Authorization": "Bearer whatever"},
        json={"track": "sip"},
    )

    assert res.status_code == 200
    body = res.json()
    assert body == {"ok": True, "track": "sip"}

    # Verify the SQL chain — profiles table, update with the new track,
    # filtered by auth user id.
    admin.table.assert_any_call("profiles")
    update_call = admin.table.return_value.update.call_args[0][0]
    assert update_call == {"track": "sip"}
    eq_call = admin.table.return_value.update.return_value.eq.call_args[0]
    assert eq_call == ("id", "u-123")


def test_patch_track_tir_success(client, mock_supabase):
    """Symmetric: track='tir' also works (user switching back from SIP)."""
    _anon, admin = mock_supabase
    _override_user("u-456")

    admin.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[{"id": "u-456", "track": "tir"}],
    )

    res = client.patch(
        "/auth/me/track",
        headers={"Authorization": "Bearer whatever"},
        json={"track": "tir"},
    )

    assert res.status_code == 200
    assert res.json() == {"ok": True, "track": "tir"}


# ─── Validation ────────────────────────────────────────────────────

def test_patch_track_invalid_value(client, mock_supabase):
    """track='other' → 422 (Pydantic Literal rejects)."""
    _override_user()

    res = client.patch(
        "/auth/me/track",
        headers={"Authorization": "Bearer whatever"},
        json={"track": "other"},
    )

    assert res.status_code == 422


def test_patch_track_missing_field(client, mock_supabase):
    """Empty body → 422."""
    _override_user()

    res = client.patch(
        "/auth/me/track",
        headers={"Authorization": "Bearer whatever"},
        json={},
    )

    assert res.status_code == 422


# ─── Auth ──────────────────────────────────────────────────────────

def test_patch_track_requires_auth(client):
    """No Authorization header → 401."""
    res = client.patch("/auth/me/track", json={"track": "sip"})
    assert res.status_code == 401


# ─── Supabase failure path ─────────────────────────────────────────

def test_patch_track_supabase_failure(client, mock_supabase):
    """Admin client raising → 500 with shaped error envelope."""
    _anon, admin = mock_supabase
    _override_user()

    admin.table.return_value.update.return_value.eq.return_value.execute.side_effect = Exception(
        "supabase down"
    )

    res = client.patch(
        "/auth/me/track",
        headers={"Authorization": "Bearer whatever"},
        json={"track": "sip"},
    )

    assert res.status_code == 500
    body = res.json()
    assert body["error"]["code"] == "track_update_failed"
    # Don't leak the underlying error to the client.
    assert "supabase down" not in body["error"]["message"]
