"""Track-move effective-track overlay (2026-07-20).

A moved application is treated as the OTHER track everywhere it's listed,
filtered, or counted, while the row physically stays in its native table.
"""
from __future__ import annotations

from app.services import admin_query, applications_query, stats

from tests.fixtures.fake_supabase import FakeSupabase


def _seed():
    """Two apps per table; one on each side moved to the other track."""
    return FakeSupabase({
        "tir_applications": [
            {"id": "a1", "track": "tir", "status": "under_review", "display_seq": 26001,
             "basic_full_name": "Ann", "basic_org": "Acme", "moved_to_track": None},
            {"id": "a2", "track": "tir", "status": "under_review", "display_seq": 26002,
             "basic_full_name": "Al", "basic_org": "Beta", "moved_to_track": "sip"},  # TIR→VIP
        ],
        "sip_applications": [
            {"id": "b1", "track": "sip", "status": "under_review", "display_seq": 26010,
             "basic_full_name": "Bo", "basic_org": "Cee", "moved_to_track": None},
            {"id": "b2", "track": "sip", "status": "under_review", "display_seq": 26011,
             "basic_full_name": "Bea", "basic_org": "Dee", "moved_to_track": "tir"},  # VIP→TIR
        ],
    })


def _patch(monkeypatch, sb):
    monkeypatch.setattr(applications_query, "get_admin_client", lambda: sb)
    monkeypatch.setattr(admin_query, "get_admin_client", lambda: sb)
    monkeypatch.setattr(stats, "get_admin_client", lambda: sb)


def test_fetch_apps_for_track_effective_membership(monkeypatch):
    _patch(monkeypatch, _seed())

    tir = applications_query.fetch_apps_for_track("tir")
    assert {r["id"] for r in tir} == {"a1", "b2"}   # a1 stays; b2 moved IN from VIP
    # native track preserved for child lookups
    assert next(r for r in tir if r["id"] == "a1")["track"] == "tir"
    assert next(r for r in tir if r["id"] == "b2")["track"] == "sip"  # native VIP

    vip = applications_query.fetch_apps_for_track("sip")
    assert {r["id"] for r in vip} == {"b1", "a2"}   # b1 stays; a2 moved IN from TIR
    assert next(r for r in vip if r["id"] == "a2")["track"] == "tir"  # native TIR


def test_effective_track_helper():
    assert applications_query.effective_track({"track": "tir", "moved_to_track": None}) == "tir"
    assert applications_query.effective_track({"track": "tir", "moved_to_track": "sip"}) == "sip"


def test_effective_counts(monkeypatch):
    _patch(monkeypatch, _seed())
    # Each effective track has exactly 2 apps (one native-here + one moved-in).
    assert stats.count_apps_total("tir") == 2
    assert stats.count_apps_total("sip") == 2
    assert stats.count_apps_by_status("tir", "under_review") == 2
    assert stats.count_apps_by_status("sip", "under_review") == 2


def test_pipeline_shows_moved_app_under_new_track(monkeypatch):
    _patch(monkeypatch, _seed())

    vip = admin_query.fetch_pipeline({"track": "sip"})
    by_id = {i["id"]: i for i in vip["applications"]}
    assert set(by_id) == {"b1", "a2"}
    # a2 physically lives in tir_applications but displays as VIP now.
    assert by_id["a2"]["track"] == "sip"
    assert by_id["a2"]["native_track"] == "tir"
    # Backend composes SIP-#### from the effective track; the frontend relabels
    # the SIP prefix to VIP for display.
    assert by_id["a2"]["applicationId"] == "SIP-26002"
    assert by_id["a2"]["moved_to_track"] == "sip"

    tir = admin_query.fetch_pipeline({"track": "tir"})
    assert set(i["id"] for i in tir["applications"]) == {"a1", "b2"}
    assert next(i for i in tir["applications"] if i["id"] == "b2")["track"] == "tir"


def test_native_track_resolution_for_writes(monkeypatch):
    # The admin decide/move routers resolve the native track from the id even
    # when handed the effective track — find_application_with_track is the probe.
    _patch(monkeypatch, _seed())
    assert applications_query.find_application_with_track("a2")[0] == "tir"  # native
    assert applications_query.find_application_with_track("b2")[0] == "sip"  # native
