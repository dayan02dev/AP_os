"""Task 5: expertise matcher service + enrich/recompute admin endpoints.

Service tests use the mutating `FakeSupabase` fixture (delete+insert
lifecycle). Router tests hit the real FastAPI app, overriding the
`get_current_user` singleton (the pattern confirmed to work in Task 2 —
`require_capability` builds a fresh closure per call and can't be
overridden directly) and patching `publish_jury_job` where it's defined
(the endpoints import it locally from `app.services.sqs_publisher`).
"""
from __future__ import annotations

import pytest

from tests.fixtures.fake_supabase import FakeSupabase
from app.services.jury_matching import run as jm_run


# ─── Service: run_for_juror ────────────────────────────────────────────


def _fake(monkeypatch, llm_json):
    fake = FakeSupabase({
        "jury_profiles": [{"juror_user_id": "j1", "expertise_domains": ["Robotics & Automation"],
                           "enrichment": {"summary": "robotics prof"}, "enrichment_status": "done"}],
        "tir_applications": [{"id": "a1", "status": "jury_review"},
                             {"id": "a2", "status": "under_review"}],
        "sip_applications": [{"id": "b1", "status": "jury_review"}],
        "ai_screening": [
            {"application_id": "a1", "application_track": "tir",
             "project_name": "RoboArm", "summary": "arm", "industry_category_id": "c1"},
            {"application_id": "b1", "application_track": "sip",
             "project_name": "MediScan", "summary": "scan", "industry_category_id": "c2"}],
        "industry_categories": [{"id": "c1", "label": "Robotics & Automation"},
                                {"id": "c2", "label": "HealthTech"}],
        "jury_recommendations": [{"juror_user_id": "j1", "application_id": "old",
                                  "application_track": "tir", "score": 10}],
    })
    monkeypatch.setattr(jm_run, "_call_llm", lambda profile, lines: llm_json)
    return fake


def test_match_replaces_recommendations(monkeypatch):
    fake = _fake(monkeypatch,
        '{"recommendations":[{"application_id":"a1","score":92,"reason":"robotics fit"},'
        '{"application_id":"bogus","score":80,"reason":"x"}]}')
    jm_run.run_for_juror(fake, "j1")
    rows = fake.tables["jury_recommendations"]
    assert all(r["application_id"] != "old" for r in rows)   # old rows replaced
    assert [r["application_id"] for r in rows] == ["a1"]     # bogus id filtered out
    assert rows[0]["score"] == 92 and rows[0]["application_track"] == "tir"
    assert fake.tables["jury_profiles"][0].get("matched_at")


def test_match_no_jury_apps_is_noop(monkeypatch):
    fake = _fake(monkeypatch, '{"recommendations":[]}')
    fake.tables["tir_applications"][0]["status"] = "rejected"
    fake.tables["sip_applications"][0]["status"] = "rejected"
    jm_run.run_for_juror(fake, "j1")
    assert fake.tables["jury_recommendations"] == [] or \
           all(r["application_id"] != "a1" for r in fake.tables["jury_recommendations"])


# ─── Router: enrich + recompute endpoints ──────────────────────────────


def _override_user(user_id: str, roles: list[str]):
    def _f():
        return {"user_id": user_id, "email": f"{user_id}@x.com", "roles": roles}
    return _f


@pytest.fixture
def _clear_overrides():
    from app.main import app
    yield
    app.dependency_overrides.clear()


def test_enrich_juror_requires_capability(client, _clear_overrides):
    from app.deps import get_current_user
    from app.main import app
    # leadership has assign_jurors but NOT manage_jury_roster — must be refused.
    app.dependency_overrides[get_current_user] = _override_user("lead-1", ["leadership"])
    r = client.post("/admin/platform/jurors/j1/enrich")
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "missing_capability"


def test_enrich_juror_queues_and_updates_status(client, monkeypatch, _clear_overrides):
    from app.deps import get_current_user
    from app.main import app
    from app.routers import admin_platform as ap

    fake = FakeSupabase({"jury_profiles": [{"juror_user_id": "j1", "enrichment_status": "done"}]})
    monkeypatch.setattr(ap, "get_admin_client", lambda: fake, raising=False)

    calls = []
    monkeypatch.setattr(
        "app.services.sqs_publisher.publish_jury_job",
        lambda job, juror_user_id: calls.append((job, juror_user_id)) or True,
    )
    app.dependency_overrides[get_current_user] = _override_user("admin-1", ["admin"])
    r = client.post("/admin/platform/jurors/j1/enrich")
    assert r.status_code == 202
    assert r.json() == {"queued": True, "juror_user_id": "j1"}
    assert calls == [("jury_enrich", "j1")]
    assert fake.tables["jury_profiles"][0]["enrichment_status"] == "pending"


def test_recompute_requires_capability(client, _clear_overrides):
    from app.deps import get_current_user
    from app.main import app
    app.dependency_overrides[get_current_user] = _override_user("lead-1", ["leadership"])
    r = client.post("/admin/platform/jury/recommendations/recompute", json={})
    assert r.status_code == 403


def test_recompute_specific_juror_queues_one(client, monkeypatch, _clear_overrides):
    from app.deps import get_current_user
    from app.main import app
    from app.routers import admin_platform as ap

    fake = FakeSupabase({"user_roles": [{"user_id": "j1", "role": "jury"},
                                        {"user_id": "j2", "role": "jury"}]})
    monkeypatch.setattr(ap, "get_admin_client", lambda: fake, raising=False)
    calls = []
    monkeypatch.setattr(
        "app.services.sqs_publisher.publish_jury_job",
        lambda job, juror_user_id: calls.append((job, juror_user_id)) or True,
    )
    app.dependency_overrides[get_current_user] = _override_user("admin-1", ["admin"])
    r = client.post("/admin/platform/jury/recommendations/recompute",
                    json={"juror_user_id": "j1"})
    assert r.status_code == 202
    assert r.json() == {"queued": ["j1"]}
    assert calls == [("jury_match", "j1")]


def test_recompute_all_jurors_queues_every_juror(client, monkeypatch, _clear_overrides):
    from app.deps import get_current_user
    from app.main import app
    from app.routers import admin_platform as ap

    fake = FakeSupabase({"user_roles": [{"user_id": "j1", "role": "jury"},
                                        {"user_id": "j2", "role": "jury"},
                                        {"user_id": "rev-1", "role": "reviewer"}]})
    monkeypatch.setattr(ap, "get_admin_client", lambda: fake, raising=False)
    calls = []
    monkeypatch.setattr(
        "app.services.sqs_publisher.publish_jury_job",
        lambda job, juror_user_id: calls.append((job, juror_user_id)) or True,
    )
    app.dependency_overrides[get_current_user] = _override_user("admin-1", ["admin"])
    r = client.post("/admin/platform/jury/recommendations/recompute", json={})
    assert r.status_code == 202
    assert r.json() == {"queued": ["j1", "j2"]}
