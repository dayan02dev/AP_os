"""Reviewer roster: one `assigned` definition across progress, batch breakdown
and the Manage drawer; pending = active unreviewed work on apps still in
review (ADM-10)."""
from __future__ import annotations

import pytest

from app.services import admin_query, applications_query

from tests.fixtures.fake_supabase import FakeSupabase

R = "rv1"


def _asg(app, track="tir"):
    return {"id": f"as-{app}", "application_id": app, "application_track": track,
            "reviewer_user_id": R, "declined_at": None, "reassigned_to": None,
            "assigned_at": "2026-07-01T00:00:00Z"}


def _rv(app, track="tir"):
    return {"application_id": app, "application_track": track, "reviewer_user_id": R,
            "submitted_at": "2026-07-02T00:00:00Z", "recommendation": "yes",
            "score_problem": 7, "score_solution": 7, "score_tech": 7,
            "score_founders": 7, "score_commitment": 7}


def _backend():
    apps = {
        "DONE": "evaluated",     # reviewed, assignment still live
        "DET": "evaluated",      # reviewed, assignment row deleted
        "OPEN": "under_review",  # live assignment, not yet reviewed → pending
        "STALE": "evaluated",    # live assignment, never reviewed, app moved on
        "REJ": "rejected",       # reviewed but Gate-1 rejected → excluded
    }
    return FakeSupabase({
        "user_roles": [{"user_id": R, "role": "reviewer"}],
        "profiles": [{"id": R, "full_name": "Nirav", "email": "n@x.io"}],
        "reviewer_profiles": [{"reviewer_user_id": R, "weight": 1.0}],
        "tir_applications": [
            {"id": a, "status": s, "display_seq": 26000 + i, "basic_full_name": a,
             "basic_org": a, "submitted_at": "2026-07-01T00:00:00Z"}
            for i, (a, s) in enumerate(apps.items())
        ],
        "sip_applications": [],
        "reviewer_assignments": [_asg("DONE"), _asg("OPEN"), _asg("STALE"), _asg("REJ")],
        "reviews": [_rv("DONE"), _rv("DET"), _rv("REJ")],
        "batches": [{"id": "b1", "name": "Batch 1"}],
        "application_batches": [
            {"application_id": a, "application_track": "tir", "batch_id": "b1"}
            for a in ("DONE", "DET", "OPEN", "STALE")
        ],
        "ai_screening": [],
    })


@pytest.fixture
def sb(monkeypatch):
    sb = _backend()
    monkeypatch.setattr(admin_query, "get_admin_client", lambda: sb)
    monkeypatch.setattr(applications_query, "get_admin_client", lambda: sb)
    return sb


def _roster_row():
    rows = admin_query.fetch_roster()["reviewers"]
    assert len(rows) == 1
    return rows[0]


def test_roster_pending_excludes_stale_assignments(sb):
    r = _roster_row()
    assert r["completed"] == 2        # DONE + DET (REJ excluded)
    assert r["pending"] == 1          # OPEN only — STALE's app left review
    assert r["assigned"] == 3         # completed + pending
    assert r["progress"] == "2 / 3"


def test_roster_batch_breakdown_sums_to_assigned(sb):
    r = _roster_row()
    assert sum(b["count"] for b in r["batches"]) == r["assigned"]


def test_drawer_lists_the_same_set_as_roster(sb):
    r = _roster_row()
    apps = admin_query.fetch_reviewer_applications(R)["applications"]
    assert len(apps) == r["assigned"]
    by_id = {a["id"]: a for a in apps}
    assert set(by_id) == {"DONE", "DET", "OPEN"}
    assert by_id["OPEN"]["reviewStatus"] == "pending"
    assert by_id["DET"]["reviewStatus"] == "submitted"
    assert by_id["DET"]["detached"] is True
    assert by_id["DET"]["assignment_id"] is None
    assert by_id["DONE"]["detached"] is False
