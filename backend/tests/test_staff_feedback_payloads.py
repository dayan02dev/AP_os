"""Staff detail payloads (contract C1): leadership + admin detail carry ONLY
submitted reviews (FD-4) and the full admin_decisions history (FD-3/FD-6)."""
import asyncio

import pytest

from tests.fixtures.fake_supabase import FakeSupabase
from app.services import applications_query, admin_query, reviewer_query, stats, staff_exclusions
from app.routers import leadership

APP = "11111111-1111-1111-1111-111111111111"
R1, R2, R3 = ("aaaaaaaa-0000-0000-0000-000000000001", "aaaaaaaa-0000-0000-0000-000000000002",
              "aaaaaaaa-0000-0000-0000-000000000003")
ADMIN = "bbbbbbbb-0000-0000-0000-000000000001"


def _review(uid, submitted, notes):
    return {"id": f"rv-{uid[-1]}", "application_id": APP, "application_track": "tir",
            "reviewer_user_id": uid, "submitted_at": submitted, "status": "draft",
            "score_problem": 8, "score_solution": 7, "score_tech": 6, "score_founders": 7,
            "score_commitment": 9, "recommendation": "yes", "quick_notes": notes,
            "flags": ["F1"], "disagree_with_ai": {"tech": "why"}, "strengths": None,
            "concerns": None, "comments": None}


def _tables():
    return {
        "tir_applications": [{"id": APP, "status": "evaluated", "display_seq": 7,
                              "basic_full_name": "F", "basic_email": "f@x.io"}],
        "sip_applications": [],
        "reviews": [_review(R1, "2026-10-01T00:00:00Z", "R1-NOTE"),
                    _review(R2, "2026-10-02T00:00:00Z", "R2-NOTE"),
                    _review(R3, None, "R3-DRAFT-NOTE")],
        "reviewer_assignments": [
            {"id": "as1", "application_id": APP, "application_track": "tir", "reviewer_user_id": R1,
             "assigned_at": "2026-09-01T00:00:00Z", "completed_at": "2026-10-01T00:00:00Z"},
            {"id": "as3", "application_id": APP, "application_track": "tir", "reviewer_user_id": R3,
             "assigned_at": "2026-09-01T00:00:00Z"}],
        "admin_decisions": [
            {"id": "d1", "application_id": APP, "application_track": "tir", "gate_stage": "gate1",
             "decision": "on_hold", "rationale": "ADMIN-OLD-RATIONALE", "decided_by": ADMIN,
             "decided_at": "2026-10-03T00:00:00Z"},
            {"id": "d2", "application_id": APP, "application_track": "tir", "gate_stage": "gate1",
             "decision": "shortlisted", "rationale": "ADMIN-NEW-RATIONALE", "decided_by": ADMIN,
             "decided_at": "2026-10-04T00:00:00Z"},
            # other app / other track: never leaks in
            {"id": "dx", "application_id": APP, "application_track": "sip", "gate_stage": "gate1",
             "decision": "rejected", "rationale": "OTHER-TRACK", "decided_by": ADMIN,
             "decided_at": "2026-10-05T00:00:00Z"}],
        "application_status_log": [
            {"id": "h1", "application_id": APP, "application_track": "tir", "from_status": "evaluated",
             "to_status": "on_hold", "changed_by": ADMIN, "changed_at": "2026-10-03T00:00:00Z",
             "reason": "ADMIN-OLD-RATIONALE"}],
        "profiles": [{"id": R1, "full_name": "Asha"}, {"id": R2, "full_name": "Ben"},
                     {"id": R3, "full_name": "Cara"},
                     {"id": ADMIN, "full_name": "Admin A", "email": "admin@x.io"}],
        "reviewer_profiles": [], "application_admin_meta": [], "application_batches": [],
        "batches": [], "ai_screening": [], "staff_exclusions": [],
    }


@pytest.fixture
def fake(monkeypatch):
    sb = FakeSupabase(_tables())
    for mod in (applications_query, admin_query, reviewer_query, stats, leadership):
        monkeypatch.setattr(mod, "get_admin_client", lambda: sb)
    monkeypatch.setattr(staff_exclusions, "is_excluded", lambda _id: False)
    return sb


C1_DECISION_KEYS = {"id", "gate_stage", "decision", "rationale", "decided_by",
                    "decided_by_name", "decided_at"}


def test_fetch_admin_decisions_for_newest_first_with_names(fake):
    rows = applications_query.fetch_admin_decisions_for(APP, "tir")
    assert [r["id"] for r in rows] == ["d2", "d1"]
    assert all(set(r) == C1_DECISION_KEYS for r in rows)
    assert rows[0]["decided_by_name"] == "Admin A"
    assert rows[0]["rationale"] == "ADMIN-NEW-RATIONALE"


def test_fetch_admin_decisions_for_is_failure_tolerant(monkeypatch):
    class Boom:
        def table(self, _n): raise RuntimeError("db down")
    monkeypatch.setattr(applications_query, "get_admin_client", lambda: Boom())
    assert applications_query.fetch_admin_decisions_for(APP, "tir") == []


def test_leadership_detail_submitted_reviews_only_and_admin_decisions(fake):
    out = asyncio.run(leadership.get_application_detail(APP))
    notes = sorted(r.get("quick_notes") for r in out["reviews"])
    assert notes == ["R1-NOTE", "R2-NOTE"]          # draft R3 dropped (FD-4)
    assert all(r.get("submitted_at") for r in out["reviews"])
    for r in out["reviews"]:
        for k in ("recommendation", "quick_notes", "strengths", "concerns", "comments",
                  "flags", "disagree_with_ai", "submitted_at", "score_problem",
                  "score_solution", "score_tech", "score_founders", "reviewer_name"):
            assert k in r
    assert [d["id"] for d in out["admin_decisions"]] == ["d2", "d1"]
    assert out["admin_decisions"][0]["decided_by_name"] == "Admin A"
    # The draft reviewer is still listed as an assigned (pending) reviewer.
    assert {a["reviewer_user_id"] for a in out["reviewer_assignments"]} >= {R1, R3}


def test_admin_detail_submitted_reviews_only_and_admin_decisions(fake):
    out = admin_query.fetch_detail("tir", APP)
    assert out["decision"]["rationale"] == "ADMIN-NEW-RATIONALE"
    assert all(r.get("submitted_at") for r in out["reviews"])
    assert sorted(r["quick_notes"] for r in out["reviews"]) == ["R1-NOTE", "R2-NOTE"]
    assert [d["id"] for d in out["admin_decisions"]] == ["d2", "d1"]
    assert all(set(d) == C1_DECISION_KEYS for d in out["admin_decisions"])


def test_vip_memo_generation_receives_submitted_reviews_only(fake, monkeypatch):
    fake.tables["sip_applications"] = [dict(fake.tables["tir_applications"][0])]
    fake.tables["tir_applications"] = []
    for r in fake.tables["reviews"]:
        r["application_track"] = "sip"
    seen = {}
    monkeypatch.setattr(leadership.vip_memo, "PILOT_APPLICATION_IDS", {APP})
    monkeypatch.setattr(leadership.vip_memo, "generate_memo",
                        lambda app, ai, reviews: seen.setdefault("reviews", reviews) and {})
    asyncio.run(leadership.generate_vip_memo(APP))
    assert sorted(r["quick_notes"] for r in seen["reviews"]) == ["R1-NOTE", "R2-NOTE"]
