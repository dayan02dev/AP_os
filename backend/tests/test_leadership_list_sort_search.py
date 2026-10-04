"""Leadership applications list: pipeline-stage filter, gate decisions on rows,
server-side sort (contract C3), search normalisation (C2), VIP project name,
and the Unclassified industry bucket."""
from __future__ import annotations

import pytest

from app.deps import get_current_user
from app.main import app
from app.routers import leadership as lead_mod
from app.services import applications_query

from tests.test_pipeline_breakdown import _clear_overrides, _override, _patch_all, _prod_mix  # noqa: F401


# ─── /leadership/applications: stage filter, sort, search, rows ────────


def _list(client, monkeypatch, tables=None, **params):
    _patch_all(monkeypatch, tables or _prod_mix())
    app.dependency_overrides[get_current_user] = _override(["leadership"])
    res = client.get("/leadership/applications", params=params,
                     headers={"Authorization": "Bearer t"})
    assert res.status_code == 200, res.text
    return res.json()


@pytest.mark.parametrize("stage,n", [
    ("final_selected", 16), ("final_pending", 10), ("final_rejected", 20),
    ("gate1_rejected", 134), ("reviewed", 345), ("jury_review", 26),
])
def test_list_filters_by_pipeline_stage(client, _clear_overrides, monkeypatch, stage, n):
    body = _list(client, monkeypatch, status=stage, limit=1)
    assert body["total"] == n


def test_list_rows_carry_gate_decisions_and_stage(client, _clear_overrides, monkeypatch):
    body = _list(client, monkeypatch, status="final_rejected", limit=200)
    row = body["applications"][0]
    assert row["status"] == "rejected"
    assert row["pipeline_stage"] == "final_rejected"
    assert row["gate1_decision"] == "jury_review"
    assert row["gate2_decision"] == "rejected"
    assert "review_count" in row

    body = _list(client, monkeypatch, status="final_selected", limit=200)
    assert all(r["status"] == "jury_review" for r in body["applications"])
    assert all(r["pipeline_stage"] == "final_selected" for r in body["applications"])


def _sort_tables():
    return {
        "tir_applications": [
            {"id": "a", "status": "evaluated", "display_seq": 3, "basic_full_name": "Zed",
             "submitted_at": "2026-01-03"},
            {"id": "b", "status": "evaluated", "display_seq": 1, "basic_full_name": "amy",
             "submitted_at": "2026-01-01"},
            {"id": "c", "status": "under_review", "display_seq": 2, "basic_full_name": None,
             "submitted_at": "2026-01-02"},
        ],
        "sip_applications": [],
        "ai_screening": [
            {"application_id": "a", "application_track": "tir", "score_overall": 6.2},
            {"application_id": "b", "application_track": "tir", "score_overall": 4.2},
        ],
        "admin_decisions": [], "ic_documents": [], "reviews": [],
        "reviewer_assignments": [], "reviewer_profiles": [], "industry_categories": [],
    }


@pytest.mark.parametrize("sort,order,ids", [
    ("ai_score", "asc", ["b", "a", "c"]),
    ("ai_score", "desc", ["a", "b", "c"]),       # nulls last both ways
    ("id", "asc", ["b", "c", "a"]),
    ("founder", "asc", ["b", "a", "c"]),          # case-insensitive, null last
    ("submitted_at", "asc", ["b", "c", "a"]),
])
def test_list_server_side_sort(client, _clear_overrides, monkeypatch, sort, order, ids):
    body = _list(client, monkeypatch, tables=_sort_tables(), sort=sort, order=order)
    assert [r["id"] for r in body["applications"]] == ids


def test_list_sort_applies_before_pagination(client, _clear_overrides, monkeypatch):
    body = _list(client, monkeypatch, tables=_sort_tables(),
                 sort="ai_score", order="asc", limit=1, offset=1)
    assert [r["id"] for r in body["applications"]] == ["a"]
    assert body["total"] == 3


def test_list_rejects_unknown_sort(client, _clear_overrides, monkeypatch):
    _patch_all(monkeypatch, _sort_tables())
    app.dependency_overrides[get_current_user] = _override(["leadership"])
    res = client.get("/leadership/applications", params={"sort": "evil"},
                     headers={"Authorization": "Bearer t"})
    assert res.status_code == 422


@pytest.mark.parametrize("raw,clean", [
    ("  hephos  ", "hephos"),
    ("TIR-27323", "27323"),
    ("vip-26701", "26701"),
    ("SIP-26701", "26701"),
    ("Acme, Inc (Pvt)", "Acme_ Inc _Pvt_"),
    ("   ", None),
    (None, None),
])
def test_normalize_search(raw, clean):
    assert lead_mod._normalize_search(raw) == clean


def test_list_passes_normalized_search(client, _clear_overrides, monkeypatch):
    seen: list = []

    def _fake(track, *, status=None, search=None, limit=0):
        seen.append(search)
        return []
    _patch_all(monkeypatch, _sort_tables())
    monkeypatch.setattr(applications_query, "fetch_apps_for_track", _fake)
    app.dependency_overrides[get_current_user] = _override(["leadership"])
    res = client.get("/leadership/applications", params={"search": "  TIR-26013 "},
                     headers={"Authorization": "Bearer t"})
    assert res.status_code == 200
    assert seen and all(s == "26013" for s in seen)


def test_list_vip_project_name_matches_drawer(client, _clear_overrides, monkeypatch):
    tables = _sort_tables()
    tables["tir_applications"] = []
    tables["sip_applications"] = [{"id": "v1", "status": "evaluated", "display_seq": 9,
                                   "basic_org": "Hyetron Energy Private Limited",
                                   "basic_full_name": "Founder"}]
    tables["ai_screening"] = [{"application_id": "v1", "application_track": "sip",
                               "project_name": "Decentralized Green Hydrogen System"}]
    body = _list(client, monkeypatch, tables=tables)
    assert body["applications"][0]["project_name"] == "Decentralized Green Hydrogen System"


def test_list_unclassified_industry_filter(client, _clear_overrides, monkeypatch):
    monkeypatch.setattr(
        applications_query, "fetch_industry_for_pairs",
        lambda pairs: {p: ({"id": "ai", "label": "AI"} if p[1] == "a" else None) for p in pairs},
    )
    body = _list(client, monkeypatch, tables=_sort_tables(), industry="unclassified")
    assert sorted(r["id"] for r in body["applications"]) == ["b", "c"]


def test_industry_categories_reports_unclassified(client, _clear_overrides, monkeypatch):
    _patch_all(monkeypatch, _sort_tables())
    monkeypatch.setattr(
        lead_mod.industry_categories, "categories_with_counts",
        lambda: {"categories": [{"id": "ai", "label": "AI", "count": 1, "is_seed": True}],
                 "total": 1, "cap": 12, "remaining_slots": 11},
    )
    app.dependency_overrides[get_current_user] = _override(["leadership"])
    res = client.get("/leadership/industry-categories", headers={"Authorization": "Bearer t"})
    assert res.status_code == 200
    body = res.json()
    assert body["unclassified"] == {"id": "unclassified", "label": "Unclassified", "count": 2}
    assert body["apps_total"] == 3
