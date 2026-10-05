"""Internal Founder Portal test ventures are hidden from every staff view.

TIR-27325 and TIR-27332 are the two onboarded prod apps the team uses to
exercise the Founder Portal. They must not move any staff-facing number
(admin / leadership / reviewer / jury) while the founder side keeps working.
With them excluded the prod dashboard reads 603:
    submitted 2 + under_review 76 + reviewed 345 + gate1_rejected 134
    + final_pending 10 + final_rejected 20 + final_selected 16 + onboarded 0
"""
from __future__ import annotations

import pytest

from app.deps import get_current_user
from app.main import app
from app.services import admin_query, industry_categories, reviewer_query, staff_exclusions
from tests.fixtures.fake_supabase import FakeSupabase
from tests.test_pipeline_breakdown import _patch_all, _prod_mix

TEST_IDS = (
    "6ef1cf87-af28-4929-a759-68f486432b2c",   # TIR-27325
    "e7b49c04-a24f-4937-b36e-df957aeb1f7b",   # TIR-27332
)


def _prod_mix_with_test_ventures() -> dict[str, list[dict]]:
    """The prod mix with its 2 onboarded TIR apps re-keyed to the real ids."""
    t = _prod_mix()
    onboarded = [r for r in t["tir_applications"] if r["status"] == "onboarded"]
    assert len(onboarded) == 2
    for row, new_id in zip(onboarded, TEST_IDS):
        old_id = row["id"]
        row["id"] = new_id
        for ai in t["ai_screening"]:
            if ai["application_id"] == old_id:
                ai["application_id"] = new_id
    return t


def _no_drafts() -> dict[str, list[dict]]:
    """The fake ignores .neq("status", "draft"), so drop drafts where a test
    reads a raw non-draft total."""
    t = _prod_mix_with_test_ventures()
    for tbl in ("tir_applications", "sip_applications"):
        t[tbl] = [r for r in t[tbl] if r["status"] != "draft"]
    return t


@pytest.fixture
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


def _get(client, monkeypatch, path, roles, tables=None, **params):
    sb = _patch_all(monkeypatch, tables or _prod_mix_with_test_ventures())
    monkeypatch.setattr(industry_categories, "get_admin_client", lambda: sb)
    app.dependency_overrides[get_current_user] = lambda: {
        "user_id": "u1", "email": "u1@x.com", "roles": list(roles)}
    return client.get(path, params=params, headers={"Authorization": "Bearer t"})


def test_default_excluded_ids():
    assert set(TEST_IDS) <= staff_exclusions.STAFF_EXCLUDED_APPLICATION_IDS


def test_leadership_stats_excludes_test_ventures(client, _clear_overrides, monkeypatch):
    res = _get(client, monkeypatch, "/leadership/stats", ("leadership",))
    assert res.status_code == 200, res.text
    body = res.json()
    pb = body["pipeline_breakdown"]
    assert pb["total"] == 603
    assert {k: v for k, v in pb["stages"].items() if v} == {
        "submitted": 2, "under_review": 76, "reviewed": 345, "gate1_rejected": 134,
        "final_pending": 10, "final_rejected": 20, "final_selected": 16,
    }
    assert pb["stages"]["onboarded"] == 0
    assert sum(pb["stages"].values()) == 603
    assert body["totals"]["apps_submitted"] == 603
    assert body["totals"]["onboarded"] == 0
    assert sum(s["n"] for s in body["status_counts"]) == 603
    assert body["funnel"]["decided"] == 16
    assert body["ai_scored_count"] == 602
    # histogram: the test ventures' scores are not in the distribution
    assert len(body["ai_score_overalls"]) == len(
        [a for a in _prod_mix()["ai_screening"] if a["score_overall"] is not None]) - 2


def test_admin_stats_excludes_test_ventures(client, _clear_overrides, monkeypatch):
    res = _get(client, monkeypatch, "/admin/platform/stats", ("admin",))
    assert res.status_code == 200, res.text
    assert res.json()["pipeline_breakdown"]["total"] == 603


def test_admin_pipeline_list_excludes_test_ventures(client, _clear_overrides, monkeypatch):
    res = _get(client, monkeypatch, "/admin/platform/applications", ("admin",))
    assert res.status_code == 200, res.text
    ids = {r["id"] for r in res.json()["applications"]}
    assert ids and not ids & set(TEST_IDS)


def test_leadership_list_excludes_test_ventures(client, _clear_overrides, monkeypatch):
    res = _get(client, monkeypatch, "/leadership/applications", ("leadership",),
               tables=_no_drafts(), limit=200)
    assert res.status_code == 200, res.text
    body = res.json()
    ids = {r["id"] for r in body["applications"]}
    assert ids and not ids & set(TEST_IDS)
    assert body["total"] == 603
    res = _get(client, monkeypatch, "/leadership/applications", ("leadership",),
               status="onboarded")
    assert res.status_code == 200, res.text
    assert res.json()["total"] == 0 and res.json()["applications"] == []


def test_leadership_detail_404s_for_test_venture(client, _clear_overrides, monkeypatch):
    res = _get(client, monkeypatch, f"/leadership/applications/{TEST_IDS[0]}", ("leadership",))
    assert res.status_code == 404


def test_industry_apps_total_excludes_test_ventures(client, _clear_overrides, monkeypatch):
    res = _get(client, monkeypatch, "/leadership/industry-categories", ("leadership",),
               tables=_no_drafts())
    assert res.status_code == 200, res.text
    assert res.json()["apps_total"] == 603


def test_rebalance_never_offers_test_ventures(monkeypatch):
    _patch_all(monkeypatch, _prod_mix_with_test_ventures())
    ids = {a["application_id"] for a in admin_query.fetch_unassigned_apps()}
    assert ids and not ids & set(TEST_IDS)


def test_reviewer_queue_skips_test_ventures(monkeypatch):
    tables = {
        "tir_applications": [
            {"id": TEST_IDS[0], "status": "under_review", "display_seq": 27325},
            {"id": "real", "status": "under_review", "display_seq": 1},
        ],
        "sip_applications": [],
        "reviewer_assignments": [
            {"id": "as1", "application_id": TEST_IDS[0], "application_track": "tir",
             "reviewer_user_id": "rv1", "assigned_at": "2026-01-01"},
            {"id": "as2", "application_id": "real", "application_track": "tir",
             "reviewer_user_id": "rv1", "assigned_at": "2026-01-01"},
        ],
        "reviews": [], "ai_screening": [], "industry_categories": [],
        "admin_decisions": [], "ic_documents": [],
    }
    sb = FakeSupabase(tables)
    monkeypatch.setattr(reviewer_query, "get_admin_client", lambda: sb)
    queue = reviewer_query.fetch_queue("rv1")
    assert [q["assignmentId"] for q in queue] == ["as2"]


def test_founder_portal_still_sees_test_venture(client, _clear_overrides, monkeypatch):
    from app.config import settings
    from app.routers import founder as founder_router
    from app.services import founder_query
    fake = FakeSupabase({"tir_applications": [
        {"id": TEST_IDS[0], "user_id": "u1", "status": "onboarded",
         "grant_amount": 2500000, "submitted_at": "2026-07-01"},
    ]})
    monkeypatch.setattr(founder_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(founder_query, "get_admin_client", lambda: fake)
    monkeypatch.setattr(settings, "founder_portal_allowlist", "")
    app.dependency_overrides[get_current_user] = lambda: {
        "user_id": "u1", "email": "u1@x.com", "track": "tir", "roles": ["applicant"]}
    res = client.get("/founder/me")
    assert res.status_code == 200, res.text
    assert res.json()["application_id"] == TEST_IDS[0]
