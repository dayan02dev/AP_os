import copy
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from app.deps import get_current_user
from app.main import app as fastapi_app
from app.models.sip_application import SipApplicationRead
from app.routers import sip_applications as sip_mod
from app.services import edit_window

USER = "00000000-0000-0000-0000-0000000000bb"
APP_ID = "33333333-3333-3333-3333-333333333333"


def _row():
    return {
        "id": "11111111-1111-1111-1111-111111111111",
        "user_id": "00000000-0000-0000-0000-0000000000bb",
        "status": "submitted",
        "completion_pct": 100,
        "submitted_at": "2026-06-04T00:00:00+00:00",
        "created_at": "2026-06-04T00:00:00+00:00",
        "updated_at": "2026-06-04T00:00:00+00:00",
    }


def test_read_model_has_edit_fields_defaulting_off():
    read = SipApplicationRead.model_validate(_row())
    assert read.editable is False
    assert read.edit_deadline is None


@pytest.fixture(autouse=True)
def _auth():
    fastapi_app.dependency_overrides[get_current_user] = lambda: {"user_id": USER, "email": "sip@b.com"}
    yield
    fastapi_app.dependency_overrides.clear()


@pytest.fixture
def submitted_db(monkeypatch):
    state = {"row": {
        "id": APP_ID, "user_id": USER, "status": "submitted", "completion_pct": 100,
        "submitted_at": "2026-06-04T00:00:00+00:00", "created_at": "2026-06-04T00:00:00+00:00",
        "updated_at": "2026-06-04T00:00:00+00:00", "basic_full_name": "Old Name",
    }, "published": [], "audited": []}

    def fake_by_id(app_id):
        return copy.deepcopy(state["row"]) if app_id == state["row"]["id"] else None

    def fake_update(app_id, patch):
        state["row"].update(patch)
        return copy.deepcopy(state["row"])

    monkeypatch.setattr(sip_mod, "_fetch_application_by_id", fake_by_id)
    monkeypatch.setattr(sip_mod, "_update_application", fake_update)
    monkeypatch.setattr(sip_mod, "_audit", lambda **k: state["audited"].append(k))
    monkeypatch.setattr(sip_mod.sqs_publisher, "publish", lambda i, t: state["published"].append((i, t)))
    monkeypatch.setattr(edit_window.settings, "edit_deadline_sip", "2099-01-01T00:00:00+05:30")
    return state


def test_edit_in_window_saves_flags_and_rescreens(client, submitted_db):
    res = client.patch(f"/sip-applications/{APP_ID}", json={"basic_full_name": "New Name"})
    assert res.status_code == 200
    assert submitted_db["row"]["basic_full_name"] == "New Name"
    assert submitted_db["row"]["edited_after_submit"] is True
    assert submitted_db["row"]["last_edited_at"] is not None
    assert submitted_db["published"] == [(APP_ID, "sip")]
    assert submitted_db["audited"][0]["action"] == "application.edited_after_submit"


def test_edit_after_deadline_is_403(client, submitted_db, monkeypatch):
    monkeypatch.setattr(edit_window.settings, "edit_deadline_sip", "2000-01-01T00:00:00+05:30")
    res = client.patch(f"/sip-applications/{APP_ID}", json={"basic_full_name": "X"})
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "edit_window_closed"


def test_edit_wrong_owner_is_404(client, submitted_db, monkeypatch):
    submitted_db["row"]["user_id"] = "99999999-9999-9999-9999-999999999999"
    res = client.patch(f"/sip-applications/{APP_ID}", json={"basic_full_name": "X"})
    assert res.status_code == 404


def test_edit_draft_status_is_409(client, submitted_db):
    submitted_db["row"]["status"] = "draft"
    res = client.patch(f"/sip-applications/{APP_ID}", json={"basic_full_name": "X"})
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "not_editable"


def test_edit_invalid_value_is_422(client, submitted_db):
    # sip_incorporated is a Literal enum — feeding a junk string triggers 422.
    # Valid values are "Yes — Pvt Ltd, registered in India" or
    # "Not yet — we're still pre-incorporation"; anything else is invalid.
    res = client.patch(f"/sip-applications/{APP_ID}", json={"sip_incorporated": "maybe"})
    assert res.status_code == 422


def test_edit_declaration_false_returns_422(client, submitted_db):
    """PATCHing declaration_truthful=False on a submitted in-window SIP app must return 422."""
    res = client.patch(f"/sip-applications/{APP_ID}", json={"declaration_truthful": False})
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "declaration_required"
