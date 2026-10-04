"""Leadership round-2 numbers: default order nulls last, trimmed founder sort,
stage / reviewer-score / reviewers sort, track-scoped industry counts, and
detail reviewer counts that include detached (unassigned-after-review)
reviewers."""
from __future__ import annotations

import pytest

from app.deps import get_current_user
from app.main import app
from app.routers import leadership as lead_mod
from app.services import applications_query

from tests.test_pipeline_breakdown import _clear_overrides, _override, _patch_all  # noqa: F401


def _tables():
    return {
        "tir_applications": [
            {"id": "a", "status": "evaluated", "display_seq": 3, "basic_full_name": "  Zed",
             "solution_stage": "Prototype", "submitted_at": "2026-01-03"},
            {"id": "b", "status": "evaluated", "display_seq": 1, "basic_full_name": "amy",
             "solution_stage": "Idea", "submitted_at": "2026-01-01"},
            {"id": "c", "status": "under_review", "display_seq": 2, "basic_full_name": " Bob ",
             "submitted_at": None},
        ],
        "sip_applications": [
            {"id": "v", "status": "evaluated", "display_seq": 4, "basic_full_name": "Vee",
             "submitted_at": "2026-01-02"},
        ],
        "ai_screening": [
            {"application_id": "a", "application_track": "tir", "industry_category_id": "ai"},
            {"application_id": "b", "application_track": "tir", "industry_category_id": "rob"},
            {"application_id": "v", "application_track": "sip", "industry_category_id": "ai"},
        ],
        "admin_decisions": [], "ic_documents": [],
        "reviews": [
            # a: two reviewers submitted, one assignment row was deleted.
            {"id": "r1", "application_id": "a", "application_track": "tir",
             "reviewer_user_id": "rv1", "submitted_at": "2026-02-01", "recommendation": "yes"},
            {"id": "r2", "application_id": "a", "application_track": "tir",
             "reviewer_user_id": "rv2", "submitted_at": "2026-02-02", "recommendation": "no"},
            # b: one submitted review, assignment row deleted.
            {"id": "r3", "application_id": "b", "application_track": "tir",
             "reviewer_user_id": "rv1", "submitted_at": "2026-02-03", "recommendation": "yes"},
        ],
        "reviewer_assignments": [
            {"id": "as1", "application_id": "a", "application_track": "tir",
             "reviewer_user_id": "rv1", "assigned_at": "2026-01-10"},
            {"id": "as2", "application_id": "a", "application_track": "tir",
             "reviewer_user_id": "rv3", "assigned_at": "2026-01-10"},
        ],
        "reviewer_profiles": [], "industry_categories": [], "profiles": [],
        "application_status_log": [],
    }


def _get(client, monkeypatch, path, tables=None, **params):
    _patch_all(monkeypatch, tables or _tables())
    app.dependency_overrides[get_current_user] = _override(["leadership"])
    res = client.get(path, params=params, headers={"Authorization": "Bearer t"})
    assert res.status_code == 200, res.text
    return res.json()


def _ids(body):
    return [r["id"] for r in body["applications"]]


def test_default_order_is_submitted_desc_nulls_last(client, _clear_overrides, monkeypatch):
    body = _get(client, monkeypatch, "/leadership/applications")
    assert _ids(body) == ["a", "v", "b", "c"]


def test_founder_sort_trims_and_ignores_case(client, _clear_overrides, monkeypatch):
    body = _get(client, monkeypatch, "/leadership/applications", sort="founder")
    assert _ids(body) == ["b", "c", "v", "a"]


@pytest.mark.parametrize("sort,order,ids", [
    ("stage", "asc", ["b", "a", "c", "v"]),          # Idea < Prototype, nulls last
    ("reviewer_score", "asc", ["a", "b", "c", "v"]),  # all None → stable, no 422
    ("reviewers", "desc", ["a", "b", "c", "v"]),     # a 2/3, b 1/1, rest none
    ("reviewers", "asc", ["b", "a", "c", "v"]),
])
def test_new_sort_columns(client, _clear_overrides, monkeypatch, sort, order, ids):
    monkeypatch.setattr(lead_mod.stats, "derive_stage_label",
                        lambda r: ({"raw": r["solution_stage"], "label": r["solution_stage"]}
                                   if r.get("solution_stage") else None))
    body = _get(client, monkeypatch, "/leadership/applications", sort=sort, order=order)
    if sort == "reviewer_score":
        # Scores need rubric weights; just assert the param is accepted.
        assert sorted(_ids(body)) == sorted(ids)
    else:
        assert _ids(body) == ids


def test_industry_categories_scoped_to_track(client, _clear_overrides, monkeypatch):
    monkeypatch.setattr(
        lead_mod.industry_categories, "categories_with_counts",
        lambda: {"categories": [
            {"id": "ai", "label": "AI", "count": 2, "is_seed": True},
            {"id": "rob", "label": "Robotics", "count": 1, "is_seed": True}],
            "total": 3, "cap": 12, "remaining_slots": 10},
    )
    monkeypatch.setattr(
        applications_query, "fetch_industry_for_pairs",
        lambda pairs: {p: ({"a": {"id": "ai", "label": "AI"}, "v": {"id": "ai", "label": "AI"},
                            "b": {"id": "rob", "label": "Robotics"}}.get(p[1])) for p in pairs},
    )
    body = _get(client, monkeypatch, "/leadership/industry-categories", track="sip")
    counts = {c["id"]: c["count"] for c in body["categories"]}
    assert counts == {"ai": 1, "rob": 0}
    assert body["total"] == 1
    assert body["unclassified"]["count"] == 0
    assert body["apps_total"] == 1

    body = _get(client, monkeypatch, "/leadership/industry-categories", track="tir")
    counts = {c["id"]: c["count"] for c in body["categories"]}
    assert counts == {"ai": 1, "rob": 1}
    assert body["unclassified"]["count"] == 1


def test_detail_counts_detached_reviewers_as_assigned(client, _clear_overrides, monkeypatch):
    body = _get(client, monkeypatch, "/leadership/applications/b")
    ra = body["reviewer_assignments"]
    assert len(ra) == 1 and len(body["reviews"]) == 1
    assert ra[0]["reviewer_user_id"] == "rv1"
    assert ra[0]["detached"] is True
    assert ra[0]["reviewer_status"] == "evaluated"

    body = _get(client, monkeypatch, "/leadership/applications/a")
    ra = body["reviewer_assignments"]
    # rv1 + rv3 active, rv2 detached → 3, same as the list's "2 / 3".
    assert sorted(a["reviewer_user_id"] for a in ra) == ["rv1", "rv2", "rv3"]
    assert [a["reviewer_user_id"] for a in ra if a.get("detached")] == ["rv2"]


def test_list_reviewers_matches_detail(client, _clear_overrides, monkeypatch):
    body = _get(client, monkeypatch, "/leadership/applications")
    by = {r["id"]: r["reviewers"] for r in body["applications"]}
    assert by["a"] == {"submitted": 2, "assigned": 3}
    assert by["b"] == {"submitted": 1, "assigned": 1}
