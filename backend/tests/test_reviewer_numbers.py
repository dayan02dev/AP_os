"""Reviewer portal numbers fix (2026-10-05) — contract C5 + REV-01/02/03/09/10/11/12
and the submit_review assignment-binding security fix.

Uses the router-level fake from test_reviewer (eq-filtering, in_ no-op) so
the services must filter/assemble in Python exactly like production code.
"""
from __future__ import annotations

from app.deps import get_current_user
from app.main import app

from tests.test_reviewer import (  # noqa: F401  (fixture re-export)
    _VALID_SUBMIT,
    _clear_overrides,
    _install_db,
    _override_user,
)

ME = "rev-1"


def _review(app_id, track="tir", submitted=True, reco="yes", **extra):
    row = {"id": f"rv-{app_id}", "application_id": app_id, "application_track": track,
           "reviewer_user_id": ME, "assignment_id": None,
           "score_problem": 7.0, "score_solution": 7.0, "score_tech": 7.0,
           "score_founders": 7.0, "score_commitment": 7.0,
           "recommendation": reco, "quick_notes": "ok",
           "submitted_at": "2026-07-01T00:00:00+00:00" if submitted else None,
           "locked_at": None}
    row.update(extra)
    return row


def _asg(asg_id, app_id, track="tir", **extra):
    row = {"id": asg_id, "application_id": app_id, "application_track": track,
           "reviewer_user_id": ME, "assigned_at": "2026-06-01T00:00:00Z",
           "due_at": None, "declined_at": None, "reassigned_to": None,
           "completed_at": None}
    row.update(extra)
    return row


def _tir(app_id, status, seq, **extra):
    row = {"id": app_id, "status": status, "display_seq": seq,
           "basic_org": f"Org {app_id}", "basic_full_name": "Founder",
           "submitted_at": "2026-05-01T00:00:00+00:00", "basic_teammates": []}
    row.update(extra)
    return row


# ─── REV-01 / C5: queue keeps detached submitted reviews ────────────────


def _queue_db(monkeypatch):
    return _install_db(monkeypatch, {
        "reviewer_assignments": [
            _asg("as-live", "live"),                 # live, not started
            _asg("as-rej-nr", "rej-noreview"),       # live, rejected, no review
            _asg("as-rej-r", "rej-reviewed"),        # live, rejected, reviewed
        ],
        "tir_applications": [
            _tir("live", "under_review", 1),
            _tir("rej-noreview", "rejected", 2),
            _tir("rej-reviewed", "rejected", 3),
            _tir("detached", "evaluated", 4),        # assignment row deleted
            _tir("detached-rej", "rejected", 5),     # assignment deleted + rejected
            _tir("draft-detached", "evaluated", 6),  # only a DRAFT, no assignment
        ],
        "sip_applications": [],
        "reviews": [
            _review("rej-reviewed"),
            _review("detached"),
            _review("detached-rej", reco="no"),
            _review("draft-detached", submitted=False),
            # another reviewer's review must never leak in
            {**_review("live"), "id": "other", "reviewer_user_id": "rev-other"},
        ],
        "ai_screening": [], "industry_categories": [],
        "admin_decisions": [], "ic_documents": [],
    })


def test_queue_includes_detached_submitted_reviews(client, monkeypatch, _clear_overrides):
    _queue_db(monkeypatch)
    app.dependency_overrides[get_current_user] = _override_user(ME)
    r = client.get("/reviewer/queue")
    assert r.status_code == 200, r.text
    rows = {x["id"]: x for x in r.json()}
    assert set(rows) == {"live", "rej-reviewed", "detached", "detached-rej"}

    assert rows["live"]["detached"] is False and rows["live"]["closed"] is False
    assert rows["live"]["reviewStatus"] == "not-started"

    assert rows["detached"]["detached"] is True
    assert rows["detached"]["assignmentId"] is None
    assert rows["detached"]["reviewStatus"] == "submitted"
    assert rows["detached"]["closed"] is False

    assert rows["detached-rej"]["closed"] is True
    assert rows["detached-rej"]["detached"] is True
    assert rows["rej-reviewed"]["closed"] is True
    assert rows["rej-reviewed"]["detached"] is False

    # Dashboard SUBMITTED now matches History.
    assert sum(1 for x in rows.values() if x["reviewStatus"] == "submitted") == 3


def test_queue_with_no_assignments_still_lists_submitted_reviews(
    client, monkeypatch, _clear_overrides,
):
    _install_db(monkeypatch, {
        "reviewer_assignments": [],
        "tir_applications": [_tir("detached", "evaluated", 4)],
        "sip_applications": [], "reviews": [_review("detached")],
        "ai_screening": [], "industry_categories": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(ME)
    r = client.get("/reviewer/queue")
    assert r.status_code == 200, r.text
    assert [x["id"] for x in r.json()] == ["detached"]


# ─── REV-10: myReco counts only submitted recommendations ───────────────


def test_queue_my_reco_only_when_submitted(client, monkeypatch, _clear_overrides):
    _install_db(monkeypatch, {
        "reviewer_assignments": [_asg("a1", "app1")],
        "tir_applications": [_tir("app1", "under_review", 1)],
        "sip_applications": [],
        "reviews": [_review("app1", submitted=False, reco="no")],
        "ai_screening": [], "industry_categories": [],
    })
    app.dependency_overrides[get_current_user] = _override_user(ME)
    row = client.get("/reviewer/queue").json()[0]
    assert row["reviewStatus"] == "draft"
    assert row["myReco"] is None
    assert row["myDraftReco"] == "no"


# ─── REV-02 / REV-09 / C5: history decision buckets, ids, can_edit ──────


def _history_db(monkeypatch):
    return _install_db(monkeypatch, {
        "reviews": [
            _review("p"), _review("g1r"), _review("g1s"), _review("fs"),
            _review("fr"), _review("off"), _review("onb"), _review("rej-nodec"),
        ],
        "tir_applications": [
            _tir("p", "evaluated", 1),
            _tir("g1r", "rejected", 2),
            _tir("g1s", "jury_review", 3),
            _tir("fs", "jury_review", 4),
            _tir("fr", "rejected", 5),
            _tir("off", "offered", 6),
            _tir("onb", "onboarded", 7),
            _tir("rej-nodec", "rejected", 8),
        ],
        "sip_applications": [],
        "ai_screening": [],
        "reviewer_assignments": [_asg("as-p", "p"), _asg("as-g1s", "g1s")],
        "admin_decisions": [
            {"application_id": "g1r", "application_track": "tir", "gate_stage": "gate1",
             "decision": "rejected", "decided_at": "2026-07-02T00:00:00Z"},
            {"application_id": "fr", "application_track": "tir", "gate_stage": "gate1",
             "decision": "shortlisted", "decided_at": "2026-07-02T00:00:00Z"},
            {"application_id": "fr", "application_track": "tir", "gate_stage": "gate2",
             "decision": "rejected", "decided_at": "2026-08-02T00:00:00Z"},
        ],
        "ic_documents": [
            # g1s: one current doc unsigned → still gate1_selected
            {"application_id": "g1s", "application_track": "tir", "superseded_at": None,
             "signed_storage_path": None},
            # fs: two current docs, both signed (+ an old unsigned superseded one)
            {"application_id": "fs", "application_track": "tir", "superseded_at": None,
             "signed_storage_path": "x-signed.pdf"},
            {"application_id": "fs", "application_track": "tir", "superseded_at": None,
             "signed_storage_path": "y-signed.pdf"},
            {"application_id": "fs", "application_track": "tir",
             "superseded_at": "2026-08-01T00:00:00Z", "signed_storage_path": None},
        ],
    })


def test_history_admin_decision_buckets(client, monkeypatch, _clear_overrides):
    _history_db(monkeypatch)
    app.dependency_overrides[get_current_user] = _override_user(ME)
    r = client.get("/reviewer/history")
    assert r.status_code == 200, r.text
    by_id = {x["appId"]: x for x in r.json()["rows"]}
    assert {k: v["adminDecision"] for k, v in by_id.items()} == {
        "p": "pending",
        "g1r": "gate1_rejected",
        "g1s": "gate1_selected",
        "fs": "final_selected",
        "fr": "final_rejected",
        "off": "offered",
        "onb": "onboarded",
        "rej-nodec": "gate1_rejected",
    }


def test_history_rows_carry_display_id_org_and_can_edit(client, monkeypatch, _clear_overrides):
    _history_db(monkeypatch)
    app.dependency_overrides[get_current_user] = _override_user(ME)
    by_id = {x["appId"]: x for x in client.get("/reviewer/history").json()["rows"]}
    assert by_id["p"]["applicationId"] == "TIR-1"
    assert by_id["p"]["org"] == "Org p"
    assert "movedToTrack" in by_id["p"]  # effective track for display/CSV
    # Live assignment + undecided → editable.
    assert by_id["p"]["canEdit"] is True
    # Live assignment but decided (jury_review) → not editable.
    assert by_id["g1s"]["canEdit"] is False
    # Undecided-but-detached would also be False; decided + detached → False.
    assert by_id["fr"]["canEdit"] is False


# ─── REV-03 / REV-11: content endpoint read-only ────────────────────────


def _content_db(monkeypatch, *, assignments, status, reviews):
    return _install_db(monkeypatch, {
        "reviewer_assignments": assignments,
        "tir_applications": [_tir("app1", status, 1)],
        "sip_applications": [], "reviews": reviews,
        "ai_screening": [], "industry_categories": [],
    })


def test_content_read_only_for_detached_submitted_review(client, monkeypatch, _clear_overrides):
    _content_db(monkeypatch, assignments=[], status="evaluated",
                reviews=[_review("app1")])
    app.dependency_overrides[get_current_user] = _override_user(ME)
    r = client.get("/reviewer/applications/tir/app1/content")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["read_only"] is True
    assert body["read_only_reason"] == "unassigned"
    assert body["assignment"] is None
    assert body["evaluation"]["id"] == "rv-app1"


def test_content_still_404_without_assignment_or_submitted_review(
    client, monkeypatch, _clear_overrides,
):
    _content_db(monkeypatch, assignments=[], status="evaluated",
                reviews=[_review("app1", submitted=False)])
    app.dependency_overrides[get_current_user] = _override_user(ME)
    r = client.get("/reviewer/applications/tir/app1/content")
    assert r.status_code == 404


def test_content_read_only_when_app_decided(client, monkeypatch, _clear_overrides):
    _content_db(monkeypatch, assignments=[_asg("a1", "app1")], status="rejected",
                reviews=[])
    app.dependency_overrides[get_current_user] = _override_user(ME)
    body = client.get("/reviewer/applications/tir/app1/content").json()
    assert body["read_only"] is True
    assert body["read_only_reason"] == "decided"
    assert body["app_status"] == "rejected"


def test_content_editable_when_assigned_and_open(client, monkeypatch, _clear_overrides):
    _content_db(monkeypatch, assignments=[_asg("a1", "app1")], status="under_review",
                reviews=[])
    app.dependency_overrides[get_current_user] = _override_user(ME)
    body = client.get("/reviewer/applications/tir/app1/content").json()
    assert body["read_only"] is False
    assert body["read_only_reason"] is None


# ─── submit_review: assignment binding (security) + decided gate ────────


def _submit_db(monkeypatch, *, asg=None, status="under_review"):
    return _install_db(monkeypatch, {
        "reviewer_assignments": [asg or {
            "id": "a1", "reviewer_user_id": "rev-a", "application_id": "app1",
            "application_track": "tir", "declined_at": None, "reassigned_to": None}],
        "tir_applications": [{"id": "app1", "status": status},
                             {"id": "app2", "status": "under_review"}],
        "sip_applications": [{"id": "app1", "status": "under_review"}],
        "reviews": [], "ai_screening": [], "application_status_log": [],
    })


def test_submit_rejects_assignment_for_a_different_application(
    client, monkeypatch, _clear_overrides,
):
    """Owning *an* assignment must not let a reviewer review any app."""
    fake = _submit_db(monkeypatch)
    app.dependency_overrides[get_current_user] = _override_user("rev-a")
    r = client.post("/reviewer/reviews", json={**_VALID_SUBMIT, "application_id": "app2"})
    assert r.status_code == 403, r.text
    assert r.json()["detail"]["code"] == "not_your_assignment"
    assert not [p for n, p in fake.inserts if n == "reviews"]


def test_submit_rejects_assignment_for_a_different_track(client, monkeypatch, _clear_overrides):
    _submit_db(monkeypatch)
    app.dependency_overrides[get_current_user] = _override_user("rev-a")
    r = client.post("/reviewer/reviews", json={**_VALID_SUBMIT, "application_track": "sip"})
    assert r.status_code == 403, r.text
    assert r.json()["detail"]["code"] == "not_your_assignment"


def test_submit_rejects_declined_assignment(client, monkeypatch, _clear_overrides):
    _submit_db(monkeypatch, asg={
        "id": "a1", "reviewer_user_id": "rev-a", "application_id": "app1",
        "application_track": "tir", "declined_at": "2026-06-01T00:00:00Z",
        "reassigned_to": None})
    app.dependency_overrides[get_current_user] = _override_user("rev-a")
    r = client.post("/reviewer/reviews", json=_VALID_SUBMIT)
    assert r.status_code == 403, r.text
    assert r.json()["detail"]["code"] == "not_your_assignment"


def test_submit_409_when_application_decided(client, monkeypatch, _clear_overrides):
    fake = _submit_db(monkeypatch, status="rejected")
    app.dependency_overrides[get_current_user] = _override_user("rev-a")
    r = client.post("/reviewer/reviews", json=_VALID_SUBMIT)
    assert r.status_code == 409, r.text
    assert r.json()["detail"]["code"] == "application_decided"
    assert not [p for n, p in fake.inserts if n == "reviews"]


def test_submit_happy_path_still_201(client, monkeypatch, _clear_overrides):
    _submit_db(monkeypatch)
    app.dependency_overrides[get_current_user] = _override_user("rev-a")
    r = client.post("/reviewer/reviews", json=_VALID_SUBMIT)
    assert r.status_code == 201, r.text


# ─── patch_review: decided / unassigned gates ───────────────────────────


def _patch_db(monkeypatch, *, assignments, status):
    return _install_db(monkeypatch, {
        "reviewer_assignments": assignments,
        "tir_applications": [_tir("app1", status, 1)],
        "sip_applications": [],
        "reviews": [_review("app1")],
        "ai_screening": [], "application_status_log": [],
    })


def test_patch_409_when_application_decided(client, monkeypatch, _clear_overrides):
    fake = _patch_db(monkeypatch, assignments=[_asg("a1", "app1")], status="jury_review")
    app.dependency_overrides[get_current_user] = _override_user(ME)
    r = client.patch("/reviewer/reviews/rv-app1", json={"score_problem": 8})
    assert r.status_code == 409, r.text
    assert r.json()["detail"]["code"] == "application_decided"
    assert not [u for n, u, _ in fake.updates if n == "reviews"]


def test_patch_409_when_assignment_removed(client, monkeypatch, _clear_overrides):
    fake = _patch_db(monkeypatch, assignments=[], status="evaluated")
    app.dependency_overrides[get_current_user] = _override_user(ME)
    r = client.patch("/reviewer/reviews/rv-app1", json={"score_problem": 8})
    assert r.status_code == 409, r.text
    assert r.json()["detail"]["code"] == "assignment_removed"
    assert not [u for n, u, _ in fake.updates if n == "reviews"]


def test_patch_ok_when_assigned_and_open(client, monkeypatch, _clear_overrides):
    _patch_db(monkeypatch, assignments=[_asg("a1", "app1")], status="evaluated")
    app.dependency_overrides[get_current_user] = _override_user(ME)
    r = client.patch("/reviewer/reviews/rv-app1", json={"score_problem": 8})
    assert r.status_code == 200, r.text


# ─── REV-12: rubric names match the slider labels ───────────────────────


def test_rubric_names_match_slider_labels():
    from app.services import rubric
    names = {d["key"]: d["name"] for d in rubric.get_rubric("tir")["dimensions"]}
    assert names == {
        "problem": "Problem Statement Impact and Importance",
        "solution": "Completeness, Depth of Solution",
        "tech": "Technical Depth",
        "founders": "Professional Profile of Founder",
        "commit": "Commitment to be fully available",
    }
