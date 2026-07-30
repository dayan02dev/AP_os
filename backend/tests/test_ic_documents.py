"""Tests for the IC (Investment Committee) documents API used by the admin
"Jury VIP Selected" section.

Behaviour under test:
  1. RBAC — manage_ic_documents is admin + leadership only (jury/reviewer 403).
  2. Upload validates the payload: PDF MIME + %PDF magic bytes, non-empty,
     size cap; 404 for an unknown application.
  3. Re-upload SUPERSEDES the previous row (history kept, one current row).
  4. Signing requires an existing document (409 no_ic_document) and a signer
     name (422), and records the signer from the SESSION — never the payload.
  5. Signed-url returns 404 for the signed variant until the doc is signed.
  6. The list endpoint returns only current (non-superseded) rows and degrades
     to [] instead of 500-ing when the table read blows up.
"""

from __future__ import annotations

import pytest
from app.deps import get_current_user
from app.main import app
from fastapi.testclient import TestClient

from tests.fixtures.fake_supabase import FakeSupabase

PDF = b"%PDF-1.4 minimal test payload"
APP_ID = "11111111-1111-1111-1111-111111111111"


class _FakeStorageBucket:
    def __init__(self, log: list, fail: bool = False):
        self._log = log
        self._fail = fail

    def upload(self, path=None, file=None, file_options=None):
        if self._fail:
            raise RuntimeError("storage down")
        self._log.append({"path": path, "size": len(file or b""), "options": file_options})
        return {"path": path}

    def create_signed_url(self, path, expires_in):
        return {"signedURL": f"https://signed.example/{path}?exp={expires_in}"}


class _FakeStorage:
    def __init__(self, fail: bool = False):
        self.uploads: list = []
        self._fail = fail

    def from_(self, _bucket):
        return _FakeStorageBucket(self.uploads, self._fail)


class FakeSupabaseWithStorage(FakeSupabase):
    """FakeSupabase + the .storage surface the IC router needs."""

    def __init__(self, tables=None, storage_fail: bool = False):
        super().__init__(tables)
        self.storage = _FakeStorage(storage_fail)


@pytest.fixture
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


def _override_user(roles: list[str], user_id: str = "admin-1", email: str = "admin@artpark.in"):
    def _f():
        return {"user_id": user_id, "email": email, "roles": roles, "track": None}
    return _f


def _install(monkeypatch, tables: dict, *, storage_fail: bool = False):
    from app.routers import ic_documents as router_mod

    fake = FakeSupabaseWithStorage(tables, storage_fail=storage_fail)
    monkeypatch.setattr(router_mod, "get_admin_client", lambda: fake)
    return fake


def _tables(**extra) -> dict:
    base = {
        "sip_applications": [{"id": APP_ID, "status": "jury_review"}],
        "ic_documents": [],
        "audit_log_v2": [],
    }
    base.update(extra)
    return base


def _client() -> TestClient:
    return TestClient(app)


# ── 1. RBAC ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("roles,expected", [
    (["admin"], 200),
    (["leadership"], 200),
    (["jury"], 403),
    (["reviewer"], 403),
    ([], 403),
])
def test_list_rbac(monkeypatch, _clear_overrides, roles, expected):
    _install(monkeypatch, _tables())
    app.dependency_overrides[get_current_user] = _override_user(roles)
    r = _client().get("/admin/platform/ic-documents?track=sip")
    assert r.status_code == expected


def test_upload_requires_capability(monkeypatch, _clear_overrides):
    _install(monkeypatch, _tables())
    app.dependency_overrides[get_current_user] = _override_user(["jury"])
    r = _client().post(f"/admin/platform/ic-documents/sip/{APP_ID}",
                       files={"file": ("ic.pdf", PDF, "application/pdf")})
    assert r.status_code == 403


# ── 2. Upload validation ───────────────────────────────────────────────────

def test_upload_stores_document_and_records_row(monkeypatch, _clear_overrides):
    fake = _install(monkeypatch, _tables())
    app.dependency_overrides[get_current_user] = _override_user(["admin"])

    r = _client().post(f"/admin/platform/ic-documents/sip/{APP_ID}",
                       files={"file": ("IC minutes.pdf", PDF, "application/pdf")})
    assert r.status_code == 201, r.text
    doc = r.json()["document"]
    assert doc["file_name"] == "IC minutes.pdf"
    assert doc["size_bytes"] == len(PDF)
    assert doc["signed"] is False

    rows = fake.tables["ic_documents"]
    assert len(rows) == 1
    assert rows[0]["application_track"] == "sip"
    assert rows[0]["uploaded_by"] == "admin-1"
    # A fresh row carries no superseded_at — the column defaults to NULL.
    assert rows[0].get("superseded_at") is None
    # The object landed in storage under a per-application path.
    assert fake.storage.uploads[0]["path"].startswith(f"sip/{APP_ID}/")


def test_upload_rejects_non_pdf_mime(monkeypatch, _clear_overrides):
    _install(monkeypatch, _tables())
    app.dependency_overrides[get_current_user] = _override_user(["admin"])
    r = _client().post(f"/admin/platform/ic-documents/sip/{APP_ID}",
                       files={"file": ("ic.docx", b"PK\x03\x04zip",
                                       "application/vnd.openxmlformats-officedocument"
                                       ".wordprocessingml.document")})
    assert r.status_code == 415
    assert r.json()["detail"]["code"] == "unsupported_media"


def test_upload_rejects_pdf_mime_without_pdf_bytes(monkeypatch, _clear_overrides):
    """A renamed .docx sent with a PDF content-type must still be refused."""
    _install(monkeypatch, _tables())
    app.dependency_overrides[get_current_user] = _override_user(["admin"])
    r = _client().post(f"/admin/platform/ic-documents/sip/{APP_ID}",
                       files={"file": ("ic.pdf", b"PK\x03\x04not-a-pdf", "application/pdf")})
    assert r.status_code == 415


def test_upload_rejects_empty_file(monkeypatch, _clear_overrides):
    _install(monkeypatch, _tables())
    app.dependency_overrides[get_current_user] = _override_user(["admin"])
    r = _client().post(f"/admin/platform/ic-documents/sip/{APP_ID}",
                       files={"file": ("ic.pdf", b"", "application/pdf")})
    assert r.status_code == 400
    assert r.json()["detail"]["code"] == "empty_file"


def test_upload_rejects_oversized_file(monkeypatch, _clear_overrides):
    _install(monkeypatch, _tables())
    app.dependency_overrides[get_current_user] = _override_user(["admin"])
    big = b"%PDF-" + b"x" * (10 * 1024 * 1024 + 1)
    r = _client().post(f"/admin/platform/ic-documents/sip/{APP_ID}",
                       files={"file": ("ic.pdf", big, "application/pdf")})
    assert r.status_code == 413
    assert r.json()["detail"]["code"] == "too_large"


def test_upload_unknown_application_404(monkeypatch, _clear_overrides):
    _install(monkeypatch, _tables(sip_applications=[]))
    app.dependency_overrides[get_current_user] = _override_user(["admin"])
    r = _client().post(f"/admin/platform/ic-documents/sip/{APP_ID}",
                       files={"file": ("ic.pdf", PDF, "application/pdf")})
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "application_not_found"


def test_upload_storage_failure_is_a_json_502(monkeypatch, _clear_overrides):
    """A storage outage must surface as a JSON error (which travels inside CORS),
    never an unhandled 500 — the CORS-less-500 trap from the 07-27 fixes."""
    fake = _install(monkeypatch, _tables(), storage_fail=True)
    app.dependency_overrides[get_current_user] = _override_user(["admin"])
    r = _client().post(f"/admin/platform/ic-documents/sip/{APP_ID}",
                       files={"file": ("ic.pdf", PDF, "application/pdf")})
    assert r.status_code == 502
    assert r.json()["detail"]["code"] == "storage_upload_failed"
    assert fake.tables["ic_documents"] == []


# ── 3. Re-upload supersedes ────────────────────────────────────────────────

def test_reupload_supersedes_previous_and_keeps_one_current(monkeypatch, _clear_overrides):
    fake = _install(monkeypatch, _tables())
    app.dependency_overrides[get_current_user] = _override_user(["admin"])
    c = _client()

    c.post(f"/admin/platform/ic-documents/sip/{APP_ID}",
           files={"file": ("first.pdf", PDF, "application/pdf")})
    c.post(f"/admin/platform/ic-documents/sip/{APP_ID}",
           files={"file": ("second.pdf", PDF, "application/pdf")})

    rows = fake.tables["ic_documents"]
    assert len(rows) == 2, "history must be kept, not overwritten"
    current = [r for r in rows if r.get("superseded_at") is None]
    assert len(current) == 1
    assert current[0]["file_name"] == "second.pdf"

    listing = c.get("/admin/platform/ic-documents?track=sip").json()["documents"]
    assert [d["file_name"] for d in listing] == ["second.pdf"]


# ── 4. Signing ─────────────────────────────────────────────────────────────

def test_sign_without_document_409(monkeypatch, _clear_overrides):
    _install(monkeypatch, _tables())
    app.dependency_overrides[get_current_user] = _override_user(["admin"])
    r = _client().post(f"/admin/platform/ic-documents/sip/{APP_ID}/signature",
                       files={"file": ("s.pdf", PDF, "application/pdf")},
                       data={"signer_name": "Nirav"})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "no_ic_document"


def test_sign_requires_signer_name(monkeypatch, _clear_overrides):
    _install(monkeypatch, _tables())
    app.dependency_overrides[get_current_user] = _override_user(["admin"])
    c = _client()
    c.post(f"/admin/platform/ic-documents/sip/{APP_ID}",
           files={"file": ("ic.pdf", PDF, "application/pdf")})
    r = c.post(f"/admin/platform/ic-documents/sip/{APP_ID}/signature",
               files={"file": ("s.pdf", PDF, "application/pdf")},
               data={"signer_name": "   "})
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "signer_name_required"


def test_sign_records_session_identity_not_payload(monkeypatch, _clear_overrides):
    """signer_name is a display string; signed_by/signer_email come from the JWT."""
    fake = _install(monkeypatch, _tables())
    app.dependency_overrides[get_current_user] = _override_user(
        ["admin"], user_id="udita-uuid", email="udita@artpark.in")
    c = _client()
    c.post(f"/admin/platform/ic-documents/sip/{APP_ID}",
           files={"file": ("ic.pdf", PDF, "application/pdf")})

    r = c.post(f"/admin/platform/ic-documents/sip/{APP_ID}/signature",
               files={"file": ("ic-signed.pdf", PDF, "application/pdf")},
               data={"signer_name": "Dr. Someone Else"})
    assert r.status_code == 200, r.text
    doc = r.json()["document"]
    assert doc["signed"] is True
    assert doc["signer_name"] == "Dr. Someone Else"
    assert doc["signer_email"] == "udita@artpark.in"

    row = [r for r in fake.tables["ic_documents"] if r.get("superseded_at") is None][0]
    assert row["signed_by"] == "udita-uuid"
    assert row["signed_at"]
    assert row["signed_storage_path"].endswith("-signed.pdf")


def test_resign_overwrites_the_signed_copy(monkeypatch, _clear_overrides):
    fake = _install(monkeypatch, _tables())
    app.dependency_overrides[get_current_user] = _override_user(["admin"])
    c = _client()
    c.post(f"/admin/platform/ic-documents/sip/{APP_ID}",
           files={"file": ("ic.pdf", PDF, "application/pdf")})
    c.post(f"/admin/platform/ic-documents/sip/{APP_ID}/signature",
           files={"file": ("s.pdf", PDF, "application/pdf")}, data={"signer_name": "First"})
    c.post(f"/admin/platform/ic-documents/sip/{APP_ID}/signature",
           files={"file": ("s.pdf", PDF, "application/pdf")}, data={"signer_name": "Second"})

    current = [r for r in fake.tables["ic_documents"] if r.get("superseded_at") is None]
    assert len(current) == 1
    assert current[0]["signer_name"] == "Second"
    # Same storage key both times, so the write must be an upsert.
    signed_uploads = [u for u in fake.storage.uploads if u["path"].endswith("-signed.pdf")]
    assert len(signed_uploads) == 2
    assert signed_uploads[-1]["options"].get("upsert") == "true"


def test_signing_a_tir_application_is_allowed(monkeypatch, _clear_overrides):
    """The endpoint is track-agnostic even though only VIP surfaces it today."""
    _install(monkeypatch, _tables(tir_applications=[{"id": APP_ID, "status": "offered"}]))
    app.dependency_overrides[get_current_user] = _override_user(["admin"])
    r = _client().post(f"/admin/platform/ic-documents/tir/{APP_ID}",
                       files={"file": ("ic.pdf", PDF, "application/pdf")})
    assert r.status_code == 201


def test_effective_track_caller_resolves_to_the_native_track(monkeypatch, _clear_overrides):
    """Track-move overlay: the admin UI shows a moved app under its EFFECTIVE
    track, so the caller may say "sip" for a row living in tir_applications.
    The document must be keyed by the native track, not 404."""
    fake = _install(monkeypatch, _tables(
        sip_applications=[],
        tir_applications=[{"id": APP_ID, "status": "jury_review", "moved_to_track": "sip"}]))
    app.dependency_overrides[get_current_user] = _override_user(["admin"])
    c = _client()

    r = c.post(f"/admin/platform/ic-documents/sip/{APP_ID}",
               files={"file": ("ic.pdf", PDF, "application/pdf")})
    assert r.status_code == 201, r.text
    assert r.json()["document"]["track"] == "tir"
    assert fake.tables["ic_documents"][0]["application_track"] == "tir"
    assert fake.storage.uploads[0]["path"].startswith(f"tir/{APP_ID}/")

    # Signing and the signed-url both follow the same resolution.
    r = c.post(f"/admin/platform/ic-documents/sip/{APP_ID}/signature",
               files={"file": ("s.pdf", PDF, "application/pdf")}, data={"signer_name": "N"})
    assert r.status_code == 200, r.text
    r = c.get(f"/admin/platform/ic-documents/sip/{APP_ID}/file?variant=signed")
    assert r.status_code == 200


def test_unknown_in_both_tracks_is_still_404(monkeypatch, _clear_overrides):
    _install(monkeypatch, _tables(sip_applications=[], tir_applications=[]))
    app.dependency_overrides[get_current_user] = _override_user(["admin"])
    r = _client().post(f"/admin/platform/ic-documents/sip/{APP_ID}",
                       files={"file": ("ic.pdf", PDF, "application/pdf")})
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "application_not_found"


def test_no_status_guard_after_final_gate(monkeypatch, _clear_overrides):
    """The Final Gate moves an app out of jury_review; IC work must still work."""
    _install(monkeypatch, _tables(sip_applications=[{"id": APP_ID, "status": "offered"}]))
    app.dependency_overrides[get_current_user] = _override_user(["admin"])
    r = _client().post(f"/admin/platform/ic-documents/sip/{APP_ID}",
                       files={"file": ("ic.pdf", PDF, "application/pdf")})
    assert r.status_code == 201


# ── 5. Signed URLs ─────────────────────────────────────────────────────────

def test_signed_url_original_and_signed_variants(monkeypatch, _clear_overrides):
    _install(monkeypatch, _tables())
    app.dependency_overrides[get_current_user] = _override_user(["admin"])
    c = _client()
    c.post(f"/admin/platform/ic-documents/sip/{APP_ID}",
           files={"file": ("ic.pdf", PDF, "application/pdf")})

    r = c.get(f"/admin/platform/ic-documents/sip/{APP_ID}/file?variant=original")
    assert r.status_code == 200
    assert r.json()["expires_in"] == 120
    assert r.json()["url"].startswith("https://signed.example/")

    # Not signed yet.
    r = c.get(f"/admin/platform/ic-documents/sip/{APP_ID}/file?variant=signed")
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "variant_not_available"

    c.post(f"/admin/platform/ic-documents/sip/{APP_ID}/signature",
           files={"file": ("s.pdf", PDF, "application/pdf")}, data={"signer_name": "N"})
    r = c.get(f"/admin/platform/ic-documents/sip/{APP_ID}/file?variant=signed")
    assert r.status_code == 200


def test_signed_url_missing_document_404(monkeypatch, _clear_overrides):
    _install(monkeypatch, _tables())
    app.dependency_overrides[get_current_user] = _override_user(["admin"])
    r = _client().get(f"/admin/platform/ic-documents/sip/{APP_ID}/file")
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "not_found"


# ── 6. Listing ─────────────────────────────────────────────────────────────

def test_list_filters_by_track_and_excludes_superseded(monkeypatch, _clear_overrides):
    other = "22222222-2222-2222-2222-222222222222"
    _install(monkeypatch, _tables(
        tir_applications=[{"id": other, "status": "jury_review"}],
        ic_documents=[
            {"id": "d1", "application_id": APP_ID, "application_track": "sip",
             "storage_path": "p1", "file_name": "current-sip.pdf", "superseded_at": None},
            {"id": "d2", "application_id": APP_ID, "application_track": "sip",
             "storage_path": "p0", "file_name": "old-sip.pdf",
             "superseded_at": "2026-07-01T00:00:00Z"},
            {"id": "d3", "application_id": other, "application_track": "tir",
             "storage_path": "p2", "file_name": "current-tir.pdf", "superseded_at": None},
        ]))
    app.dependency_overrides[get_current_user] = _override_user(["admin"])
    c = _client()

    sip = c.get("/admin/platform/ic-documents?track=sip").json()["documents"]
    assert [d["file_name"] for d in sip] == ["current-sip.pdf"]

    every = c.get("/admin/platform/ic-documents").json()["documents"]
    assert sorted(d["file_name"] for d in every) == ["current-sip.pdf", "current-tir.pdf"]


def test_list_degrades_to_empty_on_db_failure(monkeypatch, _clear_overrides):
    """A data problem must never blank the screen with a 500."""
    from app.routers import ic_documents as router_mod

    class _Boom:
        storage = _FakeStorage()

        def table(self, _name):
            raise RuntimeError("PostgREST exploded")

    monkeypatch.setattr(router_mod, "get_admin_client", lambda: _Boom())
    app.dependency_overrides[get_current_user] = _override_user(["admin"])
    r = _client().get("/admin/platform/ic-documents?track=sip")
    assert r.status_code == 200
    assert r.json() == {"documents": []}
