"""Founder portal endpoints: MOU sign flow + CRUD (added across Tasks 8-10)."""
from __future__ import annotations

import base64

import pytest

from app.deps import get_current_user
from app.main import app
from tests.fixtures.fake_supabase import FakeSupabase

_PNG = "data:image/png;base64," + base64.b64encode(base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
)).decode()


class _Bucket:
    def upload(self, *a, **k): return {"path": a[0] if a else ""}
    def create_signed_url(self, path, expires_in): return {"signedURL": f"https://x/{path}"}


class _Storage:
    def from_(self, bucket): return _Bucket()


@pytest.fixture
def _clear():
    yield
    app.dependency_overrides.clear()


def _override_user(uid):
    def _f():
        return {"user_id": uid, "email": f"{uid}@x.com", "track": "tir", "roles": ["applicant"]}
    return _f


def _install(monkeypatch, tables):
    from app.routers import founder as fr
    from app.services import founder_mou, founder_query, state_machine
    fake = FakeSupabase(tables)
    fake.storage = _Storage()
    for mod in (fr, founder_mou, founder_query, state_machine):
        monkeypatch.setattr(mod, "get_admin_client", lambda: fake)
    return fake


def test_sign_mou_flips_status_to_onboarded(client, monkeypatch, _clear):
    fake = _install(monkeypatch, {
        "tir_applications": [{"id": "app1", "user_id": "u1", "status": "offered",
                              "grant_amount": 2500000, "submitted_at": "2026-07-01"}],
        "profiles": [{"id": "u1", "full_name": "Priya"}],
        "founder_mou": [],
        "application_status_log": [],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.post("/founder/mou/sign", json={"signer_name": "Priya", "signature_png": _PNG})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "onboarded"
    # status actually mutated in the fake store
    assert fake.tables["tir_applications"][0]["status"] == "onboarded"
    assert fake.tables["founder_mou"] and fake.tables["founder_mou"][0]["signed_pdf_path"]


def test_sign_mou_twice_is_conflict(client, monkeypatch, _clear):
    _install(monkeypatch, {
        "tir_applications": [{"id": "app1", "user_id": "u1", "status": "onboarded",
                              "grant_amount": 2500000, "submitted_at": "2026-07-01"}],
        "profiles": [{"id": "u1", "full_name": "Priya"}],
        "founder_mou": [{"application_id": "app1", "signer_name": "Priya",
                         "signed_pdf_path": "app1/mou/signed.pdf", "signed_at": "2026-07-10"}],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.post("/founder/mou/sign", json={"signer_name": "Priya", "signature_png": _PNG})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "mou_already_signed"


def test_me_reports_mou_signed_and_unlocked(client, monkeypatch, _clear):
    _install(monkeypatch, {
        "tir_applications": [{"id": "app1", "user_id": "u1", "status": "onboarded",
                              "grant_amount": 2500000, "submitted_at": "2026-07-01"}],
        "profiles": [{"id": "u1", "full_name": "Priya"}],
        "founder_mou": [{"application_id": "app1", "signed_pdf_path": "x", "signed_at": "2026-07-10"}],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.get("/founder/me")
    body = r.json()
    assert body["mou_signed"] is True
    assert body["locked"] == {"cohort": False, "dashboard": False}
