import pytest
from tests.fixtures.fake_supabase import FakeSupabase


def _install(monkeypatch, fake):
    from app.services import state_machine, admin_query
    monkeypatch.setattr(state_machine, "get_admin_client", lambda: fake)
    monkeypatch.setattr(admin_query, "get_admin_client", lambda: fake)
    return fake


@pytest.mark.parametrize("track", ["tir", "sip"])
def test_batch_assign_advances_submitted_apps(monkeypatch, track):
    from app.services import admin_query
    fake = FakeSupabase({
        f"{track}_applications": [{"id": "app1", "status": "submitted"}],
        "application_batches": [{"application_id": "app1", "application_track": track, "batch_id": "b1"}],
        "reviewer_assignments": [],
    })
    _install(monkeypatch, fake)
    admin_query.assign_reviewers_to_batch(fake, "b1", ["rev1"], assigned_by="admin1")
    assert fake.status_of(track, "app1") == "under_review"
