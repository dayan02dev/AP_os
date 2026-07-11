"""Endpoint-level tests for multi-batch allocation (admin_platform batches)."""
from app.routers import admin_platform
from app.services import admin_query, batch_membership, state_machine
from tests.fixtures.fake_supabase import FakeSupabase


class _Item:
    def __init__(self, app, track):
        self.application_id = app
        self.track = track


class _Body:
    def __init__(self, items):
        self.items = [_Item(a, t) for a, t in items]


def _patch_endpoint(monkeypatch, sb):
    monkeypatch.setattr(admin_platform, "get_admin_client", lambda: sb)
    monkeypatch.setattr(admin_platform, "notify_reviewers_assigned", lambda *a, **k: None)
    monkeypatch.setattr(admin_platform, "write_audit", lambda *a, **k: None)
    monkeypatch.setattr(batch_membership, "_advance", lambda *a, **k: None)


async def test_assign_applications_appends_and_fans_out(monkeypatch):
    sb = FakeSupabase(
        {
            "batches": [{"id": "A", "name": "Batch A"}],
            "batch_reviewers": [{"batch_id": "A", "reviewer_user_id": "r1"}],
            "application_batches": [],
            "reviewer_assignments": [],
            "reviews": [],
            "tir_applications": [{"id": "app1", "status": "submitted"}],
        }
    )
    _patch_endpoint(monkeypatch, sb)
    out = await admin_platform.assign_applications(
        "A", _Body([("app1", "tir")]), user={"user_id": "admin", "roles": ["admin"]}
    )
    assert out["assigned"] == 1
    assert out["assignments_created"] == 1
    assert {a["reviewer_user_id"] for a in sb.tables["reviewer_assignments"]} == {"r1"}


async def test_assign_applications_appends_to_second_batch(monkeypatch):
    """The SAME app can be added to a second batch (no move, no constraint error)."""
    sb = FakeSupabase(
        {
            "batches": [{"id": "A", "name": "A"}, {"id": "B", "name": "B"}],
            "batch_reviewers": [
                {"batch_id": "A", "reviewer_user_id": "r1"},
                {"batch_id": "B", "reviewer_user_id": "r2"},
            ],
            "application_batches": [
                {"application_id": "app1", "application_track": "tir", "batch_id": "A"}
            ],
            "reviewer_assignments": [
                {"application_id": "app1", "application_track": "tir", "reviewer_user_id": "r1"}
            ],
            "reviews": [],
            "tir_applications": [{"id": "app1", "status": "under_review"}],
        }
    )
    _patch_endpoint(monkeypatch, sb)
    await admin_platform.assign_applications(
        "B", _Body([("app1", "tir")]), user={"user_id": "admin", "roles": ["admin"]}
    )
    linked = {(l["application_id"], l["batch_id"]) for l in sb.tables["application_batches"]}
    assert linked == {("app1", "A"), ("app1", "B")}  # in BOTH batches now
    assert {a["reviewer_user_id"] for a in sb.tables["reviewer_assignments"]} == {"r1", "r2"}


async def test_remove_app_from_one_batch_smart(monkeypatch):
    sb = FakeSupabase(
        {
            "batches": [{"id": "A", "name": "A"}, {"id": "B", "name": "B"}],
            "batch_reviewers": [
                {"batch_id": "A", "reviewer_user_id": "r1"},
                {"batch_id": "B", "reviewer_user_id": "r2"},
            ],
            "application_batches": [
                {"application_id": "app1", "application_track": "tir", "batch_id": "A"},
                {"application_id": "app1", "application_track": "tir", "batch_id": "B"},
            ],
            "reviewer_assignments": [
                {"application_id": "app1", "application_track": "tir", "reviewer_user_id": "r1"},
                {"application_id": "app1", "application_track": "tir", "reviewer_user_id": "r2"},
            ],
            "reviews": [],
        }
    )
    _patch_endpoint(monkeypatch, sb)
    out = await admin_platform.remove_applications_from_batch(
        "B", _Body([("app1", "tir")]), user={"user_id": "admin", "roles": ["admin"]}
    )
    assert out["assignments_removed"] == 1
    assert {a["reviewer_user_id"] for a in sb.tables["reviewer_assignments"]} == {"r1"}


async def test_unassign_batch_reviewer_is_membership_aware(monkeypatch):
    sb = FakeSupabase(
        {
            "batches": [{"id": "A", "name": "A"}, {"id": "B", "name": "B"}],
            "batch_reviewers": [
                {"batch_id": "A", "reviewer_user_id": "shared"},
                {"batch_id": "B", "reviewer_user_id": "shared"},
            ],
            "application_batches": [
                {"application_id": "app1", "application_track": "tir", "batch_id": "A"},
                {"application_id": "app1", "application_track": "tir", "batch_id": "B"},
            ],
            "reviewer_assignments": [
                {"application_id": "app1", "application_track": "tir", "reviewer_user_id": "shared"}
            ],
            "reviews": [],
        }
    )
    _patch_endpoint(monkeypatch, sb)
    out = await admin_platform.unassign_batch_reviewer(
        "B", "shared", user={"user_id": "admin", "roles": ["admin"]}
    )
    # "shared" still supplied by batch A → assignment kept
    assert {a["reviewer_user_id"] for a in sb.tables["reviewer_assignments"]} == {"shared"}
    assert ("B", "shared") not in {
        (m["batch_id"], m["reviewer_user_id"]) for m in sb.tables["batch_reviewers"]
    }
    assert out["removed"] == 0


def test_assign_reviewers_to_batch_writes_membership(monkeypatch):
    sb = FakeSupabase(
        {
            "batches": [{"id": "A", "name": "A"}],
            "batch_reviewers": [],
            "application_batches": [
                {"application_id": "app1", "application_track": "tir", "batch_id": "A"}
            ],
            "reviewer_assignments": [],
            "reviews": [],
            "tir_applications": [{"id": "app1", "status": "submitted"}],
        }
    )
    monkeypatch.setattr(state_machine, "get_admin_client", lambda: sb)
    monkeypatch.setattr(admin_query, "get_admin_client", lambda: sb)
    admin_query.assign_reviewers_to_batch(sb, "A", ["r1", "r2"], assigned_by="admin")
    members = {(m["batch_id"], m["reviewer_user_id"]) for m in sb.tables["batch_reviewers"]}
    assert members == {("A", "r1"), ("A", "r2")}
    assert {a["reviewer_user_id"] for a in sb.tables["reviewer_assignments"]} == {"r1", "r2"}
    assert sb.status_of("tir", "app1") == "under_review"  # advance fired against the fake


def test_fetch_batches_returns_list_per_app(monkeypatch):
    sb = FakeSupabase(
        {
            "batches": [{"id": "A", "name": "Batch A"}, {"id": "B", "name": "Batch B"}],
            "application_batches": [
                {"application_id": "app1", "application_track": "tir", "batch_id": "A"},
                {"application_id": "app1", "application_track": "tir", "batch_id": "B"},
            ],
        }
    )
    monkeypatch.setattr(admin_query, "get_admin_client", lambda: sb)
    out = admin_query._fetch_batches([("tir", "app1")])
    names = sorted(b["name"] for b in out[("tir", "app1")])
    assert names == ["Batch A", "Batch B"]
