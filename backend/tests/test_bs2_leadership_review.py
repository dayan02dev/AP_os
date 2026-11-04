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

# LEAD-08: empty decision body rejects + emails

# LEAD-09: reject of an offered app via leadership is recorded as gate-1
def test_reject_of_offered_app_is_recorded_as_gate2(monkeypatch, client):
    fake = FakeSupabase({
        "tir_applications": [{"id": "t1", "status": "offered"}],
        "sip_applications": [],
        "admin_decisions": [
            {"id": "d1", "application_id": "t1", "application_track": "tir", "gate_stage": "gate1",
             "decision": "jury_review", "decided_at": "2026-08-01T00:00:00Z"},
            {"id": "d2", "application_id": "t1", "application_track": "tir", "gate_stage": "gate2",
             "decision": "offered", "decided_at": "2026-09-01T00:00:00Z"},
        ],
    })
    _install(monkeypatch, fake)
    r = client.post("/leadership/applications/t1/decision",
                    json={"decision": "rejected", "rationale": "not a fit"})
    assert r.status_code == 200, r.text
    new = [d for d in fake.tables["admin_decisions"] if d.get("decision") == "rejected"]
    assert new and new[0]["gate_stage"] == "gate2", new


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
