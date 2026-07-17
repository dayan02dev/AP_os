"""Reviewer queue myReco field (2026-07-17)."""
from __future__ import annotations

from app.services import reviewer_query

from tests.fixtures.fake_supabase import FakeSupabase


def test_reviewer_queue_exposes_my_reco(monkeypatch):
    sb = FakeSupabase({
        "reviewer_assignments": [
            {"id": "as1", "application_id": "A", "application_track": "tir",
             "reviewer_user_id": "rv1", "declined_at": None, "reassigned_to": None,
             "due_at": None},
        ],
        "tir_applications": [
            {"id": "A", "status": "under_review", "basic_full_name": "Asha R",
             "basic_org": "Acme", "display_seq": 26001},
        ],
        "ai_screening": [],
        "reviews": [
            {"application_id": "A", "application_track": "tir", "reviewer_user_id": "rv1",
             "submitted_at": "2026-07-01T00:00:00Z", "recommendation": "maybe",
             "score_problem": 6, "score_solution": 6, "score_tech": 6,
             "score_founders": 6, "score_commitment": 6},
        ],
        "industry_categories": [],
    })
    monkeypatch.setattr(reviewer_query, "get_admin_client", lambda: sb)
    rows = reviewer_query.fetch_queue("rv1")
    assert rows[0]["myReco"] == "maybe"


def test_reviewer_queue_my_reco_none_when_unreviewed(monkeypatch):
    sb = FakeSupabase({
        "reviewer_assignments": [
            {"id": "as1", "application_id": "A", "application_track": "tir",
             "reviewer_user_id": "rv1", "declined_at": None, "reassigned_to": None,
             "due_at": None},
        ],
        "tir_applications": [
            {"id": "A", "status": "under_review", "basic_full_name": "Asha R",
             "basic_org": "Acme", "display_seq": 26001},
        ],
        "ai_screening": [], "reviews": [], "industry_categories": [],
    })
    monkeypatch.setattr(reviewer_query, "get_admin_client", lambda: sb)
    rows = reviewer_query.fetch_queue("rv1")
    assert rows[0]["myReco"] is None
