"""/admin/platform/jury/invites router tests (Task 2 — admin bulk invite only).

Email delivery is mocked at the httpx.Client.post level inside
app.services.email_service. Supabase admin client is replaced with an
in-memory fake that records inserts/updates and serves pre-seeded rows for
selects. Auth is injected via FastAPI's app.dependency_overrides.

Fixture scaffolding copied verbatim from tests/test_mentors.py (fake
Supabase client, ses_mock) — only the capability + patch target differ
(manage_jury_roster / app.routers.jury_invites.get_admin_client).

The public GET/POST /jury/respond/{token} endpoints are Task 3 — not
tested here.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch
from uuid import uuid4

import httpx
import pytest


# ─── In-memory Supabase fake ─────────────────────────────────────────────


class _FakeQuery:
    """Chainable query builder matching the supabase-py interface used by jury_invites.py."""

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
    with patch("app.routers.jury_invites.get_admin_client", return_value=fake_db):
        yield fake_db


def _ok_resend_response() -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = 200
    resp.json.return_value = {"id": "resend-jury-001"}
    resp.text = '{"id":"resend-jury-001"}'
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
    """Authenticate as an admin so require_capability('manage_jury_roster') passes.

    NOTE: `require_capability(cap)` builds a fresh closure on every call, so
    overriding a locally-constructed `require_capability("manage_jury_roster")`
    object (as done for `manage_users` in test_mentors.py) never matches the
    object FastAPI actually resolves at the route — that fixture is never
    exercised against a capability-gated route there, so the mismatch stays
    latent. Overriding the singleton `get_current_user` dependency instead
    (the established, working pattern — see test_admin_users.py) exercises
    the real `has_capability` check with an admin role.
    """
    from app.deps import get_current_user
    from app.main import app

    async def _override():
        return {"user_id": "admin-uid", "email": "admin@artpark.in", "roles": ["admin"]}

    app.dependency_overrides[get_current_user] = _override
    yield
    app.dependency_overrides.pop(get_current_user, None)


# ─── Tests ───────────────────────────────────────────────────────────────


class TestCreateJuryInvites:
    def test_requires_capability(self, client, install_db):
        res = client.post(
            "/admin/platform/jury/invites",
            json={"invites": [{"name": "A", "email": "a@x.com"}]},
        )
        assert res.status_code in (401, 403)

    def test_creates_invite_and_sends_email(self, client, install_db, ses_mock, admin_user):
        res = client.post(
            "/admin/platform/jury/invites",
            json={"invites": [{"name": "Dr. Rao", "email": "Rao@X.com"}]},
        )
        assert res.status_code == 200, res.text
        r = res.json()["results"][0]
        assert r["status"] == "invited" and r["email"] == "rao@x.com"
        assert "/jury/respond/" in r["form_url"]
        row = install_db.inserts["jury_invites"][0]
        assert row["email"] == "rao@x.com" and len(row["token"]) >= 24
        assert ses_mock.called
        sent = ses_mock.call_args.kwargs.get("json") or ses_mock.call_args[1]["json"]
        assert "jury" in sent["subject"].lower() or "Jury" in sent["subject"]

    def test_dedupe_returns_same_link(self, client, install_db, ses_mock, admin_user):
        install_db.seed(
            "jury_invites",
            [{"id": "i1", "name": "B", "email": "b@x.com", "token": "tokB", "status": "invited"}],
        )
        res = client.post(
            "/admin/platform/jury/invites",
            json={"invites": [{"name": "B", "email": "B@x.com"}]},
        )
        r = res.json()["results"][0]
        assert r["status"] == "already_invited" and r["form_url"].endswith("/jury/respond/tokB")

    def test_email_failure_keeps_insert(self, client, install_db, admin_user, ses_mock):
        ses_mock.side_effect = RuntimeError("boom")
        res = client.post(
            "/admin/platform/jury/invites",
            json={"invites": [{"name": "C", "email": "c@x.com"}]},
        )
        assert res.json()["results"][0]["status"] == "invited"  # best-effort email
        assert install_db.inserts["jury_invites"]
