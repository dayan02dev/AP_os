from tests.fixtures.fake_supabase import FakeSupabase
from app.services.jury_matching import run as jm


def _seed():
    return FakeSupabase({
        "user_roles": [{"user_id": "j1", "role": "jury"}],
        "tir_applications": [
            {"id": "a1", "status": "jury_review"},
            {"id": "a2", "status": "jury_review"},
            {"id": "a3", "status": "under_review"},   # not jury_review
        ],
        "sip_applications": [],
        "jury_recommendations": [
            {"juror_user_id": "j1", "application_id": "a1", "application_track": "tir", "score": 90},
            {"juror_user_id": "j1", "application_id": "a2", "application_track": "tir", "score": 80},
            {"juror_user_id": "j1", "application_id": "a3", "application_track": "tir", "score": 70},
        ],
        "jury_assignments": [],
    })


def test_assigns_only_jury_review_matches():
    fake = _seed()
    r = jm.auto_assign_from_recommendations(fake, "j1", assigned_by="admin1")
    assert r["assigned"] == 2                         # a1, a2 (a3 skipped, under_review)
    assert r["skipped_not_jury_review"] == 1
    keys = {(x["application_id"], x["juror_user_id"]) for x in fake.tables["jury_assignments"]}
    assert keys == {("a1", "j1"), ("a2", "j1")}
    assert fake.tables["jury_assignments"][0]["assigned_by"] == "admin1"


def test_idempotent_rerun_adds_nothing():
    fake = _seed()
    jm.auto_assign_from_recommendations(fake, "j1", assigned_by="admin1")
    r2 = jm.auto_assign_from_recommendations(fake, "j1", assigned_by="admin1")
    assert r2["assigned"] == 0 and r2["skipped_already"] == 2
    assert len(fake.tables["jury_assignments"]) == 2   # no duplicates


def test_preserves_manual_assignment():
    fake = _seed()
    fake.tables["jury_assignments"].append(
        {"application_id": "a2", "application_track": "tir", "juror_user_id": "j1", "assigned_by": "manual"})
    jm.auto_assign_from_recommendations(fake, "j1", assigned_by="admin1")
    a2 = [x for x in fake.tables["jury_assignments"] if x["application_id"] == "a2"]
    assert len(a2) == 1 and a2[0]["assigned_by"] == "manual"   # untouched


def test_all_jurors_when_no_id():
    fake = _seed()
    r = jm.auto_assign_from_recommendations(fake, None, assigned_by="admin1")
    assert r["jurors"] == 1 and r["assigned"] == 2


import pytest
from app.deps import get_current_user
from app.main import app


@pytest.fixture
def _clear():
    yield
    app.dependency_overrides.clear()


def _admin():
    return {"user_id": "admin1", "email": "a@x.com", "roles": ["admin"]}


def test_endpoint_requires_cap(client, _clear):
    app.dependency_overrides[get_current_user] = lambda: {"user_id": "u", "roles": ["reviewer"]}
    res = client.post("/admin/platform/jury/auto-assign", json={})
    assert res.status_code == 403


def test_endpoint_returns_result(client, monkeypatch, _clear):
    from app.routers import admin_platform as ap

    app.dependency_overrides[get_current_user] = _admin
    called = {}
    def _fake(clientarg, jid, *, assigned_by):
        called["jid"] = jid; called["by"] = assigned_by
        return {"assigned": 3, "per_juror": {"j1": 3}, "skipped_already": 0,
                "skipped_not_jury_review": 0, "jurors": 1}
    monkeypatch.setattr("app.services.jury_matching.run.auto_assign_from_recommendations", _fake)
    # The handler also builds a client (to pass into the engine) and writes
    # an audit row via the real supabase client factory; this test env's
    # SUPABASE_SERVICE_ROLE_KEY isn't JWT-shaped, so both must be stubbed
    # (mirrors the ap.get_admin_client patch pattern in test_jury_matching.py).
    monkeypatch.setattr(ap, "get_admin_client", lambda: object(), raising=False)
    monkeypatch.setattr(ap, "write_audit", lambda **kw: None, raising=False)
    res = client.post("/admin/platform/jury/auto-assign", json={"juror_user_id": "j1"})
    assert res.status_code == 200
    assert res.json()["assigned"] == 3
    assert called == {"jid": "j1", "by": "admin1"}
