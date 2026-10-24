"""Prod incident: batch "Defense" (40 'evaluated' VIP apps) assigned to R1.
Roster/drawer showed only the broken rows; non-member reviewers with old
reviews got a Defense chip. One shared reviewer-work definition now."""
from __future__ import annotations

import pytest

from app.services import admin_query, applications_query, reviewer_query
from tests.fixtures.fake_supabase import FakeSupabase

R1, R2, R3 = "r1", "r2", "r3"
SUB = "2026-07-02T00:00:00Z"


def _asg(rid, app, track="sip"):
    return {"id": f"as-{rid}-{app}", "application_id": app, "application_track": track,
            "reviewer_user_id": rid, "declined_at": None, "reassigned_to": None,
            "assigned_at": "2026-07-01T00:00:00Z"}


def _rv(rid, app, track="sip"):
    return {"application_id": app, "application_track": track, "reviewer_user_id": rid,
            "submitted_at": SUB, "recommendation": "yes", "score_problem": 7,
            "score_solution": 7, "score_tech": 7, "score_founders": 7,
            "score_commitment": 7}


def _backend():
    d = [f"D{i}" for i in range(40)]
    m = ["M0", "M1"]
    return FakeSupabase({
        "user_roles": [{"user_id": u, "role": "reviewer"} for u in (R1, R2, R3)],
        "profiles": [{"id": u, "full_name": u, "email": f"{u}@x.io"} for u in (R1, R2, R3)],
        "reviewer_profiles": [{"reviewer_user_id": u, "weight": 1.0} for u in (R1, R2, R3)],
        "sip_applications": [
            {"id": a, "status": "evaluated", "display_seq": 100 + i, "basic_org": a,
             "basic_full_name": a, "moved_to_track": None,
             "submitted_at": "2026-07-01T00:00:00Z"} for i, a in enumerate(d)],
        "tir_applications": [
            {"id": a, "status": "under_review", "display_seq": 500 + i, "basic_org": a,
             "basic_full_name": a, "submitted_at": "2026-07-01T00:00:00Z"}
            for i, a in enumerate(m)],
        "reviewer_assignments": [_asg(R1, a) for a in d]
                                + [_asg(R2, a, "tir") for a in m],
        "reviews": [_rv(R2, a) for a in d[:2]] + [_rv(R3, a) for a in d[2:38]],
        "batches": [{"id": "bD", "name": "Defense"}, {"id": "bM", "name": "Manufacturing"}],
        "batch_reviewers": [{"batch_id": "bD", "reviewer_user_id": R1},
                            {"batch_id": "bM", "reviewer_user_id": R2}],
        "application_batches": (
            [{"application_id": a, "application_track": "sip", "batch_id": "bD"} for a in d]
            + [{"application_id": a, "application_track": "tir", "batch_id": "bM"} for a in m]),
        "ai_screening": [],
    })


@pytest.fixture
def sb(monkeypatch):
    sb = _backend()
    for mod in (admin_query, applications_query, reviewer_query):
        monkeypatch.setattr(mod, "get_admin_client", lambda: sb)
    return sb


def _rows():
    return {r["user_id"]: r for r in admin_query.fetch_roster()["reviewers"]}


def test_roster_counts_evaluated_assignments_as_pending(sb):
    r = _rows()[R1]
    assert r["pending"] == 40 and r["assigned"] == 40 and r["completed"] == 0
    assert r["batches"] == [{"name": "Defense", "count": 40}]


def test_non_member_old_reviews_are_unbatched_not_defense(sb):
    rows = _rows()
    r2 = {b["name"]: b["count"] for b in rows[R2]["batches"]}
    assert "Defense" not in r2
    assert r2 == {"Manufacturing": 2, "Unbatched": 2}
    r3 = {b["name"]: b["count"] for b in rows[R3]["batches"]}
    assert r3 == {"Unbatched": 36}


def test_member_batch_chip_even_with_zero_work(sb):
    sb.tables["reviewer_assignments"] = [
        a for a in sb.tables["reviewer_assignments"] if a["reviewer_user_id"] != R2]
    assert {"name": "Manufacturing", "count": 0} in _rows()[R2]["batches"]


def test_drawer_matches_roster_for_everyone(sb):
    rows = _rows()
    for rid in (R1, R2, R3):
        apps = admin_query.fetch_reviewer_applications(rid)["applications"]
        assert len(apps) == rows[rid]["assigned"]
        assert sum(b["count"] for b in rows[rid]["batches"]) == len(apps)


def test_drawer_track_native_plus_effective_and_display_id(sb):
    sb.tables["sip_applications"][0]["moved_to_track"] = "sip"
    sb.tables["tir_applications"][0]["moved_to_track"] = "sip"
    apps = {a["id"]: a for a in admin_query.fetch_reviewer_applications(R2)["applications"]}
    assert apps["M0"]["track"] == "tir"
    assert apps["M0"]["effective_track"] == "sip"
    assert apps["M0"]["display_id"] == "TIR-500"
    assert apps["M1"]["effective_track"] == "tir"


def test_missing_app_row_is_not_work(sb):
    sb.tables["reviewer_assignments"].append(_asg(R1, "GHOST"))
    assert _rows()[R1]["assigned"] == 40
    ids = {a["id"] for a in admin_query.fetch_reviewer_applications(R1)["applications"]}
    assert "GHOST" not in ids


def test_queue_returns_all_evaluated_assignments(sb):
    assert len(reviewer_query.fetch_queue(R1)) == 40


def test_queue_hides_unreviewed_on_decided_apps(sb):
    for a in sb.tables["sip_applications"][:3]:
        a["status"] = "jury_review"
    assert len(reviewer_query.fetch_queue(R1)) == 37


def test_founder_names_include_vip_teammates():
    row = {"basic_full_name": "A", "basic_teammates": [{"fullName": "B"}, {"full_name": "C"}],
           "sip_founders": [{"name": "D"}]}
    assert reviewer_query._founder_names("sip", row) == ["A", "B", "C", "D"]


def _mixed_backend_statuses(sb, statuses):
    for app, st in zip(sb.tables["sip_applications"], statuses):
        app["status"] = st


@pytest.mark.parametrize("closed_status", ["withdrawn", "waitlisted", "jury_review"])
def test_roster_assigned_equals_open_queue_rows_for_mixed_statuses(sb, closed_status):
    # 40 apps: 10 evaluated, 10 under_review, 10 submitted, 10 closed.
    _mixed_backend_statuses(sb, ["evaluated"] * 10 + ["under_review"] * 10
                            + ["submitted"] * 10 + [closed_status] * 10)
    roster = _rows()[R1]
    queue = [q for q in reviewer_query.fetch_queue(R1)
             if not q["closed"] and not q["detached"]]
    assert roster["assigned"] == len(queue) == 30
    assert len(admin_query.fetch_reviewer_applications(R1)["applications"]) == 30


@pytest.mark.parametrize("st", ["withdrawn", "waitlisted"])
def test_withdrawn_waitlisted_are_closed(sb, st):
    assert not reviewer_query.is_open_for_review(st)
    sb.tables["sip_applications"][0]["status"] = st
    assert _rows()[R1]["pending"] == 39
    assert len(reviewer_query.fetch_queue(R1)) == 39


def test_drawer_and_batches_chunk_large_in_lists(sb, monkeypatch):
    n = 400
    ids = [f"L{i}" for i in range(n)]
    sb.tables["sip_applications"] += [
        {"id": a, "status": "evaluated", "display_seq": 900 + i, "basic_org": a}
        for i, a in enumerate(ids)]
    sb.tables["reviewer_assignments"] += [_asg(R1, a) for a in ids]
    sb.tables["application_batches"] += [
        {"application_id": a, "application_track": "sip", "batch_id": "bD"} for a in ids]
    sizes = []
    orig = type(sb.table("x")).in_

    def spy(self, col, vals):
        if self._name in ("application_batches", "batches", "sip_applications"):
            sizes.append(len(list(vals)))
        return orig(self, col, vals)

    monkeypatch.setattr(type(sb.table("x")), "in_", spy)
    apps = admin_query.fetch_reviewer_applications(R1)["applications"]
    assert len(apps) == 40 + n
    assert all(a["batch"] == "Defense" for a in apps)
    assert max(sizes) <= 150
