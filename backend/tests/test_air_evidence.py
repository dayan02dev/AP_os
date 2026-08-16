"""Evidence uploads: stamped with the catalog's document label, owned by the
caller's own round, and never reachable across applications."""
from __future__ import annotations

import io

import pytest

from app.deps import get_current_user
from app.main import app
from tests.fixtures.fake_supabase import FakeSupabase


@pytest.fixture
def _clear():
    yield
    app.dependency_overrides.clear()


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
