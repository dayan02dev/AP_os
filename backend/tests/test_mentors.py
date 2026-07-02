"""/mentors router tests.

Email delivery is mocked at the httpx.Client.post level inside
app.services.email_service. Supabase admin client is replaced with an
in-memory fake that records inserts/updates and serves pre-seeded rows for
selects. Auth is injected via FastAPI's app.dependency_overrides.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch
from uuid import uuid4

import httpx
import pytest


# ─── In-memory Supabase fake ─────────────────────────────────────────────


class _FakeQuery:
    """Chainable query builder matching the supabase-py interface used by mentors.py."""

    def __init__(self, table: "_FakeTable", op: str, payload=None):
        self._table = table
        self._op = op
        self._payload = payload
        self._filters: list[tuple[str, str, object]] = []
        self._limit_val: int | None = None

    def eq(self, col, val):
        self._filters.append(("eq", col, val))
        return self

    def ilike(self, col, val):
        self._filters.append(("ilike", col, val))
        return self

    def order(self, *_a, **_kw):
        return self

    def limit(self, n):
        self._limit_val = n
        return self

    def execute(self):
        if self._op == "insert":
            row = {"id": str(uuid4()), **(self._payload or {})}
            self._table.inserts.append(row)
            return MagicMock(data=[row])

        if self._op == "update":
            record = {"patch": self._payload, "filters": list(self._filters)}
            self._table.updates.append(record)
            return MagicMock(data=[self._payload])

        if self._op == "select":
            rows = list(self._table.rows)
            for kind, col, val in self._filters:
                if kind == "eq":
                    rows = [r for r in rows if r.get(col) == val]
                elif kind == "ilike":
                    rows = [r for r in rows if str(r.get(col, "")).lower() == str(val).lower()]
            if self._limit_val is not None:
                rows = rows[: self._limit_val]
            return MagicMock(data=rows)

        return MagicMock(data=[])


class _FakeTable:
    def __init__(self, client: "FakeSupabaseClient", name: str):
        self._client = client
        self._name = name

    @property
    def inserts(self):
        return self._client.inserts.setdefault(self._name, [])

    @property
    def updates(self):
        return self._client.updates.setdefault(self._name, [])

    @property
    def rows(self):
        return self._client.rows.setdefault(self._name, [])

    def insert(self, payload):
        return _FakeQuery(self, "insert", payload)

    def update(self, payload):
        return _FakeQuery(self, "update", payload)

    def select(self, *_a, **_kw):
        return _FakeQuery(self, "select")


class FakeSupabaseClient:
    def __init__(self):
        self.inserts: dict[str, list[dict]] = {}
        self.updates: dict[str, list[dict]] = {}
        self.rows: dict[str, list[dict]] = {}

    def table(self, name):
        return _FakeTable(self, name)

    def seed(self, name: str, rows: list[dict]) -> None:
        self.rows[name] = rows


# ─── Fixtures ────────────────────────────────────────────────────────────


@pytest.fixture
def fake_db():
    return FakeSupabaseClient()


@pytest.fixture
def install_db(fake_db):
    with patch("app.routers.mentors.get_admin_client", return_value=fake_db):
        yield fake_db


def _ok_resend_response() -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = 200
    resp.json.return_value = {"id": "resend-mentor-001"}
    resp.text = '{"id":"resend-mentor-001"}'
    return resp


def _patch_email():
    from app.services import email_service as es

    es.get_email_service.cache_clear()
    svc = es.get_email_service()
    fake_client = MagicMock(spec=httpx.Client)
    fake_client.post = MagicMock(return_value=_ok_resend_response())
    svc._http = fake_client
    return fake_client


@pytest.fixture
def ses_mock():
    from app.services import email_service as es

    fake = _patch_email()
    with (
        patch.object(es.settings, "ses_from_email", "noreply@artpark.test"),
        patch.object(es.settings, "resend_api_key", "re_test_key_not_real"),
    ):
        yield fake.post
    es.get_email_service.cache_clear()


@pytest.fixture
def admin_user():
    """Override require_capability('manage_users') to pass through."""
    from app.main import app
    from app.rbac import require_capability

    cap_dep = require_capability("manage_users")

    async def _pass():
        return None

    app.dependency_overrides[cap_dep] = _pass
    yield
    app.dependency_overrides.pop(cap_dep, None)


# ─── Helpers ─────────────────────────────────────────────────────────────


def _seed_invite(fake_db: FakeSupabaseClient, *, token: str, responded: bool = False) -> dict:
    invite_id = str(uuid4())
    invite = {
        "id": invite_id,
        "name": "Dr. Priya Sharma",
        "email": "priya@example.com",
        "token": token,
        "invited_by": None,
        "status": "invited",
        "sent_at": None,
        "created_at": "2026-07-01T10:00:00+00:00",
    }
    fake_db.seed("mentor_invites", [invite])
    if responded:
        response_row = {
            "id": str(uuid4()),
            "invite_id": invite_id,
            "willing": True,
            "days_available": "Weekends",
            "honorarium_opt_in": None,
            "bank_details": None,
            "future_comms_opt_in": None,
            "contact_email": None,
            "submitted_at": "2026-07-01T12:00:00+00:00",
        }
        fake_db.seed("mentor_responses", [response_row])
    return invite


# ─── Tests ───────────────────────────────────────────────────────────────


class TestGetMentorForm:
    def test_valid_token_returns_form_view(self, client, install_db):
        token = "tok_abc123"
        _seed_invite(install_db, token=token)

        res = client.get(f"/mentors/respond/{token}")
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["mentor_name"] == "Dr. Priya Sharma"
        assert body["email"] == "priya@example.com"
        assert body["already_responded"] is False

    def test_unknown_token_returns_404(self, client, install_db):
        res = client.get("/mentors/respond/nonexistent_token")
        assert res.status_code == 404

    def test_already_responded_flag(self, client, install_db):
        token = "tok_responded"
        _seed_invite(install_db, token=token, responded=True)

        res = client.get(f"/mentors/respond/{token}")
        assert res.status_code == 200
        assert res.json()["already_responded"] is True


class TestPostMentorResponseDecline:
    def test_decline_inserts_response_and_sets_declined(self, client, install_db, ses_mock):
        token = "tok_decline"
        _seed_invite(install_db, token=token)

        res = client.post(
            f"/mentors/respond/{token}",
            json={"willing": False},
        )
        assert res.status_code == 200, res.text
        assert res.json()["status"] == "ok"

        responses = install_db.inserts.get("mentor_responses", [])
        assert len(responses) == 1
        assert responses[0]["willing"] is False

        # Invite status set to 'declined'
        updates = install_db.updates.get("mentor_invites", [])
        assert any(u["patch"].get("status") == "declined" for u in updates)

        # Notification email sent
        assert ses_mock.called

    def test_decline_unknown_token_404(self, client, install_db, ses_mock):
        res = client.post(
            "/mentors/respond/bad_token",
            json={"willing": False},
        )
        assert res.status_code == 404


class TestPostMentorResponseFullYes:
    def test_full_yes_inserts_with_bank_details(self, client, install_db, ses_mock):
        token = "tok_full_yes"
        _seed_invite(install_db, token=token)

        payload = {
            "willing": True,
            "days_available": "Mondays and Tuesdays",
            "honorarium_opt_in": True,
            "bank_details": {
                "account_name": "Dr Priya Sharma",
                "account_number": "123456789012",
                "ifsc": "SBIN0001234",
            },
            "future_comms_opt_in": True,
            "contact_email": "priya@example.com",
        }
        res = client.post(f"/mentors/respond/{token}", json=payload)
        assert res.status_code == 200, res.text
        assert res.json()["status"] == "ok"

        responses = install_db.inserts.get("mentor_responses", [])
        assert len(responses) == 1
        assert responses[0]["willing"] is True
        assert responses[0]["bank_details"] is not None

        # Notification called
        assert ses_mock.called

        # Assert the rendered notification email text does NOT contain the raw account number
        call_args_list = ses_mock.call_args_list
        for call in call_args_list:
            request_payload = call[1].get("json") or (call[0][0] if call[0] else {})
            text_body = request_payload.get("text", "")
            html_body = request_payload.get("html", "")
            assert "123456789012" not in text_body, "Raw account number leaked into email text"
            assert "123456789012" not in html_body, "Raw account number leaked into email html"

    def test_invite_status_set_to_responded(self, client, install_db, ses_mock):
        token = "tok_responded_status"
        _seed_invite(install_db, token=token)

        client.post(
            f"/mentors/respond/{token}",
            json={"willing": True, "days_available": "Fridays"},
        )
        updates = install_db.updates.get("mentor_invites", [])
        assert any(u["patch"].get("status") == "responded" for u in updates)


class TestPostMentorResponseValidation:
    def test_willing_true_without_days_returns_422(self, client, install_db):
        token = "tok_invalid"
        _seed_invite(install_db, token=token)

        res = client.post(
            f"/mentors/respond/{token}",
            json={"willing": True},  # missing days_available
        )
        assert res.status_code == 422

    def test_honorarium_true_without_bank_details_returns_422(self, client, install_db):
        token = "tok_no_bank"
        _seed_invite(install_db, token=token)

        res = client.post(
            f"/mentors/respond/{token}",
            json={
                "willing": True,
                "days_available": "Weekends",
                "honorarium_opt_in": True,
                # bank_details missing
            },
        )
        assert res.status_code == 422


class TestIdempotentResubmit:
    def test_resubmit_returns_ok_without_duplicate_insert(self, client, install_db, ses_mock):
        token = "tok_idempotent"
        _seed_invite(install_db, token=token, responded=True)

        # Second submit should not error and should not insert another row.
        res = client.post(
            f"/mentors/respond/{token}",
            json={"willing": False},
        )
        assert res.status_code == 200
        assert res.json()["status"] == "ok"

        # No new insert happened.
        responses = install_db.inserts.get("mentor_responses", [])
        assert len(responses) == 0
