"""Reads + derivations for the Founders Resources tabs (procurement store,
fundraising & connects, corporate partners, book ARTPARK assets, IT &
Facilities support). Pure merge helpers are unit-tested directly; the
fetch_* functions read via the service-role admin client, following the
`.eq("application_id", ...)` pattern in founder_query.py."""
from __future__ import annotations

from . import founder_catalog as cat
from ..supabase_client import get_admin_client


# ── DB reads (service-role) ───────────────────────────────────────────────
def _rows(table: str, application_id: str, track: str = "tir",
          order: str | None = "created_at") -> list[dict]:
    sb = get_admin_client()
    q = (
        sb.table(table).select("*")
        .eq("application_id", application_id)
        .eq("track", track)
    )
    if order:
        try:
            q = q.order(order)
        except Exception:  # noqa: BLE001 — order optional
            pass
    return q.execute().data or []


def fetch_cart(application_id: str, track: str = "tir") -> list[dict]:
    return _rows("founder_cart_items", application_id, track)


def fetch_requests(application_id: str, kind: str, track: str = "tir") -> list[dict]:
    sb = get_admin_client()
    return (
        sb.table("founder_resource_requests").select("*")
        .eq("application_id", application_id).eq("kind", kind).eq("track", track)
        .execute().data
        or []
    )


def fetch_bookings(application_id: str, track: str = "tir") -> list[dict]:
    return _rows("founder_bookings", application_id, track, order="date")


def fetch_tickets(application_id: str, track: str = "tir") -> list[dict]:
    return _rows("founder_tickets", application_id, track, order="created_at")


# ── pure merge helpers (mirrors the mockup's derivations) ─────────────────
def merge_catalog(cart: list[dict], quote_requests: list[dict]) -> list[dict]:
    cart_by_product = {c["product_id"]: c for c in cart}
    quoted_ids = {r["ref_id"] for r in quote_requests}
    out = []
    for product in cat.CATALOG:
        row = cart_by_product.get(product["id"])
        out.append({
            **product,
            "in_cart_qty": row["qty"] if row else 0,
            "quote_requested": product["id"] in quoted_ids,
        })
    return out


def build_cart_view(cart: list[dict]) -> list[dict]:
    view = []
    for row in cart:
        product = cat.catalog_by_id(row["product_id"]) or {}
        view.append({
            "product_id": row["product_id"],
            "qty": row["qty"],
            "product": product,
        })
    return view


def cart_subtotal(cart: list[dict]) -> int:
    total = 0
    for row in cart:
        product = cat.catalog_by_id(row["product_id"])
        if not product:
            continue
        total += int(product.get("price") or 0) * int(row.get("qty") or 0)
    return total


def store_bundle(application_id: str, track: str = "tir") -> dict:
    cart = fetch_cart(application_id, track)
    quote_requests = fetch_requests(application_id, "quote", track)
    return {
        "catalog": merge_catalog(cart, quote_requests),
        "cart": build_cart_view(cart),
        "cart_subtotal": cart_subtotal(cart),
    }


def merge_investors(intro_requests: list[dict]) -> list[dict]:
    requested_ids = {r["ref_id"] for r in intro_requests}
    return [
        {**inv, "intro_requested": inv["id"] in requested_ids}
        for inv in cat.INVESTORS
    ]


def fundraising_bundle(application_id: str, track: str = "tir") -> dict:
    intro_requests = fetch_requests(application_id, "intro", track)
    return {
        "investors": merge_investors(intro_requests),
        "tools": cat.FR_TOOLS,
    }


def merge_partners(partner_requests: list[dict]) -> list[dict]:
    requested_ids = {r["ref_id"] for r in partner_requests}
    return [
        {**p, "requested": p["id"] in requested_ids}
        for p in cat.PARTNERS
    ]


def partners_bundle(application_id: str, track: str = "tir") -> dict:
    partner_requests = fetch_requests(application_id, "partner", track)
    return {"partners": merge_partners(partner_requests)}


def assets_bundle(application_id: str, track: str = "tir") -> dict:
    return {
        "assets": cat.ASSETS,
        "bookings": fetch_bookings(application_id, track),
    }


def support_bundle(application_id: str, track: str = "tir") -> dict:
    return {"tickets": fetch_tickets(application_id, track)}


def next_ticket_ref(existing: list[dict], area: str) -> str:
    """IT-104-style sequential ref, scoped per application across both areas
    (mirrors the mockup's single nextTicket counter)."""
    prefix = "IT-" if area == "IT" else "FAC-"
    seq = 100 + len(existing) + 1
    return f"{prefix}{seq}"
