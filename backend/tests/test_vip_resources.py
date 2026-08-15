"""Founders Resources are shared code, but never shared rows."""
from __future__ import annotations

import pytest

from app.services import founder_resources_query as frq
from tests.fixtures.fake_supabase import FakeSupabase

_ROWS = {
    "founder_cart_items": [
        {"id": "c1", "track": "tir", "application_id": "shared", "product_id": "p1", "qty": 1},
        {"id": "c2", "track": "sip", "application_id": "shared", "product_id": "p2", "qty": 5},
    ],
    "founder_tickets": [
        {"id": "t1", "track": "tir", "application_id": "shared", "subject": "TIR ticket"},
        {"id": "t2", "track": "sip", "application_id": "shared", "subject": "VIP ticket"},
    ],
    "founder_bookings": [
        {"id": "b1", "track": "tir", "application_id": "shared", "asset_id": "a1"},
    ],
    "founder_resource_requests": [
        {"id": "r1", "track": "tir", "application_id": "shared", "kind": "intro", "ref_id": "i1"},
        {"id": "r2", "track": "sip", "application_id": "shared", "kind": "intro", "ref_id": "i2"},
    ],
}


@pytest.fixture
def fake(monkeypatch):
    f = FakeSupabase({k: list(v) for k, v in _ROWS.items()})
    monkeypatch.setattr(frq, "get_admin_client", lambda: f)
    return f


def test_cart_defaults_to_tir(fake):
    cart = frq.fetch_cart("shared")
    assert [c["product_id"] for c in cart] == ["p1"]


def test_cart_reads_only_the_sip_rows_for_sip(fake):
    cart = frq.fetch_cart("shared", "sip")
    assert [c["product_id"] for c in cart] == ["p2"]


def test_tickets_are_track_scoped(fake):
    assert [t["subject"] for t in frq.fetch_tickets("shared", "sip")] == ["VIP ticket"]


def test_bookings_empty_on_a_track_with_none(fake):
    assert frq.fetch_bookings("shared", "sip") == []


def test_requests_filter_on_kind_and_track(fake):
    assert [r["ref_id"] for r in frq.fetch_requests("shared", "intro", "sip")] == ["i2"]


def test_bundles_pass_the_track_down(fake):
    """The five *_bundle helpers must not silently read TIR rows for a VIP."""
    assert frq.store_bundle("shared", "sip")["cart"][0]["product_id"] == "p2"
    assert frq.support_bundle("shared", "sip")["tickets"][0]["subject"] == "VIP ticket"
    assert frq.assets_bundle("shared", "sip")["bookings"] == []


import pytest as _pytest

from app.deps import get_current_user
from app.main import app as _app


@_pytest.fixture
def _clear():
    yield
    _app.dependency_overrides.clear()


def test_push_to_procurement_is_rejected_for_vip(client, monkeypatch, _clear):
    """founder_procurement_items is TIR-only and keeps its FK, so VIP must not
    be able to write to it through the shared store."""
    from app.routers import founder as founder_router
    from app.routers import founder_resources as fr_router

    fake = FakeSupabase({
        "sip_applications": [
            {"id": "sapp1", "user_id": "u1", "status": "onboarded",
             "submitted_at": "2026-07-01"},
        ],
        "founder_cart_items": [],
        "founder_procurement_items": [],
    })
    monkeypatch.setattr(founder_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(fr_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(frq, "get_admin_client", lambda: fake)
    _app.dependency_overrides[get_current_user] = lambda: {
        "user_id": "u1", "email": "u1@x.com", "track": "sip", "roles": ["applicant"],
    }

    r = client.post("/founder/store/push-to-procurement")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "not_available_for_track"
