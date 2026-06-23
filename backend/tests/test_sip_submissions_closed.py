"""SIP/VIP intake close (SIP_SUBMISSIONS_CLOSED) — mirrors the TIR-close tests.

When the flag is on, NO new VIP application may be started or submitted. The
closed paths short-circuit with a 403 before any draft is created or any
status flips. Existing-row read access (which returns before the gate) and the
TIR track (separate router) are not exercised here.
"""
from __future__ import annotations

import pytest
from app.deps import get_current_user
from app.main import app as fastapi_app
from app.routers import sip_applications as sip_mod

TEST_USER_ID = "00000000-0000-0000-0000-0000000000bb"


@pytest.fixture
def auth():
    fastapi_app.dependency_overrides[get_current_user] = lambda: {
        "user_id": TEST_USER_ID,
        "email": "vip@example.com",
        "track": "sip",
        "roles": ["applicant"],
    }
    yield
    fastapi_app.dependency_overrides.clear()


@pytest.fixture
def sip_closed(monkeypatch):
    monkeypatch.setattr(sip_mod.settings, "sip_submissions_closed", True)
    yield


def test_sip_closed_get_no_row_blocks_new_draft(client, auth, sip_closed, monkeypatch):
    created: list[str] = []
    monkeypatch.setattr(sip_mod, "_fetch_application", lambda uid: None)
    monkeypatch.setattr(sip_mod, "_create_draft", lambda uid: created.append(uid))
    res = client.get("/sip-applications/me")
    assert res.status_code == 403, res.text
    assert res.json()["error"]["code"] == "sip_submissions_closed"
    assert created == []  # no draft auto-created


def test_sip_closed_patch_no_row_blocks_new_draft(client, auth, sip_closed, monkeypatch):
    created: list[str] = []
    monkeypatch.setattr(sip_mod, "_fetch_application", lambda uid: None)
    monkeypatch.setattr(sip_mod, "_create_draft", lambda uid: created.append(uid))
    res = client.patch("/sip-applications/me", json={"basic_full_name": "Newcomer"})
    assert res.status_code == 403, res.text
    assert res.json()["error"]["code"] == "sip_submissions_closed"
    assert created == []


def test_sip_closed_submit_blocked(client, auth, sip_closed, monkeypatch):
    # Gate returns before check_rate / DB; stub check_rate just in case.
    monkeypatch.setattr(sip_mod, "check_rate", lambda *a, **k: None)
    res = client.post("/sip-applications/me/submit")
    assert res.status_code == 403, res.text
    assert res.json()["error"]["code"] == "sip_submissions_closed"


def test_sip_closed_completion_no_row_blocked(client, auth, sip_closed, monkeypatch):
    monkeypatch.setattr(sip_mod, "_fetch_application", lambda uid: None)
    res = client.get("/sip-applications/me/completion")
    assert res.status_code == 403, res.text
    assert res.json()["error"]["code"] == "sip_submissions_closed"


def test_sip_open_flag_default():
    """Regression: with the flag off (default) the gate never fires."""
    assert sip_mod.settings.sip_submissions_closed is False
