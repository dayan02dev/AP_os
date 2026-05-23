"""Tests for POST /sip-application-templates/upload.

Auth strategy: mirrors test_resume.py — build a minimal isolated FastAPI
app with only the sip_application_templates router, override
get_current_user via dependency_overrides, and monkeypatch get_admin_client
on the router module.

Track enforcement: require_track is a no-op in staging (see deps.py). For
the 403 test we monkeypatch require_track on the router module so the dep
actually enforces the SIP-only gate. All other tests use the no-op via the
normal app mount.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI, HTTPException, status
from fastapi.testclient import TestClient
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.deps import get_current_user
from app.utils.rate_limit import limiter

FIXTURE_DIR = Path(__file__).parent / "fixtures"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
SIP_QIDS = ["Q5", "Q6", "Q8", "Q9", "Q10", "Q11", "Q12", "Q13", "Q14",
            "Q15", "Q16", "Q17", "Q18", "Q19", "Q20", "Q21", "Q24"]

SIP_USER_ID = "00000000-0000-0000-0000-000000000002"
TIR_USER_ID = "00000000-0000-0000-0000-000000000003"


# ── Fake Supabase ────────────────────────────────────────────────────────

class _Result:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, store, table_name):
        self._store = store
        self._table = table_name
        self._filters: list = []
        self._op = "select"
        self._pending_write = None

    def select(self, *_a, **_kw):
        self._op = "select"
        return self

    def insert(self, payload):
        self._op = "insert"
        self._pending_write = payload
        return self

    def update(self, payload):
        self._op = "update"
        self._pending_write = payload
        return self

    def eq(self, col, val):
        self._filters.append((col, val))
        return self

    def order(self, *_a, **_kw):
        return self

    def limit(self, *_a):
        return self

    def execute(self):
        if self._op == "insert":
            row = dict(self._pending_write or {})
            # Must be a valid UUID so Pydantic's UUID field doesn't reject it.
            row.setdefault("id", "00000000-0000-0000-0000-000000000099")
            self._store.inserts.setdefault(self._table, []).append(row)
            return _Result([row])
        if self._op == "update":
            self._store.updates.setdefault(self._table, []).append(
                {"filters": list(self._filters), "payload": self._pending_write}
            )
            return _Result([])
        # select — return rows from store filtered by eq clauses
        rows = list(self._store.tables.get(self._table, []))
        for col, val in self._filters:
            rows = [r for r in rows if r.get(col) == val]
        return _Result(rows)


class _FakeStorageBucket:
    def __init__(self, store):
        self._store = store

    def upload(self, path, file, file_options=None):
        self._store.uploads.append({"path": path, "size": len(file)})
        return {"path": path}


class _FakeStorage:
    def __init__(self, store):
        self._store = store

    def from_(self, bucket):
        return _FakeStorageBucket(self._store)


class FakeStore:
    def __init__(self):
        self.tables: dict[str, list[dict[str, Any]]] = {}
        self.inserts: dict[str, list[dict[str, Any]]] = {}
        self.updates: dict[str, list[dict[str, Any]]] = {}
        self.uploads: list[dict[str, Any]] = []
        self.storage = _FakeStorage(self)

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(self, name)

    def auth(self):  # noqa: D401
        return self


# ── Fixtures ──────────────────────────────────────────────────────────────

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


@pytest.fixture
def fake_store(monkeypatch):
    import app.routers.sip_application_templates as sip_tmpl
    store = FakeStore()
    monkeypatch.setattr(sip_tmpl, "get_admin_client", lambda: store)
    return store


@pytest.fixture
def sip_client(fake_store):
    app = _make_app(SIP_USER_ID, track="sip")
    return TestClient(app, raise_server_exceptions=False)


@pytest.fixture
def tir_client(fake_store):
    app = _make_app(TIR_USER_ID, track="tir")
    return TestClient(app, raise_server_exceptions=False)


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ── Tests ─────────────────────────────────────────────────────────────────

def test_upload_rejects_unauthenticated() -> None:
    """No bearer token → 401 before even checking the file."""
    from app.routers import sip_application_templates as sip_tmpl
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    a = FastAPI()
    a.state.limiter = limiter
    a.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    a.add_middleware(SlowAPIMiddleware)
    a.include_router(sip_tmpl.router)
    limiter.reset()

    c = TestClient(a, raise_server_exceptions=False)
    resp = c.post("/sip-application-templates/upload", files={
        "file": ("sip.docx", b"x", DOCX_MIME),
    })
    assert resp.status_code == 401


def test_upload_rejects_wrong_mime(sip_client) -> None:
    resp = sip_client.post(
        "/sip-application-templates/upload",
        files={"file": ("foo.txt", b"hello", "text/plain")},
    )
    assert resp.status_code == 415


def test_upload_rejects_oversize(sip_client) -> None:
    big = b"x" * (10 * 1024 * 1024 + 1)
    resp = sip_client.post(
        "/sip-application-templates/upload",
        files={"file": ("big.docx", big, DOCX_MIME)},
    )
    assert resp.status_code == 413


def test_upload_rejects_empty(sip_client) -> None:
    resp = sip_client.post(
        "/sip-application-templates/upload",
        files={"file": ("empty.docx", b"", DOCX_MIME)},
    )
    assert resp.status_code == 400


def test_upload_happy_path(sip_client, monkeypatch) -> None:
    file_bytes = (FIXTURE_DIR / "sip_template_anchored_complete.docx").read_bytes()

    fake_parse = {qid: f"answer-{qid}" for qid in SIP_QIDS}

    import app.routers.sip_application_templates as sip_tmpl
    monkeypatch.setattr(sip_tmpl, "parse_sip_template", AsyncMock(return_value=fake_parse))

    resp = sip_client.post(
        "/sip-application-templates/upload",
        files={"file": ("sip.docx", file_bytes, DOCX_MIME)},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["parse_status"] == "completed"
    assert body["parsed_data"]["Q5"] == "answer-Q5"
    assert body["original_filename"] == "sip.docx"


def test_upload_requires_sip_track(monkeypatch) -> None:
    """A TIR-track user is rejected 403 when the track gate is enforced.

    require_track is a no-op in staging (see deps.py). We test enforcement
    by building a fresh app that uses a strict version of require_track via
    dependency_overrides rather than relying on the no-op dep.
    """
    from fastapi import Depends, HTTPException, APIRouter, status as http_status
    from fastapi.testclient import TestClient

    # Build a strict enforcing gate as a dependency override.
    async def _strict_sip_gate(current_user: dict = Depends(get_current_user)) -> None:
        if current_user.get("track") != "sip":
            raise HTTPException(status_code=403, detail="Wrong track.")

    import app.routers.sip_application_templates as sip_tmpl

    # The router's router-level dep is require_track("sip").__closure__ dep.
    # We override it by replacing it in dependency_overrides on the app.
    # To do so we need the actual dep callable that was captured at router
    # creation time. It is the inner `_dep` returned by require_track("sip").
    # Because FastAPI stores it as a Depends(...) on the router we can look
    # it up from the router's dependencies list.
    router_dep_callable = sip_tmpl.router.dependencies[0].dependency

    store = FakeStore()
    monkeypatch.setattr(sip_tmpl, "get_admin_client", lambda: store)

    a = FastAPI()
    a.state.limiter = limiter
    a.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    a.add_middleware(SlowAPIMiddleware)
    a.include_router(sip_tmpl.router)
    # Override the no-op dep with the strict gate, and inject a TIR user.
    a.dependency_overrides[router_dep_callable] = _strict_sip_gate
    a.dependency_overrides[get_current_user] = lambda: {
        "user_id": TIR_USER_ID,
        "email": "tir@example.com",
        "track": "tir",
    }
    limiter.reset()

    file_bytes = (FIXTURE_DIR / "sip_template_anchored_complete.docx").read_bytes()
    c = TestClient(a, raise_server_exceptions=False)
    resp = c.post(
        "/sip-application-templates/upload",
        files={"file": ("sip.docx", file_bytes, DOCX_MIME)},
    )
    assert resp.status_code == 403


def test_upload_persists_failed_on_parser_error(sip_client, monkeypatch) -> None:
    from app.services.template_parser import TemplateParseError
    import app.routers.sip_application_templates as sip_tmpl

    file_bytes = (FIXTURE_DIR / "sip_template_anchored_complete.docx").read_bytes()

    async def boom(*args, **kwargs):
        raise TemplateParseError("empty_document", "test")

    monkeypatch.setattr(sip_tmpl, "parse_sip_template", boom)

    resp = sip_client.post(
        "/sip-application-templates/upload",
        files={"file": ("sip.docx", file_bytes, DOCX_MIME)},
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["parse_status"] == "failed"
    assert "empty_document" in (body["message"] or "")
