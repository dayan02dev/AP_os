"""Signup must refuse known throwaway inboxes.

Added after the 2026-08-19 probing session, which ran from a hutdot.com
address. The block sits on /auth/request-otp — the only door through which a
new account is created.
"""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from app.routers import auth as auth_mod


@pytest.fixture(autouse=True)
def _reset_email_rate_limit():
    """Each test starts with an empty per-email counter, so a repeated address
    across tests cannot trip the rate limiter instead of the guard."""
    auth_mod._reset_email_rate_limits()
    yield
    auth_mod._reset_email_rate_limits()


@pytest.fixture
def mock_supabase(monkeypatch):
    anon = MagicMock(name="anon-client")
    admin = MagicMock(name="admin-client")
    monkeypatch.setattr(auth_mod, "get_anon_client", lambda: anon)
    monkeypatch.setattr(auth_mod, "get_admin_client", lambda: admin)
    return anon, admin


def test_disposable_signup_is_refused_and_never_reaches_supabase(client, mock_supabase):
    anon, _admin = mock_supabase
    anon.auth.sign_in_with_otp.return_value = MagicMock()

    res = client.post("/auth/request-otp", json={"email": "wiwohow412@hutdot.com"})

    assert res.status_code == 422
    assert res.json()["error"]["code"] == "disposable_email"
    # The whole point: no OTP is sent, so the project-wide Supabase OTP quota
    # is not burned by throwaway signups.
    anon.auth.sign_in_with_otp.assert_not_called()


def test_a_subdomain_of_a_throwaway_provider_is_also_refused(client, mock_supabase):
    anon, _admin = mock_supabase
    res = client.post("/auth/request-otp", json={"email": "x@inbox.mailinator.com"})
    assert res.status_code == 422
    anon.auth.sign_in_with_otp.assert_not_called()


def test_real_addresses_are_unaffected(client, mock_supabase):
    anon, _admin = mock_supabase
    anon.auth.sign_in_with_otp.return_value = MagicMock()

    res = client.post("/auth/request-otp", json={"email": "sumitlonkar@iisc.ac.in"})

    assert res.status_code == 200
    anon.auth.sign_in_with_otp.assert_called_once()


def test_the_block_is_case_and_whitespace_insensitive(client, mock_supabase):
    anon, _admin = mock_supabase
    res = client.post("/auth/request-otp", json={"email": "WIWOHOW412@HutDot.com"})
    assert res.status_code == 422
    anon.auth.sign_in_with_otp.assert_not_called()
