import pytest

from app.services import batch_membership as bm
from tests.fixtures.fake_supabase import FakeSupabase


@pytest.fixture(autouse=True)
def _no_status_advance(monkeypatch):
    # _advance() uses the real admin client; the reconcile-logic tests don't
    # care about status, so stub it out.
    monkeypatch.setattr(bm, "_advance", lambda *a, **k: None)


def _seed():
    return FakeSupabase(
        {
            "batches": [{"id": "A", "name": "Batch A"}, {"id": "B", "name": "Batch B"}],
            "batch_reviewers": [
                {"batch_id": "A", "reviewer_user_id": "r1"},
                {"batch_id": "A", "reviewer_user_id": "shared"},
                {"batch_id": "B", "reviewer_user_id": "r2"},
                {"batch_id": "B", "reviewer_user_id": "shared"},
            ],
            "application_batches": [],
            "reviewer_assignments": [],
            "reviews": [],
            "tir_applications": [{"id": "app1", "status": "submitted"}],
        }
    )


def test_add_apps_to_batch_fans_out_batch_reviewers():
    sb = _seed()
    res = bm.add_apps_to_batch(sb, "A", [("app1", "tir")], actor="admin")
    assigned = {a["reviewer_user_id"] for a in sb.tables["reviewer_assignments"]}
    assert assigned == {"r1", "shared"}  # only Batch A's reviewers
    assert res["assignments_created"] == 2
    assert any(
        l["batch_id"] == "A" and l["application_id"] == "app1"
        for l in sb.tables["application_batches"]
    )


def test_app_in_two_batches_gets_union_of_reviewers():
    sb = _seed()
    bm.add_apps_to_batch(sb, "A", [("app1", "tir")], actor="admin")
    bm.add_apps_to_batch(sb, "B", [("app1", "tir")], actor="admin")
    assigned = {a["reviewer_user_id"] for a in sb.tables["reviewer_assignments"]}
    assert assigned == {"r1", "r2", "shared"}  # union across A and B


def test_add_is_idempotent():
    sb = _seed()
    bm.add_apps_to_batch(sb, "A", [("app1", "tir")], actor="admin")
    res = bm.add_apps_to_batch(sb, "A", [("app1", "tir")], actor="admin")
    assert res["assignments_created"] == 0  # nothing new the second time
    assert len(sb.tables["application_batches"]) == 1  # not duplicated
    assert len(sb.tables["reviewer_assignments"]) == 2


def test_smart_remove_keeps_shared_reviewer_drops_exclusive():
    sb = _seed()
    bm.add_apps_to_batch(sb, "A", [("app1", "tir")], actor="admin")
    bm.add_apps_to_batch(sb, "B", [("app1", "tir")], actor="admin")
    res = bm.remove_app_from_batch(sb, "B", "app1", "tir", actor="admin")
    assigned = {a["reviewer_user_id"] for a in sb.tables["reviewer_assignments"]}
    # r2 exclusive to B → removed; shared still supplied by A → kept; r1 kept
    assert assigned == {"r1", "shared"}
    assert res["assignments_removed"] == 1
    assert not any(
        l["batch_id"] == "B" and l["application_id"] == "app1"
        for l in sb.tables["application_batches"]
    )


def test_smart_remove_never_drops_submitted_reviewer():
    sb = _seed()
    bm.add_apps_to_batch(sb, "B", [("app1", "tir")], actor="admin")
    sb.tables["reviews"].append(
        {
            "application_id": "app1",
            "application_track": "tir",
            "reviewer_user_id": "r2",
            "submitted_at": "2026-07-01T00:00:00Z",
            "status": "submitted",
        }
    )
    res = bm.remove_app_from_batch(sb, "B", "app1", "tir", actor="admin")
    assigned = {a["reviewer_user_id"] for a in sb.tables["reviewer_assignments"]}
    assert "r2" in assigned  # submitted review → protected
    assert res["skipped_submitted"] == 1


def test_remove_reviewer_from_batch_smart():
    sb = _seed()
    bm.add_apps_to_batch(sb, "A", [("app1", "tir")], actor="admin")
    bm.add_apps_to_batch(sb, "B", [("app1", "tir")], actor="admin")
    # remove "shared" from batch B → still in A for app1 → assignment kept
    res = bm.remove_reviewer_from_batch(sb, "B", "shared", actor="admin")
    assigned = {a["reviewer_user_id"] for a in sb.tables["reviewer_assignments"]}
    assert "shared" in assigned
    assert res["removed"] == 0
    assert ("B", "shared") not in {
        (m["batch_id"], m["reviewer_user_id"]) for m in sb.tables["batch_reviewers"]
    }
    # remove "r2" from B → r2 exclusive to B for app1 → assignment dropped
    res2 = bm.remove_reviewer_from_batch(sb, "B", "r2", actor="admin")
    assigned = {a["reviewer_user_id"] for a in sb.tables["reviewer_assignments"]}
    assert "r2" not in assigned
    assert res2["removed"] == 1


def test_reject_detaches_all_batch_links():
    """Gate-1 reject must clear ALL of a multi-batch app's batch links + every
    reviewer assignment (reviews are kept)."""
    from app.services.applications_query import detach_application_from_review

    sb = FakeSupabase(
        {
            "application_batches": [
                {"application_id": "app1", "application_track": "tir", "batch_id": "A"},
                {"application_id": "app1", "application_track": "tir", "batch_id": "B"},
            ],
            "reviewer_assignments": [
                {"application_id": "app1", "application_track": "tir", "reviewer_user_id": "r1"},
                {"application_id": "app1", "application_track": "tir", "reviewer_user_id": "r2"},
            ],
        }
    )
    res = detach_application_from_review(sb, "app1", "tir", remove_batch_link=True)
    assert sb.tables["application_batches"] == []
    assert sb.tables["reviewer_assignments"] == []
    assert res["batch_links_removed"] == 2
