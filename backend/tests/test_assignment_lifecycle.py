"""Admin -> reviewer assignment lifecycle (bug swarm 2026-11-03, AF-1..AF-10,
RF-3; contract C4).

Each test seeds the hermetic FakeSupabase, performs an ADMIN write through the
real service function, then reads what the REVIEWER sees (fetch_queue) and
what the ADMIN sees (fetch_roster / fetch_reviewer_applications).

One draft rule across every unassign path: the assignment is removed, the
draft review row is kept in the DB but hidden from the reviewer queue, and it
comes back as the reviewer's draft if they are re-assigned.
"""
from __future__ import annotations

import pytest
from app.services import (
    admin_query,
    applications_query,
    reviewer_query,
    staff_exclusions,
)
from app.services import (
    batch_membership as bm,
)

from tests.fixtures.fake_supabase import FakeSupabase

R1, R2 = "rev-1", "rev-2"
SUB = "2026-10-20T00:00:00Z"


def _app(aid, status="under_review", seq=1):
    return {"id": aid, "status": status, "display_seq": seq, "basic_org": aid,
            "basic_full_name": aid, "moved_to_track": None,
            "submitted_at": "2026-07-01T00:00:00Z"}


def _asg(rid, aid, track="sip", due=None):
    return {"id": f"as-{rid}-{aid}", "application_id": aid, "application_track": track,
            "reviewer_user_id": rid, "declined_at": None, "reassigned_to": None,
            "assigned_at": "2026-10-01T00:00:00Z", "due_at": due}


def _review(rid, aid, track="sip", submitted=True):
    return {"id": f"rv-{rid}-{aid}", "application_id": aid, "application_track": track,
            "reviewer_user_id": rid, "submitted_at": SUB if submitted else None,
            "recommendation": "yes", "score_problem": 7, "score_solution": 7,
            "score_tech": 7, "score_founders": 7}


def _seed(**extra):
    base = {
        "user_roles": [{"user_id": u, "role": "reviewer"} for u in (R1, R2)],
        "profiles": [{"id": u, "full_name": u, "email": f"{u}@x.io"} for u in (R1, R2)],
        "reviewer_profiles": [{"reviewer_user_id": u, "weight": 1.0} for u in (R1, R2)],
        "batches": [{"id": "bA", "name": "Climate"}, {"id": "bB", "name": "Defense"}],
        "batch_reviewers": [],
        "application_batches": [],
        "reviewer_assignments": [],
        "reviews": [],
        "sip_applications": [_app("V1", seq=1), _app("V2", seq=2), _app("V3", seq=3)],
        "tir_applications": [_app("T1", seq=10)],
        "ai_screening": [],
        "industry_categories": [],
        "admin_decisions": [],
        "ic_documents": [],
        "application_status_log": [],
    }
    base.update(extra)
    return FakeSupabase(base)


@pytest.fixture
def patch_sb(monkeypatch):
    monkeypatch.setattr(staff_exclusions, "is_excluded", lambda *_a, **_k: False)
    monkeypatch.setattr(staff_exclusions, "visible", lambda rows, key="id": list(rows))

    def _install(sb):
        for mod in (admin_query, applications_query, reviewer_query):
            monkeypatch.setattr(mod, "get_admin_client", lambda: sb)
        return sb
    return _install


def _queue_ids(rid):
    return {r["id"]: r for r in reviewer_query.fetch_queue(rid)}


def _roster(rid):
    return {r["user_id"]: r for r in admin_query.fetch_roster()["reviewers"]}[rid]


def _batch_with(sb, batch_id, apps, reviewers, track="sip"):
    for aid in apps:
        sb.tables["application_batches"].append(
            {"id": f"ab-{batch_id}-{aid}", "application_id": aid,
             "application_track": track, "batch_id": batch_id})
        for rid in reviewers:
            sb.tables["reviewer_assignments"].append(_asg(rid, aid, track))
    for rid in reviewers:
        sb.tables["batch_reviewers"].append({"batch_id": batch_id, "reviewer_user_id": rid})


def _assignment_keys(sb, rid):
    return {(a["application_id"], a["application_track"])
            for a in sb.tables["reviewer_assignments"] if a["reviewer_user_id"] == rid}


# ─── AF-1 / AF-9: a draft review never pins a removed assignment ─────────────

def test_remove_reviewer_from_batch_removes_assignment_even_with_draft(patch_sb):
    sb = patch_sb(_seed())
    _batch_with(sb, "bA", ["V1", "V2"], [R1])
    sb.tables["reviews"].append(_review(R1, "V1", submitted=False))  # autosaved draft

    res = bm.remove_reviewer_from_batch(sb, "bA", R1, actor="admin")

    assert res["removed"] == 2 and res["kept_draft"] == 0
    assert _assignment_keys(sb, R1) == set()
    assert _queue_ids(R1) == {}, "removed-from-batch app must leave the reviewer queue"
    # draft row is kept in the DB (in-progress notes are not destroyed)
    assert any(r["id"] == "rv-rev-1-V1" for r in sb.tables["reviews"])
    row = _roster(R1)
    assert row["assigned"] == 0 and row["pending"] == 0
    assert row["batches"] == []


def test_remove_app_from_batch_removes_assignment_even_with_draft(patch_sb):
    sb = patch_sb(_seed())
    _batch_with(sb, "bA", ["V1"], [R1, R2])
    sb.tables["reviews"].append(_review(R2, "V1", submitted=False))

    res = bm.remove_app_from_batch(sb, "bA", "V1", "sip", actor="admin")

    assert res["assignments_removed"] == 2 and res["kept_draft"] == 0
    assert "V1" not in _queue_ids(R1)
    assert "V1" not in _queue_ids(R2)


def test_delete_batch_removes_assignment_even_with_draft(patch_sb):
    sb = patch_sb(_seed())
    _batch_with(sb, "bA", ["V1", "V2"], [R1])
    sb.tables["reviews"].append(_review(R1, "V2", submitted=False))

    res = bm.detach_batch_for_delete(sb, "bA")

    assert res["assignments_removed"] == 2 and res["kept_draft"] == 0
    assert _queue_ids(R1) == {}


def test_bulk_unassigned_path_same_draft_rule(patch_sb):
    sb = patch_sb(_seed())
    _batch_with(sb, "bA", ["V1"], [R1])
    sb.tables["reviews"].append(_review(R1, "V1", submitted=False))

    out = applications_query.detach_application_from_review(
        sb, "V1", "sip", remove_batch_link=True)

    assert out["assignments_removed"] == 1
    assert "V1" not in _queue_ids(R1)
    assert any(r["id"] == "rv-rev-1-V1" for r in sb.tables["reviews"])


def test_reassign_after_unassign_brings_draft_back(patch_sb):
    sb = patch_sb(_seed())
    _batch_with(sb, "bA", ["V1"], [R1])
    sb.tables["reviews"].append(_review(R1, "V1", submitted=False))
    bm.remove_reviewer_from_batch(sb, "bA", R1, actor="admin")
    assert "V1" not in _queue_ids(R1)

    res = admin_query.bulk_assign_reviewer_apps(
        R1, [{"application_id": "V1", "track": "sip"}], assigned_by="admin")
    assert res["results"][0]["status"] == "created"
    row = _queue_ids(R1)["V1"]
    assert row["detached"] is False and row["reviewStatus"] == "draft"


# ─── AF-2 / C4 / RF-3: submitted-then-unassigned rows are detached ──────────

def test_submitted_then_unassigned_row_is_detached_and_sorted_last(patch_sb):
    sb = patch_sb(_seed())
    _batch_with(sb, "bA", ["V1"], [R1])
    sb.tables["reviews"].append(_review(R1, "V1", submitted=True))
    # a live assignment with a due date far in the future
    sb.tables["reviewer_assignments"].append(_asg(R1, "V2", due="2099-01-01T00:00:00Z"))
    sb.tables["reviewer_assignments"].append(_asg(R1, "T1", track="tir"))

    bm.remove_reviewer_from_batch(sb, "bA", R1, actor="admin")

    rows = reviewer_query.fetch_queue(R1)
    assert [(r["id"], r["detached"]) for r in rows] == [
        ("V2", False), ("T1", False), ("V1", True)]
    v1 = rows[-1]
    assert v1["assignmentId"] is None and v1["reviewStatus"] == "submitted"


def test_queue_live_rows_before_detached_and_declined(patch_sb):
    sb = patch_sb(_seed())
    sb.tables["reviewer_assignments"] += [_asg(R1, "V1"), _asg(R1, "T1", track="tir")]
    declined = _asg(R1, "V3")
    declined["declined_at"] = "2026-10-01T00:00:00Z"
    sb.tables["reviewer_assignments"].append(declined)
    sb.tables["reviews"] += [_review(R1, "V2"), _review(R1, "V3")]

    rows = reviewer_query.fetch_queue(R1)
    flags = [r["detached"] for r in rows]
    assert flags == sorted(flags), "live rows must come before detached rows"
    assert {r["id"] for r in rows if r["detached"]} == {"V2", "V3"}


def test_draft_without_live_assignment_is_not_in_queue(patch_sb):
    sb = patch_sb(_seed())
    sb.tables["reviews"].append(_review(R1, "V1", submitted=False))
    assert _queue_ids(R1) == {}


# ─── AF-3: drawer Remove of a reviewed app really detaches it ───────────────

def test_drawer_remove_of_reviewed_app_detaches_and_can_be_reassigned(patch_sb):
    sb = patch_sb(_seed())
    sb.tables["reviewer_assignments"].append(_asg(R1, "V1"))
    sb.tables["reviews"].append(_review(R1, "V1"))

    r1 = admin_query.bulk_remove_reviewer_apps(R1, [{"application_id": "V1", "track": "sip"}])
    assert r1["results"][0]["status"] == "skipped_submitted"
    assert r1["results"][0]["review_kept"] is True
    assert sb.tables["reviewer_assignments"] == []

    # No longer part of the reviewer's work in the drawer / roster.
    assert admin_query.fetch_reviewer_applications(R1)["applications"] == []
    assert _roster(R1)["assigned"] == 0
    assert _queue_ids(R1)["V1"]["detached"] is True

    res = admin_query.bulk_assign_reviewer_apps(
        R1, [{"application_id": "V1", "track": "sip"}], assigned_by="admin")
    assert res["results"][0]["status"] == "created"
    row = _queue_ids(R1)["V1"]
    assert row["detached"] is False and row["reviewStatus"] == "submitted"
    apps = admin_query.fetch_reviewer_applications(R1)["applications"]
    assert [(a["id"], a["detached"], a["reviewStatus"]) for a in apps] == [
        ("V1", False, "submitted")]


# ─── AF-7: re-assigning after a decline works ───────────────────────────────

def test_declined_assignment_can_be_reassigned(patch_sb):
    sb = patch_sb(_seed())
    row = _asg(R1, "V1")
    row["declined_at"] = "2026-10-02T00:00:00Z"
    row["decline_reason"] = "conflict"
    sb.tables["reviewer_assignments"].append(row)

    res = admin_query.bulk_assign_reviewer_apps(
        R1, [{"application_id": "V1", "track": "sip"}], assigned_by="admin")

    assert res["results"][0]["status"] == "created"
    rows = [a for a in sb.tables["reviewer_assignments"] if a["reviewer_user_id"] == R1]
    assert len(rows) == 1  # revived in place (unique key), not a second row
    assert rows[0]["declined_at"] is None and rows[0]["decline_reason"] is None
    q = _queue_ids(R1)
    assert q["V1"]["detached"] is False


def test_active_assignment_still_reports_already_assigned(patch_sb):
    sb = patch_sb(_seed())
    sb.tables["reviewer_assignments"].append(_asg(R1, "V1"))
    res = admin_query.bulk_assign_reviewer_apps(
        R1, [{"application_id": "V1", "track": "sip"}], assigned_by="admin")
    assert res["results"][0]["status"] == "already_assigned"


# ─── AF-8: fan-out skips users without the reviewer role ────────────────────

def test_batch_fanout_skips_user_whose_reviewer_role_was_revoked(patch_sb):
    sb = patch_sb(_seed())
    sb.tables["batch_reviewers"] += [{"batch_id": "bA", "reviewer_user_id": R1},
                                     {"batch_id": "bA", "reviewer_user_id": R2}]
    sb.tables["user_roles"] = [r for r in sb.tables["user_roles"] if r["user_id"] != R2]

    res = bm.add_apps_to_batch(sb, "bA", [("V1", "sip")], actor="admin")

    assert {r["reviewer_user_id"] for r in res["created_rows"]} == {R1}
    assert _assignment_keys(sb, R2) == set()


# ─── AF-10: roster counts == reviewer queue default view ────────────────────

def test_roster_counts_match_queue_default_view(patch_sb):
    sb = patch_sb(_seed())
    sb.tables["sip_applications"][0]["status"] = "jury_review"  # V1 decided
    sb.tables["reviews"] += [_review(R1, "V1"), _review(R1, "V3"), _review(R1, "T1", "tir")]
    sb.tables["reviewer_assignments"] += [
        _asg(R1, "V1"),               # submitted, decided -> closed
        _asg(R1, "V2"),               # pending
        _asg(R1, "T1", track="tir"),  # submitted, live, open -> completed
    ]                                 # V3 submitted, unassigned -> detached

    row = _roster(R1)
    q = reviewer_query.fetch_queue(R1)
    visible = [s for s in q if not s["closed"] and not s["detached"]]
    assert row["assigned"] == len(visible) == 2
    assert row["completed"] == len([s for s in visible if s["reviewStatus"] == "submitted"]) == 1
    assert row["pending"] == 1
    drawer = admin_query.fetch_reviewer_applications(R1)["applications"]
    assert len(drawer) == row["assigned"]


# ─── Authz on a removed app (unchanged, guarded) ────────────────────────────

def test_removed_app_read_only_if_submitted_404_if_draft(patch_sb):
    sb = patch_sb(_seed())
    sb.tables["reviews"].append(_review(R1, "V1", submitted=True))
    sb.tables["reviews"].append(_review(R1, "V2", submitted=False))
    p1 = reviewer_query.fetch_application_for_reviewer(R1, "sip", "V1")
    assert p1["read_only"] is True and p1["read_only_reason"] == "unassigned"
    assert reviewer_query.fetch_application_for_reviewer(R1, "sip", "V2") is None
    assert reviewer_query.has_live_assignment(sb, R1, "sip", "V1") is False
