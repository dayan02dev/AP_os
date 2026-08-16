"""The /founder/air surface: VIP-only, save-and-rescore, submit gate."""
from __future__ import annotations

import pytest

from app.deps import get_current_user
from app.main import app
from app.services import air_catalog as cat
from tests.fixtures.fake_supabase import FakeSupabase


@pytest.fixture
def _clear():
    yield
    app.dependency_overrides.clear()


def _user(track: str):
    return lambda: {"user_id": "u1", "email": "u1@x.com", "track": track,
                    "roles": ["applicant"]}


def _install(monkeypatch, track: str = "sip"):
    from app.routers import founder as founder_router
    from app.routers import founder_air as air_router
    from app.services import air_query
    tables = {
        "sip_applications": [{"id": "sapp1", "user_id": "u1", "status": "onboarded",
                              "submitted_at": "2026-07-01"}],
        "tir_applications": [{"id": "app1", "user_id": "u1", "status": "onboarded",
                              "grant_amount": 2500000, "submitted_at": "2026-07-01"}],
        "vip_air_assessments": [], "vip_air_lever_scores": [], "vip_air_evidence": [],
    }
    if track == "sip":
        tables["tir_applications"] = []
    fake = FakeSupabase(tables)
    monkeypatch.setattr(founder_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(air_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(air_query, "get_admin_client", lambda: fake)
    app.dependency_overrides[get_current_user] = _user(track)
    return fake


def test_tir_founders_cannot_reach_the_air_surface(client, monkeypatch, _clear):
    _install(monkeypatch, track="tir")
    r = client.get("/founder/air")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "not_available_for_track"


def test_get_air_creates_and_returns_a_draft_round(client, monkeypatch, _clear):
    fake = _install(monkeypatch)
    r = client.get("/founder/air")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["round"]["status"] == "draft"
    assert len(body["levers"]) == 6
    assert len(body["catalog"]["levers"]) == 6
    assert len(fake.tables["vip_air_assessments"]) == 1


def test_get_air_is_idempotent(client, monkeypatch, _clear):
    fake = _install(monkeypatch)
    client.get("/founder/air")
    client.get("/founder/air")
    assert len(fake.tables["vip_air_assessments"]) == 1
    assert len(fake.tables["vip_air_lever_scores"]) == 6


def test_saving_answers_rescores_the_lever(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/air")
    r = client.put("/founder/air/levers/user_needs", json={
        "q1_option": "C", "q2_option": "B", "q3_option": None,
        "criteria_checked": ["Initiated customer discovery"],
    })
    assert r.status_code == 200, r.text
    un = next(l for l in r.json()["levers"] if l["lever"] == "user_needs")
    assert un["claimed_level"] == 5
    assert un["criteria_checked"] == ["Initiated customer discovery"]


def test_saving_answers_respects_the_ladder(client, monkeypatch, _clear):
    """q1=B is below q1's max, so q2 must not lift the level."""
    _install(monkeypatch)
    client.get("/founder/air")
    r = client.put("/founder/air/levers/user_needs", json={
        "q1_option": "B", "q2_option": "C", "q3_option": None, "criteria_checked": [],
    })
    un = next(l for l in r.json()["levers"] if l["lever"] == "user_needs")
    assert un["claimed_level"] == 2


def test_an_unknown_lever_is_404(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/air")
    r = client.put("/founder/air/levers/nonsense", json={
        "q1_option": "A", "q2_option": None, "q3_option": None, "criteria_checked": [],
    })
    assert r.status_code == 404


def test_submit_is_422_while_any_lever_is_unscored(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/air")
    client.put("/founder/air/levers/user_needs", json={
        "q1_option": "A", "q2_option": None, "q3_option": None, "criteria_checked": []})
    r = client.post("/founder/air/submit")
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "air_incomplete"
    assert "architecture" in r.json()["detail"]["missing"]
    assert "user_needs" not in r.json()["detail"]["missing"]


def _score_everything(client):
    for lever in cat.LEVER_KEYS:
        first = cat.QUESTIONS[lever][0]["options"][0]["id"]
        client.put(f"/founder/air/levers/{lever}", json={
            "q1_option": first, "q2_option": None, "q3_option": None,
            "criteria_checked": []})


def test_submit_flips_the_round_and_stamps_rollups(client, monkeypatch, _clear):
    fake = _install(monkeypatch)
    client.get("/founder/air")
    _score_everything(client)
    r = client.post("/founder/air/submit")
    assert r.status_code == 200, r.text
    assert r.json()["round"]["status"] == "submitted"
    row = fake.tables["vip_air_assessments"][0]
    assert row["status"] == "submitted"
    assert row["submitted_at"]
    assert row["overall_claimed"] == 1


def test_submitting_twice_is_conflict(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/air")
    _score_everything(client)
    client.post("/founder/air/submit")
    r = client.post("/founder/air/submit")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "air_already_submitted"


def test_answers_cannot_be_changed_after_submit(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/air")
    _score_everything(client)
    client.post("/founder/air/submit")
    r = client.put("/founder/air/levers/user_needs", json={
        "q1_option": "C", "q2_option": None, "q3_option": None, "criteria_checked": []})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "air_already_submitted"


def test_another_users_round_is_not_reachable(client, monkeypatch, _clear):
    """Ownership comes from require_founder_access resolving the caller's own
    application, so a foreign round simply is not addressable."""
    fake = _install(monkeypatch)
    fake.tables["vip_air_assessments"].append({
        "id": "other", "application_id": "someone-else", "round_label": "FY26-27-Q1",
        "status": "draft"})
    r = client.get("/founder/air")
    assert r.status_code == 200
    assert r.json()["round"]["id"] != "other"
