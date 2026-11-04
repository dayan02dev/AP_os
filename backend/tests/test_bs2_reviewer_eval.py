"""Swarm-2 (reviewer_eval) @ 837ccf0 — each `test_*` asserts the CORRECT
behaviour, so it FAILS while the bug it documents is present. `test_ok_*`
confirm a boundary that holds (they pass). Hermetic: FakeSupabase only."""
from __future__ import annotations

import pytest

from app.deps import get_current_user
from app.main import app
from app.services import applications_query

from tests.test_reviewer import _clear_overrides, _install_db, _override_user  # noqa: F401

ME = "rev-1"
OTHER = "rev-2"


def _asg(asg_id, app_id, reviewer=ME, track="tir", **extra):
    row = {"id": asg_id, "application_id": app_id, "application_track": track,
           "reviewer_user_id": reviewer, "assigned_at": "2026-06-01T00:00:00Z",
           "assigned_by": None, "due_at": None, "declined_at": None,
           "reassigned_to": None, "completed_at": None}
    row.update(extra)
    return row


def _app(app_id, status="under_review", seq=1, **extra):
    row = {"id": app_id, "status": status, "display_seq": seq,
           "basic_org": f"Org {app_id}", "basic_full_name": "Founder",
           "submitted_at": "2026-05-01T00:00:00+00:00", "basic_teammates": []}
    row.update(extra)
    return row


def _review(rid, app_id, reviewer=ME, submitted=True, track="tir", **extra):
    row = {"id": rid, "application_id": app_id, "application_track": track,
           "reviewer_user_id": reviewer, "assignment_id": None,
           "score_problem": 7.0, "score_solution": 7.0, "score_tech": 7.0,
           "score_founders": 7.0, "recommendation": "yes", "quick_notes": "ok",
           "flags": [], "disagree_with_ai": {},
           "submitted_at": "2026-07-01T00:00:00+00:00" if submitted else None,
           "locked_at": None}
    row.update(extra)
    return row


def _db(monkeypatch, **tables):
    base = {"reviewer_assignments": [], "reviews": [], "tir_applications": [],
            "sip_applications": [], "ai_screening": [], "admin_decisions": [],
            "ic_documents": [], "application_status_log": [], "profiles": [],
            "industry_categories": []}
    base.update(tables)
    return _install_db(monkeypatch, base)


SUBMIT = {
    "application_id": "app1", "application_track": "tir", "assignment_id": "a1",
    "score_problem": 7.0, "score_solution": 7.0, "score_tech": 7.0,
    "score_founders": 7.0, "recommendation": "yes",
    "quick_notes": "notes", "flags": [], "disagree_with_ai": {}, "draft": False,
}


# ─── boundaries that hold ───────────────────────────────────────────────

def test_ok_post_cross_app_with_own_assignment_403(client, monkeypatch, _clear_overrides):
    _db(monkeypatch, reviewer_assignments=[_asg("a1", "app1")],
        tir_applications=[_app("app1"), _app("app2", seq=2)])
    app.dependency_overrides[get_current_user] = _override_user(ME)
    r = client.post("/reviewer/reviews", json={**SUBMIT, "application_id": "app2"})
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "not_your_assignment"


def test_ok_post_wrong_track_with_own_assignment_403(client, monkeypatch, _clear_overrides):
    _db(monkeypatch, reviewer_assignments=[_asg("a1", "app1")],
        tir_applications=[_app("app1")])
    app.dependency_overrides[get_current_user] = _override_user(ME)
    r = client.post("/reviewer/reviews", json={**SUBMIT, "application_track": "sip"})
    assert r.status_code == 403


def test_ok_patch_other_reviewers_review_403(client, monkeypatch, _clear_overrides):
    _db(monkeypatch, reviewer_assignments=[_asg("a2", "app1", reviewer=OTHER)],
        tir_applications=[_app("app1")],
        reviews=[_review("rv-o", "app1", reviewer=OTHER)])
    app.dependency_overrides[get_current_user] = _override_user(ME)
    assert client.patch("/reviewer/reviews/rv-o", json={"recommendation": "no"}).status_code == 403


def test_ok_decline_other_reviewers_assignment_403(client, monkeypatch, _clear_overrides):
    _db(monkeypatch, reviewer_assignments=[_asg("a2", "app1", reviewer=OTHER)],
        tir_applications=[_app("app1")])
    app.dependency_overrides[get_current_user] = _override_user(ME)
    r = client.post("/reviewer/assignments/a2/decline", json={"reason": "not my area at all"})
    assert r.status_code == 403


def test_ok_panel_feedback_hidden_before_own_submit(client, monkeypatch, _clear_overrides):
    _db(monkeypatch, reviewer_assignments=[_asg("a1", "app1")],
        tir_applications=[_app("app1")],
        reviews=[_review("rv-me", "app1", submitted=False),
                 _review("rv-o", "app1", reviewer=OTHER, quick_notes="secret")])
    app.dependency_overrides[get_current_user] = _override_user(ME)
    body = client.get("/reviewer/applications/tir/app1/panel-feedback").json()
    assert body["available"] is False and body["reviews"] == []


def test_ok_panel_feedback_404_without_assignment_or_review(client, monkeypatch, _clear_overrides):
    _db(monkeypatch, reviewer_assignments=[_asg("a2", "app1", reviewer=OTHER)],
        tir_applications=[_app("app1")],
        reviews=[_review("rv-o", "app1", reviewer=OTHER)])
    app.dependency_overrides[get_current_user] = _override_user(ME)
    assert client.get("/reviewer/applications/tir/app1/panel-feedback").status_code == 404


# ─── REV-1: edits after submit are not audited ──────────────────────────

def test_edit_after_submit_is_audited(client, monkeypatch, _clear_overrides):
    """Re-open to edit autosaves PATCH the live submitted review; a yes->no
    reco change must leave an audit row (none is written)."""
    from app.routers import reviewer as rv
    audits = []
    fake = _db(monkeypatch, reviewer_assignments=[_asg("a1", "app1")],
               tir_applications=[_app("app1", status="evaluated")],
               reviews=[_review("rv1", "app1", recommendation="yes")])
    monkeypatch.setattr(rv, "write_audit", lambda **kw: audits.append(kw))
    app.dependency_overrides[get_current_user] = _override_user(ME)
    r = client.patch("/reviewer/reviews/rv1", json={"recommendation": "no", "draft": False})
    assert r.status_code == 200, r.text
    assert fake.tables["reviews"][0]["recommendation"] == "no"
    assert audits, "submitted review changed yes->no with no audit row"


# ─── REV-13: decline has no submitted / decided guard ──────────────────

def test_decline_refused_after_submit(client, monkeypatch, _clear_overrides):
    _db(monkeypatch, reviewer_assignments=[_asg("a1", "app1")],
        tir_applications=[_app("app1", status="evaluated")],
        reviews=[_review("rv1", "app1", assignment_id="a1")])
    app.dependency_overrides[get_current_user] = _override_user(ME)
    r = client.post("/reviewer/assignments/a1/decline", json={"reason": "changed my mind entirely"})
    assert r.status_code == 409, r.text


def test_decline_refused_on_decided_app(client, monkeypatch, _clear_overrides):
    _db(monkeypatch, reviewer_assignments=[_asg("a1", "app1")],
        tir_applications=[_app("app1", status="rejected")])
    app.dependency_overrides[get_current_user] = _override_user(ME)
    r = client.post("/reviewer/assignments/a1/decline", json={"reason": "too late to decline this"})
    assert r.status_code == 409, r.text


# ─── REV-14: notes unbounded ───────────────────────────────────────────

def test_quick_notes_capped(client, monkeypatch, _clear_overrides):
    _db(monkeypatch, reviewer_assignments=[_asg("a1", "app1")], tir_applications=[_app("app1")])
    app.dependency_overrides[get_current_user] = _override_user(ME)
    r = client.post("/reviewer/reviews", json={**SUBMIT, "quick_notes": "x" * 200_000})
    assert r.status_code == 422, r.status_code


# ─── REV-12: re-assigned draft flip completes the dead assignment ──────

def test_reassigned_draft_flip_marks_live_assignment_complete(client, monkeypatch, _clear_overrides):
    fake = _db(monkeypatch, reviewer_assignments=[_asg("a-new", "app1")],
               tir_applications=[_app("app1")],
               reviews=[_review("rv1", "app1", submitted=False, assignment_id="a-old")])
    app.dependency_overrides[get_current_user] = _override_user(ME)
    r = client.patch("/reviewer/reviews/rv1", json={"draft": False})
    assert r.status_code == 200, r.text
    assert fake.tables["reviewer_assignments"][0]["completed_at"] is not None


# ─── REV-10: post-commit auto-transition failure fails the request ─────

def test_auto_transition_failure_does_not_fail_committed_submit(client, monkeypatch, _clear_overrides):
    from fastapi import HTTPException
    from app.services import state_machine
    fake = _db(monkeypatch, reviewer_assignments=[_asg("a1", "app1")], tir_applications=[_app("app1")])

    def boom(*a, **k):
        raise HTTPException(status_code=422, detail={"code": "illegal_transition"})
    monkeypatch.setattr(state_machine, "apply_status_change", boom)
    app.dependency_overrides[get_current_user] = _override_user(ME)
    r = client.post("/reviewer/reviews", json=SUBMIT)
    assert fake.tables["reviews"][0]["submitted_at"]  # the review committed
    assert r.status_code == 201, r.status_code


# ─── REV-9: duplicate insert race is 502, not the recoverable 409 ──────

def test_duplicate_insert_race_returns_409(client, monkeypatch, _clear_overrides):
    fake = _db(monkeypatch, reviewer_assignments=[_asg("a1", "app1")], tir_applications=[_app("app1")])
    orig_table = fake.table

    def table(name):
        q = orig_table(name)
        if name == "reviews":
            def insert(payload):
                raise Exception('duplicate key value violates unique constraint "reviews_application_id_application_track_reviewer_user_id_key"')
            q.insert = insert
        return q
    fake.table = table
    app.dependency_overrides[get_current_user] = _override_user(ME)
    r = client.post("/reviewer/reviews", json=SUBMIT)
    assert r.status_code == 409, r.text


# ─── REV-4: waitlisted / withdrawn read-only but bucketed 'pending' ────

@pytest.mark.parametrize("status", ["waitlisted", "withdrawn"])
def test_decided_waitlisted_withdrawn_bucket_not_pending(client, monkeypatch, _clear_overrides, status):
    _db(monkeypatch, reviewer_assignments=[_asg("a1", "app1")],
        tir_applications=[_app("app1", status=status)],
        reviews=[_review("rv1", "app1")])
    app.dependency_overrides[get_current_user] = _override_user(ME)
    body = client.get("/reviewer/applications/tir/app1/content").json()
    assert body["read_only_reason"] == "decided"
    assert body["admin_decision"] != "pending"  # FE banner: 'Decision already made (Awaiting admin)'


# ─── REV-7: unassigned DRAFT becomes unreachable ───────────────────────


# ─── NEW: panel-feedback DB failure reported as 'no feedback yet' ──────

def test_panel_feedback_db_error_not_reported_as_empty(client, monkeypatch, _clear_overrides):
    """fetch_reviews_for / fetch_admin_decisions_for swallow DB errors and
    return [], so a transient failure renders 'No feedback from other
    reviewers or admins yet.' although two other reviews exist."""
    _db(monkeypatch, reviewer_assignments=[_asg("a1", "app1")],
        tir_applications=[_app("app1", status="evaluated")],
        reviews=[_review("rv-me", "app1"),
                 _review("rv-o", "app1", reviewer=OTHER, quick_notes="weak team")])

    def broken():
        raise RuntimeError("PostgREST 503")
    monkeypatch.setattr(applications_query, "get_admin_client", broken)
    app.dependency_overrides[get_current_user] = _override_user(ME)
    r = client.get("/reviewer/applications/tir/app1/panel-feedback")
    body = r.json() if r.status_code == 200 else {}
    # Correct: a 5xx (FE then stays quiet) or an explicit degraded flag —
    # never an authoritative 'available, no reviews'.
    assert r.status_code >= 500 or body.get("degraded") is True, body
