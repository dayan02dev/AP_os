"""GET /reviewer/applications/{track}/{id}/panel-feedback (contract C2).

A reviewer sees the OTHER panel reviewers' submitted feedback and the
human-written admin rationales, only after submitting their own review."""
from __future__ import annotations

import pytest

from app.deps import get_current_user
from app.main import app
from app.services import applications_query, reviewer_query
from tests.fixtures.fake_supabase import FakeSupabase

APP = "11111111-1111-1111-1111-111111111111"
OTHER_APP = "22222222-2222-2222-2222-222222222222"
ME, PEER, DRAFTER, OUTSIDER = "rev-me", "rev-peer", "rev-drafter", "rev-outsider"
ADMIN = "adm-1"

REVIEW_KEYS = {"id", "reviewer_name", "recommendation", "quick_notes", "strengths",
               "concerns", "comments", "flags", "disagree_with_ai", "submitted_at",
               "score_problem", "score_solution", "score_tech", "score_founders", "overall"}
DECISION_KEYS = {"id", "gate_stage", "decision", "rationale", "decided_by",
                 "decided_by_name", "decided_at"}


def _review(rid, uid, submitted, notes, app_id=APP, track="tir"):
    return {"id": rid, "application_id": app_id, "application_track": track,
            "reviewer_user_id": uid, "submitted_at": submitted,
            "score_problem": 8, "score_solution": 7, "score_tech": 6, "score_founders": 7,
            "score_commitment": 9, "recommendation": "yes", "quick_notes": notes,
            "flags": ["F1"], "disagree_with_ai": {"tech": "why"}, "strengths": "S",
            "concerns": "C", "comments": None}


def _asg(aid, uid, app_id=APP, **kw):
    return {"id": aid, "application_id": app_id, "application_track": "tir",
            "reviewer_user_id": uid, "assigned_at": "2026-09-01T00:00:00Z", **kw}


def _decision(did, rationale, at):
    return {"id": did, "application_id": APP, "application_track": "tir", "gate_stage": "gate1",
            "decision": "on_hold", "rationale": rationale, "decided_by": ADMIN, "decided_at": at}


def _tables():
    return {
        "tir_applications": [{"id": APP, "status": "evaluated"},
                             {"id": OTHER_APP, "status": "evaluated"}],
        "sip_applications": [],
        "reviews": [
            _review("rv-me", ME, "2026-10-01T00:00:00Z", "MY-NOTE"),
            _review("rv-peer", PEER, "2026-10-02T00:00:00Z", "PEER-NOTE"),
            _review("rv-draft", DRAFTER, None, "DRAFT-NOTE"),
            _review("rv-x", OUTSIDER, "2026-10-02T00:00:00Z", "OTHER-APP", app_id=OTHER_APP),
        ],
        "reviewer_assignments": [
            _asg("as-me", ME), _asg("as-peer", PEER), _asg("as-draft", DRAFTER),
            _asg("as-out", OUTSIDER, app_id=OTHER_APP),
        ],
        "admin_decisions": [
            _decision("d1", "Strong team, revisit after pilot data.", "2026-10-03T00:00:00Z"),
            _decision("d2", "gate1: on_hold", "2026-10-04T00:00:00Z"),
            _decision("d3", "Batch decision — rejected", "2026-10-05T00:00:00Z"),
            _decision("d4", "Admin override: shortlisted", "2026-10-06T00:00:00Z"),
            _decision("d5", "   ", "2026-10-07T00:00:00Z"),
            _decision("d6", None, "2026-10-08T00:00:00Z"),
            _decision("d7", "Gate2 : offered", "2026-10-09T00:00:00Z"),
            _decision("d8", "Market sizing needs work.", "2026-10-10T00:00:00Z"),
        ],
        "profiles": [
            {"id": ME, "full_name": "Me Myself", "email": "me@x.io"},
            {"id": PEER, "full_name": "Pat Peer", "email": "peer@x.io"},
            {"id": DRAFTER, "full_name": None, "email": "drafter@x.io"},
            {"id": ADMIN, "full_name": None, "email": "admin@x.io"},
        ],
    }


@pytest.fixture
def db(monkeypatch):
    sb = FakeSupabase(_tables())
    for mod in (applications_query, reviewer_query):
        monkeypatch.setattr(mod, "get_admin_client", lambda: sb)
    from app.routers import reviewer as rv
    monkeypatch.setattr(rv, "get_admin_client", lambda: sb)
    yield sb
    app.dependency_overrides.clear()


def _get(client, uid, track="tir", app_id=APP, roles=("reviewer",)):
    app.dependency_overrides[get_current_user] = lambda: {
        "user_id": uid, "email": f"{uid}@x.io", "roles": list(roles)}
    return client.get(f"/reviewer/applications/{track}/{app_id}/panel-feedback",
                      headers={"Authorization": "Bearer t"})


def test_outsider_gets_404(client, db):
    res = _get(client, OUTSIDER)
    assert res.status_code == 404
    assert res.json()["detail"] == {"code": "not_found"}


def test_not_reviewer_role_is_forbidden(client, db):
    assert _get(client, ME, roles=("applicant",)).status_code == 403


def test_bad_track_is_rejected(client, db):
    assert _get(client, ME, track="xyz").status_code == 422


def test_assigned_but_not_submitted_is_unavailable(client, db):
    res = _get(client, DRAFTER)
    assert res.status_code == 200
    assert res.json() == {"available": False, "reason": "submit_first",
                          "reviews": [], "admin_decisions": []}


def test_submitted_sees_other_submitted_reviews_only(client, db):
    body = _get(client, ME).json()
    assert body["available"] is True
    assert [r["id"] for r in body["reviews"]] == ["rv-peer"]   # not mine, not draft
    r = body["reviews"][0]
    assert set(r) == REVIEW_KEYS
    assert r["reviewer_name"] == "Pat Peer"
    assert r["quick_notes"] == "PEER-NOTE"
    peer_row = next(x for x in db.tables["reviews"] if x["id"] == "rv-peer")
    assert r["overall"] == reviewer_query._weighted_overall(peer_row)


def test_admin_decisions_drop_auto_and_empty_rationales(client, db):
    body = _get(client, ME).json()
    assert [d["id"] for d in body["admin_decisions"]] == ["d8", "d1"]
    assert all(set(d) == DECISION_KEYS for d in body["admin_decisions"])


def test_payload_never_contains_emails(client, db):
    body = _get(client, PEER).json()
    assert body["available"] is True
    assert "@" not in repr(body)
    assert [r["id"] for r in body["reviews"]] == ["rv-me"]
    assert body["admin_decisions"][0]["decided_by_name"] is None   # admin has email only


def test_nameless_reviewer_never_falls_back_to_email(client, db):
    db.tables["reviews"].append(
        _review("rv-anon", DRAFTER + "2", "2026-10-03T00:00:00Z", "ANON"))
    db.tables["profiles"].append({"id": DRAFTER + "2", "full_name": None, "email": "anon@x.io"})
    body = _get(client, ME).json()
    anon = next(r for r in body["reviews"] if r["id"] == "rv-anon")
    assert "@" not in (anon["reviewer_name"] or "")


def test_detached_but_submitted_reviewer_still_allowed(client, db):
    db.tables["reviewer_assignments"] = [a for a in db.tables["reviewer_assignments"]
                                         if a["reviewer_user_id"] != ME]
    body = _get(client, ME).json()
    assert body["available"] is True
    assert [r["id"] for r in body["reviews"]] == ["rv-peer"]


def test_reviews_on_other_apps_never_leak(client, db):
    body = _get(client, ME).json()
    assert "OTHER-APP" not in repr(body)
