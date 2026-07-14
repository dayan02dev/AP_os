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
