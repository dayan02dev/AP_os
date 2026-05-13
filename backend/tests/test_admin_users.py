"""Smoke tests for admin user provisioning.

Skipped in CI by default — they actually create users in the staging
Supabase project. Run manually with:

    RUN_STAGING_TESTS=1 pytest tests/test_admin_users.py -v

The fixtures `staging_admin_token` and `staging_base_url` are populated
in conftest.py (Task 9 sets them up alongside the broader vertical-slice
smoke test).
"""

import os
import secrets

import pytest

pytestmark = pytest.mark.skipif(
    not os.getenv("RUN_STAGING_TESTS"),
    reason="set RUN_STAGING_TESTS=1 to enable",
)


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
