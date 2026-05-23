"""Tests for GET /sip-application-templates/me.

Uses the same per-test FastAPI app + Supabase fake-client pattern as
test_sip_application_templates_upload.py. The handler already exists
at commit ad01cdd; these tests only add coverage.

Auth strategy: build a minimal isolated FastAPI app with only the SIP
templates router, override get_current_user via dependency_overrides,
and monkeypatch get_admin_client on the router module.

Track enforcement: require_track is a no-op in staging (see deps.py).
For the 403 test we override the router-level dep with a strict gate,
same technique as the upload 403 test.
"""

from __future__ import annotations

import datetime
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.deps import get_current_user
from app.utils.rate_limit import limiter

SIP_USER_ID = "00000000-0000-0000-0000-000000000002"
TIR_USER_ID = "00000000-0000-0000-0000-000000000003"

DRAFT_ID = "aaaaaaaa-0000-0000-0000-000000000001"
TMPL_ID_OLD = "bbbbbbbb-0000-0000-0000-000000000001"
TMPL_ID_NEW = "bbbbbbbb-0000-0000-0000-000000000002"


# ── Fake Supabase ─────────────────────────────────────────────────────────

class _Result:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, store, table_name):
        self._store = store
        self._table = table_name
        self._filters: list = []

    def select(self, *_a, **_kw):
        return self

    def insert(self, payload):
        return self

    def update(self, payload):
        return self

    def eq(self, col, val):
        self._filters.append((col, val))
        return self

    def order(self, *_a, **_kw):
        return self

    def limit(self, *_a):
        return self

    def execute(self):
        rows = list(self._store.tables.get(self._table, []))
        for col, val in self._filters:
            rows = [r for r in rows if r.get(col) == val]
        return _Result(rows)


class FakeStore:
    def __init__(self):
        self.tables: dict[str, list[dict[str, Any]]] = {}

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(self, name)


def _make_app(user_id: str, track: str | None = "sip") -> FastAPI:
    """Build a minimal app mounting only the SIP templates router."""
    from app.routers import sip_application_templates as sip_tmpl

    a = FastAPI()
    a.state.limiter = limiter
    a.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    a.add_middleware(SlowAPIMiddleware)
    a.include_router(sip_tmpl.router)
    a.dependency_overrides[get_current_user] = lambda: {
        "user_id": user_id,
        "email": "test@example.com",
        "track": track,
    }
    limiter.reset()
    return a


# ── Tests ─────────────────────────────────────────────────────────────────

def test_get_me_unauthenticated() -> None:
    """No bearer token → 401 before the handler runs."""
    from app.routers import sip_application_templates as sip_tmpl

    a = FastAPI()
    a.state.limiter = limiter
    a.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    a.add_middleware(SlowAPIMiddleware)
    a.include_router(sip_tmpl.router)
    limiter.reset()

    c = TestClient(a, raise_server_exceptions=False)
    resp = c.get("/sip-application-templates/me")
    assert resp.status_code == 401


def test_get_me_no_draft_returns_404(monkeypatch) -> None:
    """When the user has no draft SIP application, GET /me returns 404."""
    import app.routers.sip_application_templates as sip_tmpl

    store = FakeStore()
    # sip_applications table is empty → _fetch_draft_application_id returns None
    store.tables["sip_applications"] = []

    monkeypatch.setattr(sip_tmpl, "get_admin_client", lambda: store)

    app = _make_app(SIP_USER_ID, track="sip")
    c = TestClient(app, raise_server_exceptions=False)
    resp = c.get("/sip-application-templates/me")
    assert resp.status_code == 404
    assert "draft" in resp.json()["detail"].lower()


def test_get_me_no_template_returns_404(monkeypatch) -> None:
    """Draft exists but no template rows uploaded yet → 404."""
    import app.routers.sip_application_templates as sip_tmpl

    store = FakeStore()
    store.tables["sip_applications"] = [
        {"id": DRAFT_ID, "user_id": SIP_USER_ID, "status": "draft"},
    ]
    # No rows in sip_application_templates
    store.tables["sip_application_templates"] = []

    monkeypatch.setattr(sip_tmpl, "get_admin_client", lambda: store)

    app = _make_app(SIP_USER_ID, track="sip")
    c = TestClient(app, raise_server_exceptions=False)
    resp = c.get("/sip-application-templates/me")
    assert resp.status_code == 404
    assert "template" in resp.json()["detail"].lower()


def test_get_me_returns_latest_by_created_at(monkeypatch) -> None:
    """Draft + two template rows → 200, handler returns the first row (desc order).

    The fake query returns rows in insertion order; we pre-sort them newest-first
    to mirror what Supabase returns after `.order('created_at', desc=True)`.
    The handler picks rows[0], which should be the newer row.
    """
    import app.routers.sip_application_templates as sip_tmpl

    store = FakeStore()
    store.tables["sip_applications"] = [
        {"id": DRAFT_ID, "user_id": SIP_USER_ID, "status": "draft"},
    ]

    older = {
        "id": TMPL_ID_OLD,
        "user_id": SIP_USER_ID,
        "application_id": DRAFT_ID,
        "created_at": "2024-01-01T00:00:00+00:00",
        "parse_status": "completed",
        "parse_error": None,
        "message": None,
        "original_filename": "sip_old.docx",
        "storage_path": f"{SIP_USER_ID}/old.docx",
        "parsed_data": {},
    }
    newer = {
        "id": TMPL_ID_NEW,
        "user_id": SIP_USER_ID,
        "application_id": DRAFT_ID,
        "created_at": "2024-06-01T00:00:00+00:00",
        "parse_status": "completed",
        "parse_error": None,
        "message": None,
        "original_filename": "sip_new.docx",
        "storage_path": f"{SIP_USER_ID}/new.docx",
        "parsed_data": {},
    }
    # Newest first, matching Supabase desc order
    store.tables["sip_application_templates"] = [newer, older]

    monkeypatch.setattr(sip_tmpl, "get_admin_client", lambda: store)

    app = _make_app(SIP_USER_ID, track="sip")
    c = TestClient(app, raise_server_exceptions=False)
    resp = c.get("/sip-application-templates/me")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["id"] == TMPL_ID_NEW
    assert body["original_filename"] == "sip_new.docx"


def test_get_me_requires_sip_track(monkeypatch) -> None:
    """A TIR-track user is rejected 403 when the track gate is enforced.

    require_track is a no-op in staging. We enforce it by overriding the
    router-level dep with a strict gate, mirroring the upload 403 test.
    """
    from fastapi import Depends, HTTPException

    import app.routers.sip_application_templates as sip_tmpl

    store = FakeStore()
    monkeypatch.setattr(sip_tmpl, "get_admin_client", lambda: store)

    async def _strict_sip_gate(current_user: dict = Depends(get_current_user)) -> None:
        if current_user.get("track") != "sip":
            raise HTTPException(status_code=403, detail="Wrong track.")

    router_dep_callable = sip_tmpl.router.dependencies[0].dependency

    a = FastAPI()
    a.state.limiter = limiter
    a.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    a.add_middleware(SlowAPIMiddleware)
    a.include_router(sip_tmpl.router)
    a.dependency_overrides[router_dep_callable] = _strict_sip_gate
    a.dependency_overrides[get_current_user] = lambda: {
        "user_id": TIR_USER_ID,
        "email": "tir@example.com",
        "track": "tir",
    }
    limiter.reset()

    c = TestClient(a, raise_server_exceptions=False)
    resp = c.get("/sip-application-templates/me")
    assert resp.status_code == 403
