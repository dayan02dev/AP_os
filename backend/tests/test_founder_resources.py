"""Founders Resources tabs: procurement store, fundraising & connects,
corporate partners, book ARTPARK assets, IT & Facilities support."""
from __future__ import annotations

import pytest

from app.deps import get_current_user
from app.main import app
from tests.fixtures.fake_supabase import FakeSupabase


@pytest.fixture
def _clear():
    yield
    app.dependency_overrides.clear()


def _override_user(uid):
    def _f():
        return {"user_id": uid, "email": f"{uid}@x.com", "track": "tir", "roles": ["applicant"]}
    return _f


def _install(monkeypatch, tables):
    from app.routers import founder as fr
    from app.routers import founder_resources as frr
    from app.services import founder_resources_query as frq
    fake = FakeSupabase(tables)
    for mod in (fr, frr, frq):
        monkeypatch.setattr(mod, "get_admin_client", lambda: fake)
    return fake


_APP = {"id": "app1", "user_id": "u1", "status": "onboarded",
        "grant_amount": 2500000, "submitted_at": "2026-07-01"}


# ── Store ───────────────────────────────────────────────────────────────
def test_get_store_merges_cart_and_quote_flags(client, monkeypatch, _clear):
    _install(monkeypatch, {
        "tir_applications": [_APP],
        "founder_cart_items": [
            {"id": "ci1", "application_id": "app1", "product_id": "c1", "qty": 2},
        ],
        "founder_resource_requests": [
            {"id": "r1", "application_id": "app1", "kind": "quote", "ref_id": "c6"},
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    body = client.get("/founder/store").json()
    assert len(body["catalog"]) == 12
    c1 = next(c for c in body["catalog"] if c["id"] == "c1")
    assert c1["in_cart_qty"] == 2
    assert c1["quote_requested"] is False
    c6 = next(c for c in body["catalog"] if c["id"] == "c6")
    assert c6["quote_requested"] is True
    assert body["cart"][0]["product_id"] == "c1"
    assert body["cart"][0]["product"]["name"] == "MEMS microphone array (8-ch)"
    assert body["cart_subtotal"] == 8200 * 2


def test_add_to_cart_then_get_reflects_qty(client, monkeypatch, _clear):
    fake = _install(monkeypatch, {
        "tir_applications": [_APP],
        "founder_cart_items": [],
        "founder_resource_requests": [],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.post("/founder/store/cart", json={"product_id": "c3", "qty": 1})
    assert r.status_code == 200, r.text
    assert fake.tables["founder_cart_items"][0]["qty"] == 1

    # add again -> increments (mirrors mockup addToCart semantics)
    r2 = client.post("/founder/store/cart", json={"product_id": "c3", "qty": 2})
    assert r2.status_code == 200, r2.text
    assert fake.tables["founder_cart_items"][0]["qty"] == 3

    body = client.get("/founder/store").json()
    c3 = next(c for c in body["catalog"] if c["id"] == "c3")
    assert c3["in_cart_qty"] == 3


def test_set_cart_qty_zero_deletes_line(client, monkeypatch, _clear):
    fake = _install(monkeypatch, {
        "tir_applications": [_APP],
        "founder_cart_items": [
            {"id": "ci1", "application_id": "app1", "product_id": "c1", "qty": 2},
        ],
        "founder_resource_requests": [],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.patch("/founder/store/cart/c1", json={"qty": 0})
    assert r.status_code == 200, r.text
    assert fake.tables["founder_cart_items"] == []


def test_quote_request_is_idempotent(client, monkeypatch, _clear):
    fake = _install(monkeypatch, {
        "tir_applications": [_APP],
        "founder_cart_items": [],
        "founder_resource_requests": [],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    for _ in range(2):
        r = client.post("/founder/store/quote-request", json={"product_id": "c6"})
        assert r.status_code == 200, r.text
        assert r.json() == {"quote_requested": True}
    assert len(fake.tables["founder_resource_requests"]) == 1


def test_push_to_procurement_inserts_and_clears_cart(client, monkeypatch, _clear):
    fake = _install(monkeypatch, {
        "tir_applications": [_APP],
        "founder_cart_items": [
            {"id": "ci1", "application_id": "app1", "product_id": "c1", "qty": 2},
            {"id": "ci2", "application_id": "app1", "product_id": "c5", "qty": 1},
        ],
        "founder_resource_requests": [],
        "founder_procurement_items": [],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.post("/founder/store/push-to-procurement")
    assert r.status_code == 200, r.text
    assert r.json() == {"pushed": 2}
    assert fake.tables["founder_cart_items"] == []
    proc = fake.tables["founder_procurement_items"]
    assert len(proc) == 2
    row1 = next(p for p in proc if p["item"] == "MEMS microphone array (8-ch)")
    assert row1["category"] == "BOM"
    assert row1["qty"] == 2
    assert row1["estimate"] == 8200
    assert row1["vendor"] == "Knowles"
    assert row1["quote"] == 0
    assert row1["lead_weeks"] == 0
    assert row1["status"] == "estimate"
    row2 = next(p for p in proc if p["item"] == "Resin 3D printing (per part)")
    assert row2["category"] == "Service"  # cat == "Prototyping"


# ── Fundraising & connects ────────────────────────────────────────────────
def test_fundraising_investors_and_intro_toggle(client, monkeypatch, _clear):
    fake = _install(monkeypatch, {
        "tir_applications": [_APP],
        "founder_resource_requests": [],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    body = client.get("/founder/fundraising").json()
    assert len(body["investors"]) == 4
    assert len(body["tools"]) == 4
    assert all(i["intro_requested"] is False for i in body["investors"])

    r_on = client.post("/founder/fundraising/intro", json={"investor_id": "i1"})
    assert r_on.status_code == 200, r_on.text
    assert r_on.json() == {"intro_requested": True}
    assert len(fake.tables["founder_resource_requests"]) == 1

    r_off = client.post("/founder/fundraising/intro", json={"investor_id": "i1"})
    assert r_off.status_code == 200, r_off.text
    assert r_off.json() == {"intro_requested": False}
    assert fake.tables["founder_resource_requests"] == []


# ── Corporate partners ─────────────────────────────────────────────────────
def test_partners_request_toggle(client, monkeypatch, _clear):
    fake = _install(monkeypatch, {
        "tir_applications": [_APP],
        "founder_resource_requests": [],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    body = client.get("/founder/partners").json()
    assert len(body["partners"]) == 4

    r_on = client.post("/founder/partners/request", json={"partner_id": "pt2"})
    assert r_on.json() == {"requested": True}
    r_off = client.post("/founder/partners/request", json={"partner_id": "pt2"})
    assert r_off.json() == {"requested": False}
    assert fake.tables["founder_resource_requests"] == []


# ── Book ARTPARK assets ─────────────────────────────────────────────────────
def test_create_booking_appears_in_get(client, monkeypatch, _clear):
    _install(monkeypatch, {
        "tir_applications": [_APP],
        "founder_bookings": [],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.post("/founder/assets/bookings", json={
        "asset_id": "a1", "date": "2026-08-01", "slot": "Morning (9–1)",
    })
    assert r.status_code == 200, r.text
    row = r.json()
    assert row["asset_name"] == "NICU test bench (Class II)"
    assert row["status"] == "pending"

    body = client.get("/founder/assets").json()
    assert len(body["assets"]) == 5
    assert len(body["bookings"]) == 1
    assert body["bookings"][0]["asset_id"] == "a1"


def test_create_booking_unknown_asset_422(client, monkeypatch, _clear):
    _install(monkeypatch, {
        "tir_applications": [_APP],
        "founder_bookings": [],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.post("/founder/assets/bookings", json={
        "asset_id": "nope", "date": "2026-08-01", "slot": "Morning (9–1)",
    })
    assert r.status_code == 422


# ── IT & Facilities support ──────────────────────────────────────────────
def test_create_ticket_generates_ref_and_appears_in_get(client, monkeypatch, _clear):
    _install(monkeypatch, {
        "tir_applications": [_APP],
        "founder_tickets": [],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.post("/founder/support/tickets", json={
        "area": "IT", "priority": "High", "subject": "GPU access", "description": "Need it soon",
    })
    assert r.status_code == 200, r.text
    row = r.json()
    assert row["ref"] == "IT-101"
    assert row["status"] == "open"

    r2 = client.post("/founder/support/tickets", json={
        "area": "Facilities", "priority": "Low", "subject": "Broken outlet",
    })
    assert r2.json()["ref"] == "FAC-102"

    body = client.get("/founder/support").json()
    assert len(body["tickets"]) == 2


def test_cannot_delete_another_apps_booking(client, monkeypatch, _clear):
    _install(monkeypatch, {
        "tir_applications": [_APP],
        "founder_bookings": [{"id": "bk-other", "application_id": "app-OTHER",
                              "asset_id": "a1", "asset_name": "X", "date": "2026-08-01",
                              "slot": "Morning (9–1)", "status": "pending"}],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.delete("/founder/assets/bookings/bk-other")
    assert r.status_code == 404
