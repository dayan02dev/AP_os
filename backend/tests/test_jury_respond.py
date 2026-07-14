"""Public /jury/respond/{token} endpoint tests (Task 3).

  GET  /jury/respond/{token}   Token -> form view (name/email/status).
  POST /jury/respond/{token}   Accept/decline. Accept auto-creates a jury
                               account (or grants the role to an existing
                               user), upserts jury_profiles, fires the
                               jury_enrich SQS job, and sends a best-effort
                               email. Decline only updates invite status.

Fixture scaffolding copied from tests/test_jury_invites.py (Task 2) — the
local in-memory Supabase fake — extended with `upsert()` support (needed for
the profiles/jury_profiles upserts) and a fake `client.auth.admin` namespace
(needed for account auto-creation).
"""

from __future__ import annotations

from types import SimpleNamespace
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

        if self._op == "upsert":
            # Recorded alongside inserts (tests assert via `.inserts[name]`) —
            # the fake never needs to merge against existing rows because no
            # test in this file reads a jury_profiles/profiles row back
            # through the fake after an upsert.
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

    def upsert(self, payload, on_conflict=None, ignore_duplicates=False):  # noqa: ARG002
        return _FakeQuery(self, "upsert", payload)

    def select(self, *_a, **_kw):
        return _FakeQuery(self, "select")


class _FakeAuthAdmin:
    """Stand-in for `client.auth.admin` — records create_user() payloads."""

    def __init__(self):
        self.created: list[dict] = []
        self.resets: list[tuple[str, dict]] = []
        self.admin = self

    def create_user(self, payload):
        self.created.append(payload)
        return SimpleNamespace(user=SimpleNamespace(id="new-juror-uuid"))

    def update_user_by_id(self, user_id, payload):
        self.resets.append((user_id, payload))
        return SimpleNamespace(user=SimpleNamespace(id=user_id))


class FakeSupabaseClient:
    def __init__(self):
        self.inserts: dict[str, list[dict]] = {}
        self.updates: dict[str, list[dict]] = {}
        self.rows: dict[str, list[dict]] = {}
        self.auth = _FakeAuthAdmin()

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
    resp.json.return_value = {"id": "resend-jury-002"}
    resp.text = '{"id":"resend-jury-002"}'
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


def _seed_invite(
    install_db: FakeSupabaseClient,
    *,
    token: str,
    name: str = "Dr. Rao",
    email: str = "rao@x.com",
    status: str = "invited",
    invite_id: str | None = None,
) -> dict:
    row = {
        "id": invite_id or f"inv-{token}",
        "name": name,
        "email": email,
        "token": token,
        "status": status,
        "invited_by": "admin-uid",
        "linkedin_url": None,
        "expertise_domains": [],
        "responded_at": None,
    }
    existing = install_db.rows.setdefault("jury_invites", [])
    existing.append(row)
    return row


# ─── Tests ───────────────────────────────────────────────────────────────


class TestGetJuryForm:
    def test_get_unknown_token_404(self, client, install_db):
        res = client.get("/jury/respond/nope")
        assert res.status_code == 404

    def test_get_returns_form_view(self, client, install_db):
        _seed_invite(install_db, token="t1", name="Dr. Rao", email="rao@x.com")
        res = client.get("/jury/respond/t1")
        assert res.status_code == 200
        assert res.json() == {"name": "Dr. Rao", "email": "rao@x.com", "status": "invited"}


class TestSubmitJuryResponse:
    def test_decline_sets_status_only(self, client, install_db, ses_mock):
        _seed_invite(install_db, token="t2")
        res = client.post("/jury/respond/t2", json={"accept": False})
        assert res.status_code == 200
        assert res.json()["status"] == "ok"
        assert any(
            u["patch"].get("status") == "declined"
            for u in install_db.updates["jury_invites"]
        )
        assert not install_db.auth.created  # no account on decline

    def test_accept_creates_account_role_profile_and_emails(
        self, client, install_db, ses_mock, monkeypatch,
    ):
        published = []
        monkeypatch.setattr(
            "app.routers.jury_invites.publish_jury_job",
            lambda job, uid: published.append((job, uid)) or True,
        )
        _seed_invite(install_db, token="t3", email="new@x.com")
        res = client.post(
            "/jury/respond/t3",
            json={
                "accept": True,
                "expertise_domains": ["Robotics"],
                "linkedin_url": "https://linkedin.com/in/x",
            },
        )
        assert res.status_code == 200, res.text
        assert res.json()["status"] == "ok"
        assert install_db.auth.created[0]["email"] == "new@x.com"
        assert {"user_id": "new-juror-uuid", "role": "jury"}.items() <= (
            install_db.inserts["user_roles"][0].items()
        )
        prof = install_db.inserts["jury_profiles"][0]
        assert prof["juror_user_id"] == "new-juror-uuid"
        assert prof["enrichment_status"] == "pending"
        assert ("jury_enrich", "new-juror-uuid") in published
        assert ses_mock.called  # credentials email

    def test_accept_existing_user_resets_password_and_emails_credentials(
        self, client, install_db, ses_mock, monkeypatch,
    ):
        # An existing account must ALSO receive working credentials on accept —
        # the juror has no other way to learn their login. So the password is
        # reset and the credentials email (id + password) is sent.
        monkeypatch.setattr("app.routers.jury_invites.publish_jury_job", lambda *a: True)
        install_db.seed(
            "profiles", [{"id": "u-exist", "email": "old@x.com", "full_name": "Old"}],
        )
        _seed_invite(install_db, token="t4", email="old@x.com")
        res = client.post("/jury/respond/t4", json={"accept": True})
        assert res.status_code == 200, res.text
        assert not install_db.auth.created                    # no NEW account
        assert install_db.auth.resets                          # password WAS reset
        assert install_db.auth.resets[0][0] == "u-exist"
        assert "password" in install_db.auth.resets[0][1]
        assert any(r["role"] == "jury" for r in install_db.inserts["user_roles"])
        assert ses_mock.called                                 # credentials email sent

    def test_repeat_accept_no_password_churn_no_reemail(
        self, client, install_db, ses_mock, monkeypatch,
    ):
        # Already-accepted invite: a repeat POST must not reset the password or
        # re-send credentials (the juror may already be signed in).
        monkeypatch.setattr("app.routers.jury_invites.publish_jury_job", lambda *a: True)
        install_db.seed(
            "profiles", [{"id": "u-r", "email": "r@x.com", "full_name": "R"}],
        )
        _seed_invite(install_db, token="t5", email="r@x.com", status="accepted")
        res = client.post("/jury/respond/t5", json={"accept": True})
        assert res.status_code == 200
        assert res.json()["status"] == "ok"
        assert not install_db.auth.resets      # no password churn on retry
        assert not ses_mock.called             # no duplicate credentials email

    def test_accept_after_decline_is_noop_ok(self, client, install_db, ses_mock):
        _seed_invite(install_db, token="t6", status="declined")
        res = client.post("/jury/respond/t6", json={"accept": True})
        assert res.status_code == 200
        assert res.json()["status"] == "already_responded"
        assert not install_db.auth.created

    def test_decline_after_accept_is_noop_ok(self, client, install_db, ses_mock):
        _seed_invite(install_db, token="t7", status="accepted")
        res = client.post("/jury/respond/t7", json={"accept": False})
        assert res.status_code == 200
        assert res.json()["status"] == "already_responded"

    def test_post_unknown_token_404(self, client, install_db):
        res = client.post("/jury/respond/nope", json={"accept": False})
        assert res.status_code == 404
