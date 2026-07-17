"""Tests for the review-recommendation columns feature (2026-07-17).

Covers the shared _fetch_review_stats aggregator, the reco_matches filter
helper, the _fetch_reviewer_scores back-compat wrapper, the admin pipeline +
leadership list field attachment/filtering, and the reviewer queue myReco.
"""
from __future__ import annotations

import asyncio

from app.services import admin_query, applications_query

from tests.fixtures.fake_supabase import FakeSupabase


def _stats_backend():
    """FakeSupabase seeded for _fetch_review_stats: two apps, mixed recos."""
    return FakeSupabase({
        "reviewer_profiles": [
            {"reviewer_user_id": "rv1", "weight": 1.0},
            {"reviewer_user_id": "rv2", "weight": 1.0},
        ],
        "reviews": [
            # app A: two submitted reviews (yes, no), both fully scored
            {"application_id": "A", "application_track": "tir", "reviewer_user_id": "rv1",
             "submitted_at": "2026-07-01T00:00:00Z", "recommendation": "yes",
             "score_problem": 8, "score_solution": 8, "score_tech": 8,
             "score_founders": 8, "score_commitment": 8},
            {"application_id": "A", "application_track": "tir", "reviewer_user_id": "rv2",
             "submitted_at": "2026-07-02T00:00:00Z", "recommendation": "no",
             "score_problem": 4, "score_solution": 4, "score_tech": 4,
             "score_founders": 4, "score_commitment": 4},
            # app B: one submitted (maybe) + one DRAFT (ignored)
            {"application_id": "B", "application_track": "tir", "reviewer_user_id": "rv1",
             "submitted_at": "2026-07-03T00:00:00Z", "recommendation": "maybe",
             "score_problem": 6, "score_solution": 6, "score_tech": 6,
             "score_founders": 6, "score_commitment": 6},
            {"application_id": "B", "application_track": "tir", "reviewer_user_id": "rv2",
             "submitted_at": None, "recommendation": "yes"},
        ],
        "reviewer_assignments": [
            {"application_id": "A", "application_track": "tir", "reviewer_user_id": "rv1",
             "declined_at": None, "reassigned_to": None},
            {"application_id": "A", "application_track": "tir", "reviewer_user_id": "rv2",
             "declined_at": None, "reassigned_to": None},
            {"application_id": "B", "application_track": "tir", "reviewer_user_id": "rv1",
             "declined_at": None, "reassigned_to": None},
            {"application_id": "B", "application_track": "tir", "reviewer_user_id": "rv2",
             "declined_at": None, "reassigned_to": None},
        ],
    })


def test_review_stats_counts_and_reco(monkeypatch):
    monkeypatch.setattr(admin_query, "get_admin_client", lambda: _stats_backend())
    out = admin_query._fetch_review_stats([("tir", "A"), ("tir", "B")])

    a = out[("tir", "A")]
    assert a["submitted"] == 2
    assert a["assigned"] == 2
    assert a["reco"] == {"yes": 1, "maybe": 0, "no": 1}
    assert a["score"] == 6.0  # weighted mean of 8.0 and 4.0 == 6.0

    b = out[("tir", "B")]
    assert b["submitted"] == 1        # the draft review is excluded
    assert b["assigned"] == 2
    assert b["reco"] == {"yes": 0, "maybe": 1, "no": 0}


def test_review_stats_submitted_can_exceed_assigned(monkeypatch):
    # A reviewer submitted, then their assignment was removed (unassign keeps reviews).
    sb = FakeSupabase({
        "reviewer_profiles": [{"reviewer_user_id": "rv1", "weight": 1.0}],
        "reviews": [
            {"application_id": "A", "application_track": "tir", "reviewer_user_id": "rv1",
             "submitted_at": "2026-07-01T00:00:00Z", "recommendation": "yes",
             "score_problem": 8, "score_solution": 8, "score_tech": 8,
             "score_founders": 8, "score_commitment": 8},
        ],
        "reviewer_assignments": [],  # no active assignment
    })
    monkeypatch.setattr(admin_query, "get_admin_client", lambda: sb)
    out = admin_query._fetch_review_stats([("tir", "A")])
    assert out[("tir", "A")]["submitted"] == 1
    assert out[("tir", "A")]["assigned"] == 0


def test_review_stats_null_recommendation_counts_submitted_not_bucketed(monkeypatch):
    sb = FakeSupabase({
        "reviewer_profiles": [],
        "reviews": [
            {"application_id": "A", "application_track": "tir", "reviewer_user_id": "rv1",
             "submitted_at": "2026-07-01T00:00:00Z", "recommendation": None,
             "score_problem": 8, "score_solution": 8, "score_tech": 8,
             "score_founders": 8, "score_commitment": 8},
        ],
        "reviewer_assignments": [
            {"application_id": "A", "application_track": "tir", "reviewer_user_id": "rv1",
             "declined_at": None, "reassigned_to": None},
        ],
    })
    monkeypatch.setattr(admin_query, "get_admin_client", lambda: sb)
    out = admin_query._fetch_review_stats([("tir", "A")])
    assert out[("tir", "A")]["submitted"] == 1
    assert out[("tir", "A")]["reco"] == {"yes": 0, "maybe": 0, "no": 0}


def test_review_stats_omits_apps_with_no_reviews_or_assignments(monkeypatch):
    monkeypatch.setattr(admin_query, "get_admin_client", lambda: _stats_backend())
    out = admin_query._fetch_review_stats([("tir", "A"), ("tir", "ZZZ")])
    assert ("tir", "ZZZ") not in out


def test_reco_matches_semantics():
    assert admin_query.reco_matches({"yes": 2, "maybe": 0, "no": 1}, "yes") is True
    assert admin_query.reco_matches({"yes": 2, "maybe": 0, "no": 1}, "no") is True
    assert admin_query.reco_matches({"yes": 2, "maybe": 0, "no": 1}, "maybe") is False
    assert admin_query.reco_matches(None, "yes") is False
    assert admin_query.reco_matches({}, "yes") is False


def test_reviewer_scores_wrapper_backcompat(monkeypatch):
    monkeypatch.setattr(admin_query, "get_admin_client", lambda: _stats_backend())
    scores = admin_query._fetch_reviewer_scores([("tir", "A"), ("tir", "B")])
    assert scores == {("tir", "A"): 6.0, ("tir", "B"): 6.0}


def test_review_stats_counts_submitted_even_when_score_incomplete(monkeypatch):
    sb = FakeSupabase({
        "reviewer_profiles": [{"reviewer_user_id": "rv1", "weight": 1.0}],
        "reviews": [
            {"application_id": "A", "application_track": "tir", "reviewer_user_id": "rv1",
             "submitted_at": "2026-07-01T00:00:00Z", "recommendation": "yes",
             # score_problem intentionally MISSING -> _weighted_overall returns None
             "score_solution": 8, "score_tech": 8,
             "score_founders": 8, "score_commitment": 8},
        ],
        "reviewer_assignments": [
            {"application_id": "A", "application_track": "tir", "reviewer_user_id": "rv1",
             "declined_at": None, "reassigned_to": None},
        ],
    })
    monkeypatch.setattr(admin_query, "get_admin_client", lambda: sb)
    out = admin_query._fetch_review_stats([("tir", "A")])
    assert out[("tir", "A")]["submitted"] == 1
    assert out[("tir", "A")]["reco"] == {"yes": 1, "maybe": 0, "no": 0}
    assert out[("tir", "A")]["score"] is None  # incomplete review not scored


def _leadership_backend():
    """FakeSupabase for the leadership list: 2 TIR apps + reviews/assignments."""
    return FakeSupabase({
        "tir_applications": [
            {"id": "A", "track": "tir", "status": "under_review", "display_seq": 26001,
             "basic_full_name": "Asha R", "basic_org": "Acme", "basic_email": "a@x.io",
             "submitted_at": "2026-07-01T00:00:00Z"},
            {"id": "B", "track": "tir", "status": "under_review", "display_seq": 26002,
             "basic_full_name": "Bo K", "basic_org": "Beta", "basic_email": "b@x.io",
             "submitted_at": "2026-07-02T00:00:00Z"},
        ],
        "reviewer_profiles": [{"reviewer_user_id": "rv1", "weight": 1.0},
                              {"reviewer_user_id": "rv2", "weight": 1.0}],
        "reviews": [
            {"application_id": "A", "application_track": "tir", "reviewer_user_id": "rv1",
             "submitted_at": "2026-07-01T00:00:00Z", "recommendation": "yes",
             "score_problem": 8, "score_solution": 8, "score_tech": 8,
             "score_founders": 8, "score_commitment": 8},
            {"application_id": "B", "application_track": "tir", "reviewer_user_id": "rv1",
             "submitted_at": "2026-07-02T00:00:00Z", "recommendation": "no",
             "score_problem": 4, "score_solution": 4, "score_tech": 4,
             "score_founders": 4, "score_commitment": 4},
        ],
        "reviewer_assignments": [
            {"application_id": "A", "application_track": "tir", "reviewer_user_id": "rv1",
             "declined_at": None, "reassigned_to": None},
            {"application_id": "A", "application_track": "tir", "reviewer_user_id": "rv2",
             "declined_at": None, "reassigned_to": None},
            {"application_id": "B", "application_track": "tir", "reviewer_user_id": "rv1",
             "declined_at": None, "reassigned_to": None},
        ],
    })


def _patch_leadership(monkeypatch, sb):
    import inspect
    from types import SimpleNamespace

    from app.routers import leadership as lr
    monkeypatch.setattr(admin_query, "get_admin_client", lambda: sb)
    monkeypatch.setattr(applications_query, "get_admin_client", lambda: sb)

    # Calling the handler directly bypasses FastAPI, so every unpassed param
    # keeps its raw ``Query(...)`` object as its value (breaking truthiness /
    # comparison / arithmetic inside the handler). Emulate the ASGI layer:
    # inject each unpassed param's real default (``Query(...).default``).
    def _list_applications(**kw):
        call = {
            name: getattr(param.default, "default", param.default)
            for name, param in inspect.signature(lr.list_applications).parameters.items()
        }
        call.update(kw)
        return lr.list_applications(**call)

    return SimpleNamespace(list_applications=_list_applications)


def test_leadership_list_attaches_reviewers_and_reco(monkeypatch):
    sb = _leadership_backend()
    lr = _patch_leadership(monkeypatch, sb)
    res = asyncio.run(lr.list_applications(track="tir"))
    by_id = {a["id"]: a for a in res["applications"]}
    assert by_id["A"]["reviewers"] == {"submitted": 1, "assigned": 2}
    assert by_id["A"]["reco"] == {"yes": 1, "maybe": 0, "no": 0}
    assert by_id["B"]["reviewers"] == {"submitted": 1, "assigned": 1}
    assert by_id["B"]["reco"] == {"yes": 0, "maybe": 0, "no": 1}


def test_leadership_list_recommendation_filter(monkeypatch):
    sb = _leadership_backend()
    lr = _patch_leadership(monkeypatch, sb)
    res = asyncio.run(lr.list_applications(track="tir", recommendation="yes"))
    ids = {a["id"] for a in res["applications"]}
    assert ids == {"A"}          # only app A has a YES
    assert res["total"] == 1


def test_admin_pipeline_attaches_reviewers_and_reco(monkeypatch):
    sb = _leadership_backend()  # reuse the seeded TIR apps + reviews/assignments
    monkeypatch.setattr(admin_query, "get_admin_client", lambda: sb)
    monkeypatch.setattr(applications_query, "get_admin_client", lambda: sb)
    res = admin_query.fetch_pipeline({"track": "tir"})
    by_id = {a["id"]: a for a in res["applications"]}
    assert by_id["A"]["reviewers"] == {"submitted": 1, "assigned": 2}
    assert by_id["A"]["reco"] == {"yes": 1, "maybe": 0, "no": 0}
    assert by_id["A"]["reviewer_score"] == 8.0
    assert by_id["B"]["reviewers"] == {"submitted": 1, "assigned": 1}
    assert by_id["B"]["reco"] == {"yes": 0, "maybe": 0, "no": 1}
