"""Phase 5 — /resume/* tests.

Builds a minimal FastAPI app that mounts *only* the resume router, isolated
from sibling routers owned by other parallel sessions. Supabase and
OpenRouter are mocked.
"""

from typing import Any

import pytest
from app.deps import get_current_user
from app.routers import resume as resume_router
from app.utils.rate_limit import limiter
from fastapi import FastAPI
from fastapi.testclient import TestClient
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

TEST_USER_ID = "00000000-0000-0000-0000-000000000001"
TEST_USER_EMAIL = "applicant@example.com"


class FakeQuery:
    def __init__(self, store, table_name):
        self._store = store
        self._table = table_name
        self._filters = []
        self._order = None
        self._limit = None
        self._pending_write = None
        self._op = "select"

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
        self._filters.append((col, "eq", val))
        return self

    def order(self, col, desc=False):
        self._order = (col, desc)
        return self

    def limit(self, n):
        self._limit = n
        return self

    def execute(self):
        if self._op == "insert":
            self._store.inserts.setdefault(self._table, []).append(self._pending_write)
            row = dict(self._pending_write or {})
            row.setdefault("id", f"mock-{self._table}-id")
            return _Result([row])
        if self._op == "update":
            self._store.updates.setdefault(self._table, []).append(
                {"filters": list(self._filters), "payload": self._pending_write}
            )
            return _Result([])
        rows = list(self._store.tables.get(self._table, []))
        for col, _op, val in self._filters:
            rows = [r for r in rows if r.get(col) == val]
        if self._order:
            rows.sort(key=lambda r: r.get(self._order[0]) or "", reverse=self._order[1])
        if self._limit is not None:
            rows = rows[: self._limit]
        return _Result(rows)


class _Result:
    def __init__(self, data):
        self.data = data


class FakeStorageBucket:
    def __init__(self, store):
        self._store = store

    def upload(self, path, file, file_options=None):
        self._store.uploads.append({"path": path, "size": len(file), "options": file_options})
        return {"path": path}


class FakeStorage:
    def __init__(self, store):
        self._store = store

    def from_(self, bucket):
        assert bucket == "resumes"
        return FakeStorageBucket(self._store)


class FakeStore:
    def __init__(self):
        self.tables: dict[str, list[dict[str, Any]]] = {}
        self.inserts: dict[str, list[dict[str, Any]]] = {}
        self.updates: dict[str, list[dict[str, Any]]] = {}
        self.uploads: list[dict[str, Any]] = []
        self.storage = FakeStorage(self)

    def table(self, name):
        return FakeQuery(self, name)


@pytest.fixture
def app():
    a = FastAPI()
    a.state.limiter = limiter
    a.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    a.add_middleware(SlowAPIMiddleware)
    a.include_router(resume_router.router)
    a.dependency_overrides[get_current_user] = lambda: {
        "user_id": TEST_USER_ID,
        "email": TEST_USER_EMAIL,
    }
    limiter.reset()
    return a


@pytest.fixture
def fake_supabase(monkeypatch):
    store = FakeStore()
    monkeypatch.setattr("app.routers.resume.get_admin_client", lambda: store)
    return store


@pytest.fixture
def client(app):
    return TestClient(app)


SAMPLE_PARSED = {
    "full_name": "Ada Lovelace",
    "email": "ada@example.com",
    "phone": "+91-9876543210",
    "linkedin_url": "https://linkedin.com/in/ada",
    "location": "Bengaluru",
    "education": [{"institution": "X University", "degree": "B.Sc."}],
    "work_experience": [{"company": "A Corp", "title": "Engineer"}],
    "skills": ["python", "fastapi"],
    "ventures": [],
    "summary": "Experienced engineer.",
}


def test_upload_rejects_txt_file(client, fake_supabase):
    r = client.post(
        "/resume/upload",
        files={"file": ("resume.txt", b"hello world", "text/plain")},
    )
    assert r.status_code == 415, r.text
    assert "Unsupported file type" in r.json()["detail"]
    assert fake_supabase.uploads == []


def test_upload_rejects_oversized_file(client, fake_supabase):
    big = b"\x00" * (10 * 1024 * 1024 + 1)
    r = client.post(
        "/resume/upload",
        files={"file": ("big.pdf", big, "application/pdf")},
    )
    assert r.status_code == 413, r.text
    assert fake_supabase.uploads == []


def test_upload_success_with_mocked_openrouter(client, fake_supabase, monkeypatch):
    monkeypatch.setattr("app.routers.resume.extract_text", lambda b, m: "Ada Lovelace resume text")

    async def fake_parse(self, raw_text, *, user_id=None):
        return SAMPLE_PARSED

    monkeypatch.setattr("app.routers.resume.OpenRouterClient.parse_resume", fake_parse)

    r = client.post(
        "/resume/upload",
        files={"file": ("ada.pdf", b"%PDF-1.4 fake", "application/pdf")},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["parse_status"] == "completed"
    assert body["parsed_data"]["full_name"] == "Ada Lovelace"
    assert body["original_filename"] == "ada.pdf"

    assert len(fake_supabase.uploads) == 1
    assert fake_supabase.uploads[0]["path"].startswith(f"{TEST_USER_ID}/")
    assert fake_supabase.uploads[0]["path"].endswith(".pdf")

    inserts = fake_supabase.inserts.get("resume_uploads", [])
    assert len(inserts) == 1
    assert inserts[0]["parse_status"] == "pending"

    updates = fake_supabase.updates.get("resume_uploads", [])
    statuses = [u["payload"].get("parse_status") for u in updates]
    assert "processing" in statuses
    assert "completed" in statuses


def test_parse_failure_path(client, fake_supabase, monkeypatch):
    from app.services.llm_service import LLMParseError

    monkeypatch.setattr("app.routers.resume.extract_text", lambda b, m: "some text")

    async def fake_parse_fail(self, raw_text, *, user_id=None):
        raise LLMParseError("upstream 500")

    monkeypatch.setattr("app.routers.resume.OpenRouterClient.parse_resume", fake_parse_fail)

    r = client.post(
        "/resume/upload",
        files={"file": ("x.pdf", b"%PDF-1.4 fake", "application/pdf")},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["parse_status"] == "failed"
    assert "upstream 500" in (body.get("message") or "")


def test_apply_to_application_fills_nulls_only(client, fake_supabase):
    fake_supabase.tables["resume_uploads"] = [
        {
            "id": "r1",
            "user_id": TEST_USER_ID,
            "parse_status": "completed",
            "parsed_data": SAMPLE_PARSED,
            "created_at": "2026-04-19T00:00:00Z",
        }
    ]
    fake_supabase.tables["profiles"] = [
        {
            "id": TEST_USER_ID,
            "email": TEST_USER_EMAIL,
            "full_name": "Existing Name",
            "phone": None,
            "linkedin_url": None,
            "location_city": None,
        }
    ]
    fake_supabase.tables["applications"] = [
        {
            "id": "app-1",
            "user_id": TEST_USER_ID,
            "status": "draft",
            "basic_full_name": "Existing Name",
            "basic_phone": None,
            "basic_email": None,
        }
    ]

    r = client.post("/resume/me/apply-to-application")
    assert r.status_code == 200, r.text
    body = r.json()

    assert "profiles.full_name" not in body["applied_fields"]
    assert "profiles.full_name" in body["skipped_fields"]
    assert "applications.basic_full_name" in body["skipped_fields"]
    assert "profiles.phone" in body["applied_fields"]
    assert "profiles.linkedin_url" in body["applied_fields"]
    assert "profiles.location_city" in body["applied_fields"]
    assert "applications.basic_phone" in body["applied_fields"]
    assert "applications.basic_email" in body["applied_fields"]

    profile_patch = fake_supabase.updates.get("profiles", [])[0]["payload"]
    assert "full_name" not in profile_patch
    assert profile_patch["phone"] == SAMPLE_PARSED["phone"]
    assert profile_patch["location_city"] == SAMPLE_PARSED["location"]

    app_patch = fake_supabase.updates.get("applications", [])[0]["payload"]
    assert "basic_full_name" not in app_patch
    assert app_patch["basic_phone"] == SAMPLE_PARSED["phone"]
    assert app_patch["basic_email"] == SAMPLE_PARSED["email"]


def test_apply_to_application_404_when_no_parse(client, fake_supabase):
    fake_supabase.tables["resume_uploads"] = []
    r = client.post("/resume/me/apply-to-application")
    assert r.status_code == 404


def test_get_my_latest_resume(client, fake_supabase):
    fake_supabase.tables["resume_uploads"] = [
        {
            "id": "r-old",
            "user_id": TEST_USER_ID,
            "storage_path": f"{TEST_USER_ID}/old.pdf",
            "original_filename": "old.pdf",
            "file_size_bytes": 100,
            "mime_type": "application/pdf",
            "parse_status": "completed",
            "created_at": "2026-04-01T00:00:00Z",
        },
        {
            "id": "r-new",
            "user_id": TEST_USER_ID,
            "storage_path": f"{TEST_USER_ID}/new.pdf",
            "original_filename": "new.pdf",
            "file_size_bytes": 200,
            "mime_type": "application/pdf",
            "parse_status": "completed",
            "created_at": "2026-04-10T00:00:00Z",
        },
    ]
    r = client.get("/resume/me")
    assert r.status_code == 200, r.text
    assert r.json()["id"] == "r-new"


def test_get_resume_by_id_forbids_other_user(client, fake_supabase):
    fake_supabase.tables["resume_uploads"] = [
        {
            "id": "r-other",
            "user_id": "00000000-0000-0000-0000-000000000099",
            "storage_path": "other/x.pdf",
            "original_filename": "x.pdf",
            "file_size_bytes": 100,
            "mime_type": "application/pdf",
            "parse_status": "completed",
            "created_at": "2026-04-10T00:00:00Z",
        }
    ]
    r = client.get("/resume/r-other")
    assert r.status_code == 403


def test_apply_to_application_links_resume_file_id(client, fake_supabase):
    """Task 7: apply-to-application must populate applications.resume_file_id
    on the open draft, so that the submit-time mandatory check (migration 019
    + _MANDATORY_FIELDS) is satisfied automatically by the upload flow."""
    fake_supabase.tables["tir_resume_uploads"] = [
        {
            "id": "resume-xyz",
            "user_id": TEST_USER_ID,
            "parse_status": "completed",
            "parsed_data": SAMPLE_PARSED,
            "created_at": "2026-05-19T00:00:00Z",
        }
    ]
    fake_supabase.tables["profiles"] = [
        {
            "id": TEST_USER_ID,
            "email": TEST_USER_EMAIL,
            "full_name": None,
            "phone": None,
            "linkedin_url": None,
            "location_city": None,
        }
    ]
    fake_supabase.tables["tir_applications"] = [
        {
            "id": "app-draft-1",
            "user_id": TEST_USER_ID,
            "status": "draft",
            "basic_full_name": None,
            "basic_phone": None,
            "basic_email": None,
            "resume_file_id": None,
            "created_at": "2026-05-18T00:00:00Z",
        }
    ]

    r = client.post("/resume/me/apply-to-application")
    assert r.status_code == 200, r.text
    body = r.json()

    assert "applications.resume_file_id" in body["applied_fields"]

    # The patch on tir_applications must include resume_file_id = the row id.
    app_updates = fake_supabase.updates.get("tir_applications", [])
    assert app_updates, "no patch was sent to tir_applications"
    patch = app_updates[-1]["payload"]
    assert patch.get("resume_file_id") == "resume-xyz"


def test_apply_to_application_skips_resume_file_id_when_already_linked(
    client, fake_supabase
):
    """If the draft already points at the latest CV, don't re-write the link."""
    fake_supabase.tables["tir_resume_uploads"] = [
        {
            "id": "resume-xyz",
            "user_id": TEST_USER_ID,
            "parse_status": "completed",
            "parsed_data": SAMPLE_PARSED,
            "created_at": "2026-05-19T00:00:00Z",
        }
    ]
    fake_supabase.tables["profiles"] = [
        {
            "id": TEST_USER_ID,
            "email": TEST_USER_EMAIL,
            "full_name": "Ada",
            "phone": "+91-1",
            "linkedin_url": "https://linkedin.com/in/ada",
            "location_city": "Bengaluru",
        }
    ]
    fake_supabase.tables["tir_applications"] = [
        {
            "id": "app-draft-1",
            "user_id": TEST_USER_ID,
            "status": "draft",
            "basic_full_name": "Ada",
            "basic_phone": "+91-1",
            "basic_email": "ada@example.com",
            "resume_file_id": "resume-xyz",
            "created_at": "2026-05-18T00:00:00Z",
        }
    ]

    r = client.post("/resume/me/apply-to-application")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "applications.resume_file_id" not in body["applied_fields"]
