"""Rubric v3.2 (2026-11-03): the reviewer criterion "Commitment to be fully
available" (key commit / column score_commitment) is removed.

- Submit and PATCH flip-to-submit require only problem/solution/tech/founders
  + recommendation; score_commitment is optional and accepted (old bundles).
- The reviewer weighted overall is (22*problem + 30*solution + 22*tech +
  14*founders) / 88 for ALL reviews; a stored commitment score is ignored.
- AI screening scores are untouched (not covered here).
"""
from __future__ import annotations

import pytest
from app.deps import get_current_user
from app.main import app
from app.services import admin_query, digest_summary, reviewer_query, rubric

from tests.test_reviewer import (  # noqa: F401  (fixture import)
    _PATCH_LIVE_ASG,
    _VALID_SUBMIT,
    _clear_overrides,
    _freeze_datetime,
    _install_db,
    _override_user,
    _seed_one_assignment,
)

pytestmark = pytest.mark.usefixtures("_clear_overrides")


def _four_dim_submit():
    body = dict(_VALID_SUBMIT)
    body.pop("score_commitment")
    return body


def test_submit_without_commitment_is_accepted(client, monkeypatch):
    _seed_one_assignment(monkeypatch, "rev-a")
    app.dependency_overrides[get_current_user] = _override_user("rev-a")
    r = client.post("/reviewer/reviews", json=_four_dim_submit())
    assert r.status_code == 201, r.text
    # 7/5/6/8 -> (154 + 150 + 132 + 112) / 88 = 6.23
    assert r.json()["overall"] == 6.23


def test_submit_with_stale_commitment_still_accepted_and_ignored(
    client, monkeypatch,
):
    """Old cached FE bundles keep sending score_commitment; accept, ignore."""
    _seed_one_assignment(monkeypatch, "rev-a")
    app.dependency_overrides[get_current_user] = _override_user("rev-a")
    body = dict(_VALID_SUBMIT, score_commitment=1)
    r = client.post("/reviewer/reviews", json=body)
    assert r.status_code == 201, r.text
    assert r.json()["overall"] == 6.23


def test_submit_missing_founders_reports_only_four_dims(client, monkeypatch):
    _seed_one_assignment(monkeypatch, "rev-a")
    app.dependency_overrides[get_current_user] = _override_user("rev-a")
    body = _four_dim_submit()
    body["score_founders"] = None
    r = client.post("/reviewer/reviews", json=body)
    assert r.status_code == 422
    assert r.json()["detail"] == {"code": "incomplete_review", "missing": ["score_founders"]}


def _draft_db(monkeypatch, **review):
    row = {"id": "rev-draft", "reviewer_user_id": "rev-a", "assignment_id": "a1",
           "application_id": "app1", "application_track": "tir",
           "submitted_at": None, "locked_at": None,
           "score_problem": 7, "score_solution": 5, "score_tech": 6,
           "score_founders": 8, "score_commitment": None,
           "recommendation": "maybe", "quick_notes": "ok"}
    row.update(review)
    return _install_db(monkeypatch, {
        "reviewer_assignments": [dict(_PATCH_LIVE_ASG)],
        "tir_applications": [], "sip_applications": [],
        "reviews": [row], "application_status_log": [],
    })


def test_patch_flip_to_submit_without_commitment_succeeds(client, monkeypatch):
    _freeze_datetime(monkeypatch, "2026-11-03T10:00:00Z")
    _draft_db(monkeypatch)
    app.dependency_overrides[get_current_user] = _override_user("rev-a")
    r = client.patch("/reviewer/reviews/rev-draft", json={"draft": False})
    assert r.status_code == 200, r.text
    assert r.json()["overall"] == 6.23


def test_patch_explicitly_nulling_commitment_on_submitted_review_is_ok(
    client, monkeypatch,
):
    _freeze_datetime(monkeypatch, "2026-11-03T10:00:00Z")
    _draft_db(monkeypatch, submitted_at="2026-11-03T09:50:00Z",
              locked_at="2026-11-03T10:50:00Z", score_commitment=7)
    app.dependency_overrides[get_current_user] = _override_user("rev-a")
    r = client.patch("/reviewer/reviews/rev-draft", json={"score_commitment": None})
    assert r.status_code == 200, r.text


def test_weighted_overall_four_dims_over_88():
    four = {"score_problem": 8, "score_solution": 6, "score_tech": 7, "score_founders": 9,
            "score_commitment": None, "submitted_at": "x", "reviewer_user_id": "r1"}
    # (176 + 180 + 154 + 126) / 88 = 7.227
    assert reviewer_query._weighted_overall(four) == 7.23
    # historical row with a commitment score: commitment ignored
    assert reviewer_query._weighted_overall({**four, "score_commitment": 1}) == 7.23
    assert admin_query.reviewer_score([four], {}) == 7.2  # 1-dp display rounding
    out = digest_summary.summarize_reviews(
        [{**four, "application_id": "a", "application_track": "tir"}], {})
    assert out[0]["items"][0]["overall"] == 7.23


def test_weighted_overall_none_only_when_one_of_four_missing():
    row = {"score_problem": 8, "score_solution": None, "score_tech": 7, "score_founders": 9}
    assert reviewer_query._weighted_overall(row) is None


def test_rubric_v32_has_no_commit_dimension():
    r = rubric.get_rubric("tir")
    assert r["version"] == "v3.2"
    assert r["date"] == "2026-11-03"
    assert [d["key"] for d in r["dimensions"]] == ["problem", "solution", "tech", "founders"]
    assert not any("Commitment" in d["name"] for d in r["dimensions"])
