"""Swarm2 / leadership_review — backend repros for the leadership review page
detail payload and leadership_actions write endpoints.

Each test asserts the CORRECT behaviour, so it fails while the bug exists.
"""
from __future__ import annotations

import sys

import pytest
from fastapi.testclient import TestClient

from app.deps import get_current_user
from app.main import app
from tests.fixtures.fake_supabase import FakeSupabase


def _install(monkeypatch, fake):
    for name, mod in list(sys.modules.items()):
        if name.startswith("app.") and mod is not None and hasattr(mod, "get_admin_client"):
            monkeypatch.setattr(mod, "get_admin_client", lambda: fake, raising=False)
    from app.services import decision_email
    sent: list = []
    monkeypatch.setattr(decision_email, "notify_applicant_decided",
                        lambda *a, **k: sent.append(k))
    return sent


@pytest.fixture
def client():
    app.dependency_overrides[get_current_user] = lambda: {
        "user_id": "lead-1", "email": "lead@artpark.in", "roles": ["leadership"],
    }
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_current_user, None)


# LEAD-03: résumé on the leadership detail
def test_detail_exposes_resume_file(monkeypatch, client):
    fake = FakeSupabase({
        "tir_applications": [{"id": "t1", "status": "under_review", "display_seq": 27001,
                              "resume_file_id": "res-1", "submitted_at": "2026-06-01T00:00:00Z"}],
        "sip_applications": [],
        "tir_resume_uploads": [{"id": "res-1", "storage_path": "u1/cv.pdf",
                                "original_filename": "cv.pdf"}],
    })
    _install(monkeypatch, fake)
    r = client.get("/leadership/applications/t1")
    assert r.status_code == 200, r.text
    # applicationSchemas.js:139 reads application.resume_file.
    assert r.json()["application"].get("resume_file"), sorted(r.json()["application"].keys())


# LEAD-08: empty decision body rejects + emails
# LEAD-09: reject of an offered app via leadership is recorded as gate-1
# NEW: leadership unassign ignores the 11-03 one always-detach unassign rule
# LEAD-10 regression guard: decided apps get skipped_closed (expected PASS)
def test_assign_reviewer_to_rejected_app_is_skipped(monkeypatch, client):
    fake = FakeSupabase({
        "tir_applications": [{"id": "t1", "status": "rejected"}],
        "sip_applications": [],
        "user_roles": [{"user_id": "rv1", "role": "reviewer"}],
        "reviewer_assignments": [],
    })
    _install(monkeypatch, fake)
    from app.routers import leadership_actions
    monkeypatch.setattr(leadership_actions, "notify_reviewers_assigned", lambda *a, **k: None)
    r = client.post("/leadership/applications/t1/reviewers", json={"reviewer_user_ids": ["rv1"]})
    assert r.status_code == 200, r.text
    assert r.json()["results"][0]["status"] == "skipped_closed"
    assert fake.tables["reviewer_assignments"] == []
