"""Evidence uploads: stamped with the catalog's document label, owned by the
caller's own round, and never reachable across applications."""
from __future__ import annotations

import io

import pytest

from app.deps import get_current_user
from app.main import app
from app.services import air_catalog as cat
from tests.fixtures.fake_supabase import FakeSupabase


@pytest.fixture
def _clear():
    yield
    app.dependency_overrides.clear()


class _Bucket:
    """Mirrors test_founder_crud.py's _Bucket/_Storage — a mockable storage
    surface so signed-url tests never touch real storage."""
    def upload(self, *a, **k): return {"path": a[0] if a else ""}
    def create_signed_url(self, path, expires_in): return {"signedURL": f"https://x/{path}"}


class _Storage:
    def from_(self, bucket): return _Bucket()


def _install(monkeypatch):
    from app.routers import founder as founder_router
    from app.routers import founder_air as air_router
    from app.services import air_query
    fake = FakeSupabase({
        "sip_applications": [{"id": "sapp1", "user_id": "u1", "status": "onboarded",
                              "submitted_at": "2026-07-01"}],
        "tir_applications": [],
        "vip_air_assessments": [], "vip_air_lever_scores": [], "vip_air_evidence": [],
    })
    fake.storage = _Storage()
    monkeypatch.setattr(founder_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(air_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(air_query, "get_admin_client", lambda: fake)
    monkeypatch.setattr(air_router, "_upload", lambda *a, **k: None)
    app.dependency_overrides[get_current_user] = lambda: {
        "user_id": "u1", "email": "u1@x.com", "track": "sip", "roles": ["applicant"]}
    return fake


def _post(client, lever="architecture", level=2, name="arch.pdf"):
    return client.post(
        "/founder/air/evidence",
        files={"file": (name, io.BytesIO(b"%PDF-1.4 test"), "application/pdf")},
        data={"lever": lever, "air_level": str(level)},
    )


def _score_everything(client):
    """Answers q1 (only) for every lever with its lowest-scoring option, so
    every lever carries a claimed_level and /founder/air/submit succeeds —
    mirrors test_air_endpoints.py's helper of the same name."""
    for lever in cat.LEVER_KEYS:
        first = cat.QUESTIONS[lever][0]["options"][0]["id"]
        client.put(f"/founder/air/levers/{lever}", json={
            "q1_option": first, "q2_option": None, "q3_option": None,
            "criteria_checked": []})


class _DuplicateEvidenceOnce:
    """Wraps a FakeSupabase so the first insert().execute() on
    vip_air_evidence after arming raises a duplicate-key error — simulating
    the (assessment_id, lever, air_level, filename) unique constraint added
    in 044 being hit by a re-upload of the same evidence slot. Every other
    call, and every call after the first, passes through to the wrapped
    fake unchanged — same shape as test_air_query.py's _RaceOnce."""

    def __init__(self, inner):
        self._inner = inner
        self._armed = True

    def table(self, name):
        q = self._inner.table(name)
        if name == "vip_air_evidence" and self._armed:
            real_execute = q.execute

            def execute():
                if q._mode == "insert" and self._armed:
                    self._armed = False
                    raise Exception(
                        'duplicate key value violates unique constraint '
                        '"vip_air_evidence_assessment_id_lever_air_level_filename_key" (23505)'
                    )
                return real_execute()

            q.execute = execute
        return q

    def __getattr__(self, name):
        return getattr(self._inner, name)


def test_upload_stores_a_row_stamped_with_the_catalog_document_label(client, monkeypatch, _clear):
    fake = _install(monkeypatch)
    client.get("/founder/air")
    r = _post(client)
    assert r.status_code == 200, r.text
    row = fake.tables["vip_air_evidence"][0]
    assert row["lever"] == "architecture"
    assert row["air_level"] == 2
    assert row["doc_label"] == "System Architecture Document"
    assert row["filename"] == "arch.pdf"
    assert "architecture" in row["storage_path"]


def test_uploaded_evidence_appears_on_its_lever_in_the_bundle(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/air")
    body = _post(client).json()
    arch = next(l for l in body["levers"] if l["lever"] == "architecture")
    assert [e["filename"] for e in arch["evidence"]] == ["arch.pdf"]


def test_upload_rejects_an_unknown_lever(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/air")
    assert _post(client, lever="nonsense").status_code == 404


def test_upload_rejects_a_level_outside_one_to_nine(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/air")
    assert _post(client, level=0).status_code == 422
    assert _post(client, level=10).status_code == 422


def test_upload_for_a_level_with_no_document_defined_is_422(client, monkeypatch, _clear):
    """supply_chain AIR 1 has no qualifying document in the framework."""
    _install(monkeypatch)
    client.get("/founder/air")
    r = _post(client, lever="supply_chain", level=1)
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "no_document_required"


def test_upload_rejects_an_unsupported_mime_type(client, monkeypatch, _clear):
    """Item 8: an unsupported content type must be a clean 415, not an
    unhandled 500 from _upload or the storage provider."""
    _install(monkeypatch)
    client.get("/founder/air")
    r = client.post(
        "/founder/air/evidence",
        files={"file": ("evil.exe", io.BytesIO(b"MZ..."), "application/x-msdownload")},
        data={"lever": "architecture", "air_level": "2"},
    )
    assert r.status_code == 415
    assert r.json()["detail"]["code"] == "unsupported_media"


def test_upload_rejects_an_oversized_file(client, monkeypatch, _clear):
    """Item 8: a file over the app-level cap must be a clean 413."""
    from app.routers import founder_air as air_router
    _install(monkeypatch)
    client.get("/founder/air")
    monkeypatch.setattr(air_router, "_MAX_EVIDENCE_BYTES", 10)
    r = client.post(
        "/founder/air/evidence",
        files={"file": ("big.pdf", io.BytesIO(b"%PDF-1.4" + b"x" * 100), "application/pdf")},
        data={"lever": "architecture", "air_level": "2"},
    )
    assert r.status_code == 413
    assert r.json()["detail"]["code"] == "too_large"


def test_delete_removes_the_row(client, monkeypatch, _clear):
    fake = _install(monkeypatch)
    client.get("/founder/air")
    _post(client)
    row_id = fake.tables["vip_air_evidence"][0]["id"]
    assert client.delete(f"/founder/air/evidence/{row_id}").status_code == 204
    assert fake.tables["vip_air_evidence"] == []


def test_another_applications_evidence_cannot_be_deleted(client, monkeypatch, _clear):
    fake = _install(monkeypatch)
    client.get("/founder/air")
    fake.tables["vip_air_evidence"].append({
        "id": "foreign", "assessment_id": "someone-elses-round", "lever": "architecture",
        "air_level": 2, "doc_label": "x", "storage_path": "p", "filename": "f.pdf"})
    assert client.delete("/founder/air/evidence/foreign").status_code == 404
    assert any(e["id"] == "foreign" for e in fake.tables["vip_air_evidence"])


def test_another_applications_evidence_has_no_signed_url(client, monkeypatch, _clear):
    fake = _install(monkeypatch)
    client.get("/founder/air")
    fake.tables["vip_air_evidence"].append({
        "id": "foreign", "assessment_id": "someone-elses-round", "lever": "architecture",
        "air_level": 2, "doc_label": "x", "storage_path": "p", "filename": "f.pdf"})
    assert client.get("/founder/air/evidence/foreign/signed-url").status_code == 404


def test_signed_url_happy_path_on_a_draft_round(client, monkeypatch, _clear):
    """Item 7: this line never executed in any test before — the whole
    success path through evidence_signed_url, storage call included."""
    fake = _install(monkeypatch)
    client.get("/founder/air")
    _post(client)
    row_id = fake.tables["vip_air_evidence"][0]["id"]
    r = client.get(f"/founder/air/evidence/{row_id}/signed-url")
    assert r.status_code == 200, r.text
    storage_path = fake.tables["vip_air_evidence"][0]["storage_path"]
    assert r.json()["url"] == f"https://x/{storage_path}"


def test_signed_url_502s_when_storage_returns_no_url(client, monkeypatch, _clear):
    """Item 7: a storage response with none of signedURL/signedUrl/url must
    not silently succeed with {"url": null} — it must fail loudly."""
    from app.routers import founder_air as air_router

    class _EmptyBucket:
        def create_signed_url(self, path, expires_in): return {}

    class _EmptyStorage:
        def from_(self, bucket): return _EmptyBucket()

    fake = _install(monkeypatch)
    client.get("/founder/air")
    _post(client)
    row_id = fake.tables["vip_air_evidence"][0]["id"]

    fake.storage = _EmptyStorage()
    monkeypatch.setattr(air_router, "get_admin_client", lambda: fake)
    r = client.get(f"/founder/air/evidence/{row_id}/signed-url")
    assert r.status_code == 502
    assert r.json()["detail"]["code"] == "signed_url_failed"


def test_storage_path_never_carries_the_client_filename(client, monkeypatch, _clear):
    """A path-traversal-shaped filename must never reach the storage key —
    only a generated object name (plus a safely-derived extension) does.
    The original name is still recorded, but only in the filename column."""
    fake = _install(monkeypatch)
    client.get("/founder/air")
    r = _post(client, name="../../../etc/passwd.pdf")
    assert r.status_code == 200, r.text
    row = fake.tables["vip_air_evidence"][0]
    assert row["filename"] == "../../../etc/passwd.pdf"
    assert ".." not in row["storage_path"]
    assert "/etc/" not in row["storage_path"]
    assert row["storage_path"].startswith("air/sapp1/architecture/2/")
    assert row["storage_path"].endswith(".pdf")


def test_reuploading_the_same_slot_replaces_the_row_not_duplicates_it(client, monkeypatch, _clear):
    """A second upload for the same (lever, level, filename) must not leave
    two rows pointing at two different objects — it replaces the row and
    the superseded object is not left behind as an orphan."""
    from app.routers import founder_air as air_router
    fake = _install(monkeypatch)
    client.get("/founder/air")
    _post(client)
    assert len(fake.tables["vip_air_evidence"]) == 1
    first_row_id = fake.tables["vip_air_evidence"][0]["id"]
    first_path = fake.tables["vip_air_evidence"][0]["storage_path"]

    monkeypatch.setattr(air_router, "get_admin_client", lambda: _DuplicateEvidenceOnce(fake))
    r = _post(client)
    assert r.status_code == 200, r.text

    rows = fake.tables["vip_air_evidence"]
    assert len(rows) == 1
    assert rows[0]["id"] == first_row_id
    assert rows[0]["storage_path"] != first_path
    assert rows[0]["filename"] == "arch.pdf"
    assert rows[0]["doc_label"] == "System Architecture Document"


def test_upload_is_409_once_the_round_is_submitted(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/air")
    _score_everything(client)
    assert client.post("/founder/air/submit").status_code == 200
    r = _post(client)
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "air_already_submitted"


def test_delete_is_409_once_the_round_is_submitted(client, monkeypatch, _clear):
    fake = _install(monkeypatch)
    client.get("/founder/air")
    _post(client)
    row_id = fake.tables["vip_air_evidence"][0]["id"]
    _score_everything(client)
    assert client.post("/founder/air/submit").status_code == 200
    r = client.delete(f"/founder/air/evidence/{row_id}")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "air_already_submitted"
    assert any(e["id"] == row_id for e in fake.tables["vip_air_evidence"])


def test_signed_url_still_works_once_the_round_is_submitted(client, monkeypatch, _clear):
    """IMPORTANT 2: reading a document changes nothing, so unlike upload and
    delete it must not be frozen after submit — a founder must still be able
    to open their own uploaded evidence for the whole post-submit life of
    the round."""
    fake = _install(monkeypatch)
    client.get("/founder/air")
    _post(client)
    row_id = fake.tables["vip_air_evidence"][0]["id"]
    _score_everything(client)
    assert client.post("/founder/air/submit").status_code == 200
    r = client.get(f"/founder/air/evidence/{row_id}/signed-url")
    assert r.status_code == 200, r.text
    assert r.json()["url"] == f"https://x/{fake.tables['vip_air_evidence'][0]['storage_path']}"
