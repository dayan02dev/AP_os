"""Swarm-2 (reviewer_queue) — tests assert CORRECT behaviour, so each fails on
the bug it documents. Hermetic: FakeSupabase only."""
from __future__ import annotations

import pytest

from app.services import reviewer_query
from tests.fixtures.fake_supabase import FakeSupabase, _Query

RV = "rv1"


def _asg(app_id, track="tir", rid="as-" ):
    return {"id": rid + app_id, "application_id": app_id, "application_track": track,
            "reviewer_user_id": RV, "declined_at": None, "reassigned_to": None,
            "due_at": None}


def _review(app_id, track="tir", submitted=True, **scores):
    base = {"id": "rv-" + app_id, "application_id": app_id, "application_track": track,
            "reviewer_user_id": RV,
            "submitted_at": "2026-10-01T00:00:00Z" if submitted else None,
            "recommendation": "yes",
            "score_problem": 7, "score_solution": 7, "score_tech": 7, "score_founders": 7}
    base.update(scores)
    return base


def _app(app_id, status="under_review", seq=27001):
    return {"id": app_id, "status": status, "basic_org": "Org " + app_id,
            "basic_full_name": "F " + app_id, "display_seq": seq}


class _RaisingSupabase(FakeSupabase):
    """FakeSupabase whose reads of `bad_table` raise (transient DB error)."""

    def __init__(self, tables, bad_table):
        super().__init__(tables)
        self._bad = bad_table

    def table(self, name):
        q = _Query(self.tables, name)
        if name == self._bad:
            def boom(*_a, **_k):
                raise RuntimeError("PostgREST 503")
            q.execute = boom
        return q


def _world(**extra):
    t = {
        "reviewer_assignments": [_asg("A")],
        "tir_applications": [_app("A")],
        "sip_applications": [],
        "reviews": [_review("A")],
        "ai_screening": [],
        "industry_categories": [],
        "admin_decisions": [],
        "ic_documents": [],
    }
    t.update(extra)
    return t


# ── 1. NEW: a reviews-read failure silently reports submitted work as "Not started"
def test_queue_reviews_read_failure_does_not_masquerade_as_not_started(monkeypatch):
    sb = _RaisingSupabase(_world(), bad_table="reviews")
    monkeypatch.setattr(reviewer_query, "get_admin_client", lambda: sb)
    try:
        rows = reviewer_query.fetch_queue(RV)
    except Exception:
        return  # failing loudly (-> 5xx / ErrorState) is acceptable
    # The reviewer DID submit app A. A 200 that says "not-started" (and drops
    # myScore/myReco) is wrong data, not an outage signal.
    assert rows[0]["reviewStatus"] == "submitted", rows[0]


# ── 2. NEW: an assignments-read failure returns 200 [] -> "No applications assigned."
def test_queue_assignments_read_failure_is_not_an_empty_queue(monkeypatch):
    sb = _RaisingSupabase(_world(), bad_table="reviewer_assignments")
    monkeypatch.setattr(reviewer_query, "get_admin_client", lambda: sb)
    with pytest.raises(Exception):
        reviewer_query.fetch_queue(RV)


# ── 3. NEW: an app-table read failure silently drops every row of that track
def test_queue_app_table_read_failure_does_not_silently_drop_rows(monkeypatch):
    sb = _RaisingSupabase(_world(), bad_table="tir_applications")
    monkeypatch.setattr(reviewer_query, "get_admin_client", lambda: sb)
    try:
        rows = reviewer_query.fetch_queue(RV)
    except Exception:
        return
    assert [r["id"] for r in rows] == ["A"]


# ── REV-5 (still open): advanced apps are flagged closed (shown as red "Closed",
# hidden by default, tooltip says "rejected")

# ── REV-16 (still open): a draft's default 5.0 sliders show as "My Score 5.0"
def test_rev16_draft_has_no_my_score(monkeypatch):
    sb = FakeSupabase(_world(reviews=[_review("A", submitted=False, score_problem=5.0,
                                               score_solution=5.0, score_tech=5.0,
                                               score_founders=5.0)]))
    monkeypatch.setattr(reviewer_query, "get_admin_client", lambda: sb)
    rows = reviewer_query.fetch_queue(RV)
    assert rows[0]["reviewStatus"] == "draft"
    assert rows[0]["myScore"] is None


# ── REV-4 (still open): waitlisted/withdrawn read as "pending" (Awaiting admin)
@pytest.mark.parametrize("status", ["waitlisted", "withdrawn"])
def test_rev4_waitlisted_withdrawn_history_bucket_not_pending(monkeypatch, status):
    sb = FakeSupabase(_world(tir_applications=[_app("A", status=status)]))
    monkeypatch.setattr(reviewer_query, "get_admin_client", lambda: sb)
    h = reviewer_query.fetch_history(RV)
    row = h["rows"][0]
    assert row["canEdit"] is False
    assert row["adminDecision"] != "pending"
