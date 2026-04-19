"""/support router tests.

All SES calls are mocked via `boto3.client` at the `app.services.email_service`
import site. The Supabase admin client is replaced with an in-memory fake that
records inserts/updates and serves pre-seeded rows for selects.

Auth is injected via FastAPI's `app.dependency_overrides` — tests never rely on
real Supabase JWT verification.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from botocore.exceptions import ClientError


VALID_PAYLOAD = {
    "email": "applicant@example.com",
    "subject": "CV upload keeps failing",
    "body": (
        "Every time I try to upload a PDF it times out at about 90 percent. "
        "Browser is Chrome 129 on macOS."
    ),
    "category": "technical",
}


# ─── In-memory Supabase fake ─────────────────────────────────────────────


class _FakeQuery:
    """Chainable builder that records ops and returns pre-seeded data.

    Enough surface to mimic supabase-py for:
      .insert(row).execute()
      .update(patch).eq(col, val).execute()
      .select("*").eq(col, val).order(...).limit(N).execute()
    """

    def __init__(self, table: "_FakeTable", op: str, payload=None):
        self._table = table
        self._op = op
        self._payload = payload
        self._filters: list[tuple[str, object]] = []

    def eq(self, col, val):
        self._filters.append((col, val))
        return self

    def order(self, *_a, **_kw):
        return self

    def limit(self, n):
        self._limit = n
        return self

    def execute(self):
        if self._op == "insert":
            row = {
                "id": str(uuid4()),
                "user_id": None,
                "status": "open",
                "email_delivery_status": None,
                "created_at": "2026-04-19T12:00:00+00:00",
                **(self._payload or {}),
            }
            self._table.inserts.append(row)
            return MagicMock(data=[row])

        if self._op == "update":
            record = {"patch": self._payload, "filters": list(self._filters)}
            self._table.updates.append(record)
            return MagicMock(data=[self._payload])

        if self._op == "select":
            rows = list(self._table.rows)
            for col, val in self._filters:
                rows = [r for r in rows if r.get(col) == val]
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
    """Route the router's Supabase calls to the fake."""
    with patch("app.routers.support.get_admin_client", return_value=fake_db):
        yield fake_db


@pytest.fixture
def ses_mock():
    """Mock boto3.client so EmailService never hits real SES.

    Also patches `settings.ses_from_email` — the unit-test env doesn't set it,
    and `send_raw` guards against an empty FROM address. Clears the cached
    email_service singleton so a fresh (mocked) client is used.
    """
    from app.services import email_service as es

    fake = MagicMock()
    fake.send_email.return_value = {"MessageId": "ses-msg-001"}

    es.get_email_service.cache_clear()
    with (
        patch("app.services.email_service.boto3.client", return_value=fake),
        patch.object(es.settings, "ses_from_email", "noreply@artpark.test"),
    ):
        yield fake
    es.get_email_service.cache_clear()


@pytest.fixture
def ses_failing():
    """Like ses_mock, but every send_email raises SES ClientError."""
    from app.services import email_service as es

    fake = MagicMock()
    fake.send_email.side_effect = ClientError(
        {
            "Error": {
                "Code": "MessageRejected",
                "Message": "Email address is not verified",
            }
        },
        "SendEmail",
    )

    es.get_email_service.cache_clear()
    with (
        patch("app.services.email_service.boto3.client", return_value=fake),
        patch.object(es.settings, "ses_from_email", "noreply@artpark.test"),
    ):
        yield fake
    es.get_email_service.cache_clear()


@pytest.fixture
def authed_user():
    """Override the optional + required auth deps to return a stable user."""
    from app.deps import get_current_user
    from app.main import app
    from app.routers.support import get_current_user_optional

    user = {"user_id": str(uuid4()), "email": "caller@artpark.in"}

    async def _dep():
        return user

    app.dependency_overrides[get_current_user_optional] = _dep
    app.dependency_overrides[get_current_user] = _dep
    yield user
    app.dependency_overrides.pop(get_current_user_optional, None)
    app.dependency_overrides.pop(get_current_user, None)


# ─── Tests ───────────────────────────────────────────────────────────────


def test_create_ticket_anon(client, install_db, ses_mock):
    res = client.post("/support/ticket", json=VALID_PAYLOAD)
    assert res.status_code == 200, res.text

    body = res.json()
    assert body["status"] == "open"
    assert body["ticket_id"]

    # Exactly one ticket inserted, with user_id NULL.
    tickets = install_db.inserts.get("support_tickets", [])
    assert len(tickets) == 1
    assert tickets[0]["user_id"] is None
    assert tickets[0]["email"] == VALID_PAYLOAD["email"]

    # SES called twice: staff notification + applicant ack.
    assert ses_mock.send_email.call_count == 2

    # Delivery status stamped 'sent' on the ticket row.
    updates = install_db.updates.get("support_tickets", [])
    assert any(u["patch"].get("email_delivery_status") == "sent" for u in updates)


def test_create_ticket_authed(client, install_db, ses_mock, authed_user):
    res = client.post(
        "/support/ticket",
        json=VALID_PAYLOAD,
        headers={"Authorization": "Bearer token-xyz"},
    )
    assert res.status_code == 200, res.text

    tickets = install_db.inserts.get("support_tickets", [])
    assert len(tickets) == 1
    assert tickets[0]["user_id"] == authed_user["user_id"]

    # Audit log captured the action
    audit = install_db.inserts.get("audit_logs", [])
    assert any(row["action"] == "support.ticket_created" for row in audit)


def test_email_failure_does_not_rollback_ticket(client, install_db, ses_failing):
    res = client.post("/support/ticket", json=VALID_PAYLOAD)
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "open"

    # Row still inserted
    tickets = install_db.inserts.get("support_tickets", [])
    assert len(tickets) == 1

    # Delivery status marked failed
    updates = install_db.updates.get("support_tickets", [])
    assert any(u["patch"].get("email_delivery_status") == "failed" for u in updates)


def test_rate_limit_anon(client, install_db, ses_mock):
    statuses = [
        client.post("/support/ticket", json=VALID_PAYLOAD).status_code for _ in range(4)
    ]
    assert statuses[:3] == [200, 200, 200], statuses
    assert statuses[3] == 429, statuses


def test_invalid_category_rejected(client, install_db, ses_mock):
    bad = {**VALID_PAYLOAD, "category": "nope"}
    res = client.post("/support/ticket", json=bad)
    assert res.status_code == 422
    # No ticket inserted
    assert install_db.inserts.get("support_tickets", []) == []


def test_body_too_short_rejected(client, install_db, ses_mock):
    bad = {**VALID_PAYLOAD, "body": "too short"}
    res = client.post("/support/ticket", json=bad)
    assert res.status_code == 422
    assert install_db.inserts.get("support_tickets", []) == []


def test_get_tickets_me_returns_own_only(client, fake_db, authed_user):
    mine = [
        {
            "id": str(uuid4()),
            "user_id": authed_user["user_id"],
            "email": authed_user["email"],
            "subject": "question about my application",
            "body": "when do interviews happen this year? Thanks in advance team.",
            "category": "application",
            "status": "open",
            "email_delivery_status": "sent",
            "created_at": "2026-04-18T10:00:00+00:00",
        },
        {
            "id": str(uuid4()),
            "user_id": authed_user["user_id"],
            "email": authed_user["email"],
            "subject": "upload bug on Safari",
            "body": "PDF upload fails silently on Safari 17 — works on Chrome without issue.",
            "category": "technical",
            "status": "open",
            "email_delivery_status": "sent",
            "created_at": "2026-04-19T09:00:00+00:00",
        },
    ]
    someone_else = [
        {
            "id": str(uuid4()),
            "user_id": str(uuid4()),
            "email": "other@example.com",
            "subject": "not yours",
            "body": "this ticket belongs to a different user and must be filtered out.",
            "category": "general",
            "status": "open",
            "email_delivery_status": "sent",
            "created_at": "2026-04-17T08:00:00+00:00",
        }
    ]
    fake_db.seed("support_tickets", mine + someone_else)

    with patch("app.routers.support.get_admin_client", return_value=fake_db):
        res = client.get(
            "/support/tickets/me",
            headers={"Authorization": "Bearer token-xyz"},
        )

    assert res.status_code == 200, res.text
    data = res.json()
    assert data["total"] == 2
    returned_ids = {t["id"] for t in data["tickets"]}
    assert returned_ids == {m["id"] for m in mine}


def test_get_tickets_me_requires_auth(client):
    res = client.get("/support/tickets/me")
    assert res.status_code == 401
