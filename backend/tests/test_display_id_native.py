"""Display ID of a track-moved application uses the NATIVE track prefix.

Composing the ID from the effective track made a TIR app moved to VIP show
as ``SIP-<its TIR seq>``, colliding with the real VIP app holding that seq
(two "VIP-26255" rows). The label is now always ``<native>-<native seq>``;
track filters/counts still use the effective track.
"""
from __future__ import annotations

from app.deps import get_current_user
from app.main import app
from app.services import admin_query

from tests.test_pipeline_breakdown import _clear_overrides, _override, _patch_all  # noqa: F401


def _tables():
    return {
        "tir_applications": [
            # TIR app moved to VIP — same seq as the real VIP app below.
            {"id": "moved", "status": "under_review", "display_seq": 26255,
             "basic_full_name": "Mo", "moved_to_track": "sip", "submitted_at": "2026-01-02"},
        ],
        "sip_applications": [
            {"id": "native", "status": "under_review", "display_seq": 26255,
             "basic_full_name": "Nat", "moved_to_track": None, "submitted_at": "2026-01-01"},
        ],
        "ai_screening": [], "admin_decisions": [], "ic_documents": [], "reviews": [],
        "reviewer_assignments": [], "reviewer_profiles": [], "industry_categories": [],
        "profiles": [], "application_status_log": [],
    }


def test_admin_pipeline_collision_case_yields_distinct_ids(monkeypatch):
    _patch_all(monkeypatch, _tables())
    vip = admin_query.fetch_pipeline({"track": "sip"})
    by_id = {i["id"]: i for i in vip["applications"]}
    assert set(by_id) == {"moved", "native"}          # both listed under VIP
    assert by_id["native"]["applicationId"] == "SIP-26255"
    assert by_id["moved"]["applicationId"] == "TIR-26255"
    # moved marker data: effective track differs from native
    assert by_id["moved"]["track"] == "sip"
    assert by_id["moved"]["native_track"] == "tir"


def test_admin_pipeline_search_by_native_id(monkeypatch):
    _patch_all(monkeypatch, _tables())
    res = admin_query.fetch_pipeline({"search": "TIR-26255"})
    assert "moved" in {i["id"] for i in res["applications"]}


def test_admin_detail_uses_native_prefix(monkeypatch):
    _patch_all(monkeypatch, _tables())
    detail = admin_query.fetch_detail("tir", "moved")
    assert detail["display_id"] == "TIR-26255"
    assert detail["track"] == "sip"


def test_leadership_list_and_detail_use_native_prefix(client, _clear_overrides, monkeypatch):
    _patch_all(monkeypatch, _tables())
    app.dependency_overrides[get_current_user] = _override(["leadership"])
    h = {"Authorization": "Bearer t"}
    body = client.get("/leadership/applications", params={"track": "sip"}, headers=h).json()
    ids = {r["id"]: r["display_id"] for r in body["applications"]}
    assert ids == {"moved": "TIR-26255", "native": "SIP-26255"}
    det = client.get("/leadership/applications/moved", headers=h).json()
    assert det["display_id"] == "TIR-26255"
    assert det["track"] == "sip"
