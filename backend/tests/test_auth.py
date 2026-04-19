"""Auth router tests (Phase 3).

Covers:
  - test_request_otp_valid_email
  - test_request_otp_invalid_email
  - test_verify_otp_success
  - test_verify_otp_wrong_code
  - test_me_requires_auth
  - test_rate_limit_request_otp

Every Supabase call is mocked; these tests never hit a real network.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from app.deps import get_current_user
from app.main import app as fastapi_app
from app.routers import auth as auth_mod

# ─── Shared fixtures ───────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _reset_email_rate_limit():
    """Each test starts with an empty per-email counter."""
    auth_mod._reset_email_rate_limits()
    yield
    auth_mod._reset_email_rate_limits()


@pytest.fixture(autouse=True)
def _clear_dependency_overrides():
    """Don't leak dep overrides between tests."""
    yield
    fastapi_app.dependency_overrides.clear()


@pytest.fixture
def mock_supabase(monkeypatch):
    """Attach fresh mocks to both anon and admin factories.

    Returns (anon_mock, admin_mock) so tests can assert calls or set
    return values.
    """
    anon = MagicMock(name="anon-client")
    admin = MagicMock(name="admin-client")
    monkeypatch.setattr(auth_mod, "get_anon_client", lambda: anon)
    monkeypatch.setattr(auth_mod, "get_admin_client", lambda: admin)
    return anon, admin


# ─── Request OTP ───────────────────────────────────────────────────

def test_request_otp_valid_email(client, mock_supabase):
    anon, _admin = mock_supabase
    anon.auth.sign_in_with_otp.return_value = MagicMock()

    res = client.post("/auth/request-otp", json={"email": "user@example.com"})

    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    # Generic message regardless of whether the email exists.
    assert "OTP" in body["message"]
    anon.auth.sign_in_with_otp.assert_called_once()
    call_args = anon.auth.sign_in_with_otp.call_args[0][0]
    assert call_args["email"] == "user@example.com"
    assert call_args["options"]["should_create_user"] is True


def test_request_otp_invalid_email(client):
    """Malformed email → 422 (pydantic EmailStr rejects)."""
    res = client.post("/auth/request-otp", json={"email": "not-an-email"})
    assert res.status_code == 422


# ─── Verify OTP ────────────────────────────────────────────────────

def _make_verify_result(user_id: str, email: str, access: str, refresh: str):
    """Shape supabase-py's verify_otp return value: .session + .user."""
    return SimpleNamespace(
        session=SimpleNamespace(access_token=access, refresh_token=refresh),
        user=SimpleNamespace(id=user_id, email=email),
    )


def test_verify_otp_success(client, mock_supabase):
    anon, admin = mock_supabase
    anon.auth.verify_otp.return_value = _make_verify_result(
        user_id="u-123",
        email="user@example.com",
        access="access-xyz",
        refresh="refresh-abc",
    )
    admin.table.return_value.insert.return_value.execute.return_value = MagicMock()

    res = client.post(
        "/auth/verify-otp",
        json={"email": "user@example.com", "token": "123456"},
    )

    assert res.status_code == 200
    body = res.json()
    assert body["access_token"] == "access-xyz"
    assert body["refresh_token"] == "refresh-abc"
    assert body["user"] == {"id": "u-123", "email": "user@example.com"}
    # Audit log written via admin.table("audit_logs").insert(...)
    admin.table.assert_any_call("audit_logs")


def test_verify_otp_wrong_code(client, mock_supabase):
    anon, _admin = mock_supabase
    anon.auth.verify_otp.side_effect = Exception("invalid OTP")

    res = client.post(
        "/auth/verify-otp",
        json={"email": "user@example.com", "token": "000000"},
    )

    assert res.status_code == 401
    body = res.json()
    assert body["error"]["code"] == "otp_invalid"
    # Message must NOT leak the underlying supabase error.
    assert "invalid OTP" not in body["error"]["message"]


def test_verify_otp_rejects_non_numeric_token(client, mock_supabase):
    """Pydantic validator rejects non-6-digit tokens before we hit Supabase."""
    res = client.post(
        "/auth/verify-otp",
        json={"email": "user@example.com", "token": "abcdef"},
    )
    assert res.status_code == 422


# ─── Me ────────────────────────────────────────────────────────────

def test_me_requires_auth(client):
    """No Authorization header → 401 from get_current_user."""
    res = client.get("/auth/me")
    assert res.status_code == 401


def test_me_returns_profile_when_authed(client, mock_supabase):
    """Authed call returns the profile row fetched via admin client."""
    _anon, admin = mock_supabase

    # Override the auth dependency to inject a known user.
    fastapi_app.dependency_overrides[get_current_user] = lambda: {
        "user_id": "u-123",
        "email": "user@example.com",
    }

    # Mock the profiles select chain.
    profile_row = {
        "id": "u-123",
        "email": "user@example.com",
        "full_name": "Test User",
        "phone": None,
        "linkedin_url": None,
        "location_city": None,
        "location_country": None,
        "created_at": "2026-04-19T12:00:00+00:00",
    }
    admin.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[profile_row],
    )

    res = client.get("/auth/me", headers={"Authorization": "Bearer whatever"})

    assert res.status_code == 200
    body = res.json()
    assert body["id"] == "u-123"
    assert body["email"] == "user@example.com"
    assert body["full_name"] == "Test User"


# ─── Rate limit ────────────────────────────────────────────────────

def test_rate_limit_request_otp(client, mock_supabase):
    """4th request-otp for the same email within 15 min → 429."""
    anon, _admin = mock_supabase
    anon.auth.sign_in_with_otp.return_value = MagicMock()

    # First 3 must succeed.
    for _ in range(3):
        res = client.post("/auth/request-otp", json={"email": "rl@example.com"})
        assert res.status_code == 200

    # 4th is over quota.
    res = client.post("/auth/request-otp", json={"email": "rl@example.com"})
    assert res.status_code == 429
    assert "Retry-After" in res.headers

    # A DIFFERENT email is not affected by another email's bucket.
    res = client.post("/auth/request-otp", json={"email": "other@example.com"})
    assert res.status_code == 200
