"""Endpoint-level cross-track isolation for the Founders Resources routes.

Every isolation assertion elsewhere (test_vip_resources.py) calls
founder_resources_query functions directly, which means the seven inline
`.eq("track", ...)` filters that live in founder_resources.py itself — not
in the query module — have no coverage: delete any of them and the rest of
the suite stays green. This file closes that gap by going through the real
HTTP client.

The setup deliberately makes the VIP founder's application_id collide with
a seeded TIR row (in production the two are drawn from disjoint UUID
generators and can never collide, but forcing the collision here means
`application_id` alone cannot explain a passing test — only `track` can).
"""
from __future__ import annotations

import pytest
from app.deps import get_current_user
from app.main import app

from tests.fixtures.fake_supabase import FakeSupabase

SHARED_ID = "shared-app-id"


@pytest.fixture
def _clear():
    yield
    app.dependency_overrides.clear()


def _install(monkeypatch, tables):
    from app.routers import founder as fr
    from app.routers import founder_resources as frr
    from app.services import founder_resources_query as frq
    fake = FakeSupabase(tables)
    for mod in (fr, frr, frq):
        monkeypatch.setattr(mod, "get_admin_client", lambda: fake)
    return fake


def _override_vip_user():
    return {"user_id": "vip-user", "email": "vip@x.com", "roles": ["applicant"]}


def _tables():
    return {
        "tir_applications": [
            {"id": SHARED_ID, "user_id": "tir-user", "status": "onboarded",
             "submitted_at": "2026-07-01"},
        ],
        "sip_applications": [
            {"id": SHARED_ID, "user_id": "vip-user", "status": "onboarded",
             "submitted_at": "2026-07-01"},
        ],
        "founder_cart_items": [
            {"id": "cart-tir", "application_id": SHARED_ID, "track": "tir",
             "product_id": "c1", "qty": 1},
            {"id": "cart-sip", "application_id": SHARED_ID, "track": "sip",
             "product_id": "c2", "qty": 5},
        ],
        "founder_resource_requests": [
            {"id": "req-quote-tir", "application_id": SHARED_ID, "track": "tir",
             "kind": "quote", "ref_id": "c1"},
            {"id": "req-quote-sip", "application_id": SHARED_ID, "track": "sip",
             "kind": "quote", "ref_id": "c2"},
            {"id": "req-intro-tir", "application_id": SHARED_ID, "track": "tir",
             "kind": "intro", "ref_id": "i1"},
            {"id": "req-intro-sip", "application_id": SHARED_ID, "track": "sip",
             "kind": "intro", "ref_id": "i2"},
            {"id": "req-partner-tir", "application_id": SHARED_ID, "track": "tir",
             "kind": "partner", "ref_id": "pt1"},
            {"id": "req-partner-sip", "application_id": SHARED_ID, "track": "sip",
             "kind": "partner", "ref_id": "pt2"},
        ],
        "founder_bookings": [
            {"id": "bk-tir", "application_id": SHARED_ID, "track": "tir",
             "asset_id": "a1", "asset_name": "TIR asset", "date": "2026-08-01",
             "slot": "Morning (9–1)", "status": "pending"},
            {"id": "bk-sip", "application_id": SHARED_ID, "track": "sip",
             "asset_id": "a2", "asset_name": "VIP asset", "date": "2026-08-02",
             "slot": "Afternoon (2–6)", "status": "pending"},
        ],
        "founder_tickets": [
            {"id": "tk-tir", "application_id": SHARED_ID, "track": "tir",
             "ref": "IT-101", "area": "IT", "priority": "High",
             "subject": "TIR ticket", "description": "d", "status": "open"},
            {"id": "tk-sip", "application_id": SHARED_ID, "track": "sip",
             "ref": "IT-102", "area": "IT", "priority": "High",
             "subject": "VIP ticket", "description": "d", "status": "open"},
        ],
    }


def test_store_returns_only_the_sip_cart_and_quote_flags(client, monkeypatch, _clear):
    _install(monkeypatch, _tables())
    app.dependency_overrides[get_current_user] = _override_vip_user
    body = client.get("/founder/store").json()
    assert [c["product_id"] for c in body["cart"]] == ["c2"]
    c1 = next(c for c in body["catalog"] if c["id"] == "c1")
    c2 = next(c for c in body["catalog"] if c["id"] == "c2")
    assert c1["quote_requested"] is False  # the TIR quote request must not leak
    assert c2["quote_requested"] is True


def test_fundraising_returns_only_the_sip_intro_requests(client, monkeypatch, _clear):
    _install(monkeypatch, _tables())
    app.dependency_overrides[get_current_user] = _override_vip_user
    body = client.get("/founder/fundraising").json()
    i1 = next(i for i in body["investors"] if i["id"] == "i1")
    i2 = next(i for i in body["investors"] if i["id"] == "i2")
    assert i1["intro_requested"] is False
    assert i2["intro_requested"] is True


def test_partners_returns_only_the_sip_partner_requests(client, monkeypatch, _clear):
    _install(monkeypatch, _tables())
    app.dependency_overrides[get_current_user] = _override_vip_user
    body = client.get("/founder/partners").json()
    pt1 = next(p for p in body["partners"] if p["id"] == "pt1")
    pt2 = next(p for p in body["partners"] if p["id"] == "pt2")
    assert pt1["requested"] is False
    assert pt2["requested"] is True


def test_assets_returns_only_the_sip_bookings(client, monkeypatch, _clear):
    _install(monkeypatch, _tables())
    app.dependency_overrides[get_current_user] = _override_vip_user
    body = client.get("/founder/assets").json()
    assert [b["id"] for b in body["bookings"]] == ["bk-sip"]


def test_support_returns_only_the_sip_tickets(client, monkeypatch, _clear):
    _install(monkeypatch, _tables())
    app.dependency_overrides[get_current_user] = _override_vip_user
    body = client.get("/founder/support").json()
    assert [t["id"] for t in body["tickets"]] == ["tk-sip"]


def test_cannot_delete_the_colliding_tir_booking(client, monkeypatch, _clear):
    """bk-tir shares this founder's application_id (deliberately, per the
    module docstring) — only the track filter can keep it out of reach."""
    _install(monkeypatch, _tables())
    app.dependency_overrides[get_current_user] = _override_vip_user
    r = client.delete("/founder/assets/bookings/bk-tir")
    assert r.status_code == 404

    # sanity: deleting the founder's own booking still works, so the 404
    # above is the track guard and not a blanket failure.
    r2 = client.delete("/founder/assets/bookings/bk-sip")
    assert r2.status_code == 204
