"""Founders Resources tabs: procurement store, fundraising & connects,
corporate partners, book ARTPARK assets, IT & Facilities support.

Same ownership model as founder.py: every route depends on
require_founder_access (caller owns an offered/onboarded TIR application);
all reads/writes are scoped to that application_id via the service-role
client, which the router enforces (not RLS).
"""
from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status

from .founder import require_founder_access
from ..models.founder_resources import (
    BookingIn,
    CartItemIn,
    CartQtyIn,
    IntroIn,
    PartnerRequestIn,
    QuoteRequestIn,
    TicketIn,
)
from ..services import founder_catalog
from ..services import founder_resources_query as frq
from ..supabase_client import get_admin_client

log = logging.getLogger(__name__)

router = APIRouter(prefix="/founder", tags=["founder-resources"])


def _owned_or_404(sb, table: str, row_id: str, application_id: str) -> dict:
    rows = (
        sb.table(table).select("*").eq("id", row_id)
        .eq("application_id", application_id).limit(1).execute().data or []
    )
    if not rows:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND,
                            detail={"code": "not_found"})
    return rows[0]


def _find_request(sb, application_id: str, kind: str, ref_id: str) -> dict | None:
    rows = (
        sb.table("founder_resource_requests").select("*")
        .eq("application_id", application_id).eq("kind", kind).eq("ref_id", ref_id)
        .limit(1).execute().data or []
    )
    return rows[0] if rows else None


# ── Store ───────────────────────────────────────────────────────────────
@router.get("/store")
async def get_store(ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    return frq.store_bundle(ctx["application_id"])


@router.post("/store/cart")
async def add_to_cart(body: CartItemIn, ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    if not founder_catalog.catalog_by_id(body.product_id):
        raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail={"code": "unknown_product"})
    sb = get_admin_client()
    application_id = ctx["application_id"]
    existing = (
        sb.table("founder_cart_items").select("*")
        .eq("application_id", application_id).eq("product_id", body.product_id)
        .limit(1).execute().data or []
    )
    if existing:
        sb.table("founder_cart_items").update(
            {"qty": existing[0]["qty"] + body.qty}
        ).eq("id", existing[0]["id"]).execute()
    else:
        sb.table("founder_cart_items").insert({
            "application_id": application_id,
            "product_id": body.product_id,
            "qty": body.qty,
        }).execute()
    return frq.store_bundle(application_id)


@router.patch("/store/cart/{product_id}")
async def set_cart_qty(product_id: str, body: CartQtyIn,
                       ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    sb = get_admin_client()
    application_id = ctx["application_id"]
    if body.qty <= 0:
        sb.table("founder_cart_items").delete() \
            .eq("application_id", application_id).eq("product_id", product_id).execute()
        return frq.store_bundle(application_id)

    existing = (
        sb.table("founder_cart_items").select("*")
        .eq("application_id", application_id).eq("product_id", product_id)
        .limit(1).execute().data or []
    )
    if existing:
        sb.table("founder_cart_items").update({"qty": body.qty}).eq("id", existing[0]["id"]).execute()
    else:
        if not founder_catalog.catalog_by_id(product_id):
            raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                                detail={"code": "unknown_product"})
        sb.table("founder_cart_items").insert({
            "application_id": application_id, "product_id": product_id, "qty": body.qty,
        }).execute()
    return frq.store_bundle(application_id)


@router.delete("/store/cart/{product_id}")
async def remove_cart_item(product_id: str, ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    sb = get_admin_client()
    application_id = ctx["application_id"]
    sb.table("founder_cart_items").delete() \
        .eq("application_id", application_id).eq("product_id", product_id).execute()
    return frq.store_bundle(application_id)


@router.post("/store/quote-request")
async def request_quote(body: QuoteRequestIn, ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    if not founder_catalog.catalog_by_id(body.product_id):
        raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail={"code": "unknown_product"})
    sb = get_admin_client()
    application_id = ctx["application_id"]
    if not _find_request(sb, application_id, "quote", body.product_id):
        sb.table("founder_resource_requests").insert({
            "application_id": application_id, "kind": "quote", "ref_id": body.product_id,
        }).execute()
    return {"quote_requested": True}


@router.post("/store/push-to-procurement")
async def push_to_procurement(ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    sb = get_admin_client()
    application_id = ctx["application_id"]
    cart = frq.fetch_cart(application_id)
    pushed = 0
    for row in cart:
        product = founder_catalog.catalog_by_id(row["product_id"])
        if not product:
            continue
        sb.table("founder_procurement_items").insert({
            "application_id": application_id,
            "item": product["name"],
            # 037's category check allows BOM/Equipment/Other/Service (widened
            # in 038 for this feature) — Prototyping-catalog items are
            # service work, not a bill-of-materials line.
            "category": "Service" if product["cat"] == "Prototyping" else "BOM",
            "qty": row["qty"],
            "estimate": product["price"],
            "vendor": product["vendor"],
            "quote": 0,
            "lead_weeks": 0,
            "status": "estimate",
        }).execute()
        pushed += 1
    sb.table("founder_cart_items").delete().eq("application_id", application_id).execute()
    return {"pushed": pushed}


# ── Fundraising & connects ────────────────────────────────────────────────
@router.get("/fundraising")
async def get_fundraising(ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    return frq.fundraising_bundle(ctx["application_id"])


@router.post("/fundraising/intro")
async def toggle_intro(body: IntroIn, ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    if not founder_catalog.investor_by_id(body.investor_id):
        raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail={"code": "unknown_investor"})
    sb = get_admin_client()
    application_id = ctx["application_id"]
    existing = _find_request(sb, application_id, "intro", body.investor_id)
    if existing:
        sb.table("founder_resource_requests").delete().eq("id", existing["id"]).execute()
        return {"intro_requested": False}
    sb.table("founder_resource_requests").insert({
        "application_id": application_id, "kind": "intro", "ref_id": body.investor_id,
    }).execute()
    return {"intro_requested": True}


# ── Corporate partners ─────────────────────────────────────────────────────
@router.get("/partners")
async def get_partners(ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    return frq.partners_bundle(ctx["application_id"])


@router.post("/partners/request")
async def toggle_partner(body: PartnerRequestIn, ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    if not founder_catalog.partner_by_id(body.partner_id):
        raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail={"code": "unknown_partner"})
    sb = get_admin_client()
    application_id = ctx["application_id"]
    existing = _find_request(sb, application_id, "partner", body.partner_id)
    if existing:
        sb.table("founder_resource_requests").delete().eq("id", existing["id"]).execute()
        return {"requested": False}
    sb.table("founder_resource_requests").insert({
        "application_id": application_id, "kind": "partner", "ref_id": body.partner_id,
    }).execute()
    return {"requested": True}


# ── Book ARTPARK assets ─────────────────────────────────────────────────────
@router.get("/assets")
async def get_assets(ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    return frq.assets_bundle(ctx["application_id"])


@router.post("/assets/bookings")
async def create_booking(body: BookingIn, ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    asset = founder_catalog.asset_by_id(body.asset_id)
    if not asset:
        raise HTTPException(status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail={"code": "unknown_asset"})
    sb = get_admin_client()
    row = sb.table("founder_bookings").insert({
        "application_id": ctx["application_id"],
        "asset_id": body.asset_id,
        "asset_name": asset["name"],
        "date": body.date,
        "slot": body.slot,
        "status": "pending",
    }).execute().data[0]
    return row


@router.delete("/assets/bookings/{row_id}", status_code=http_status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_booking(row_id: str, ctx: Annotated[dict, Depends(require_founder_access)]) -> None:
    sb = get_admin_client()
    _owned_or_404(sb, "founder_bookings", row_id, ctx["application_id"])
    sb.table("founder_bookings").delete().eq("id", row_id).execute()


# ── IT & Facilities support ──────────────────────────────────────────────
@router.get("/support")
async def get_support(ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    return frq.support_bundle(ctx["application_id"])


@router.post("/support/tickets")
async def create_ticket(body: TicketIn, ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    sb = get_admin_client()
    application_id = ctx["application_id"]
    existing = frq.fetch_tickets(application_id)
    ref = frq.next_ticket_ref(existing, body.area)
    row = sb.table("founder_tickets").insert({
        "application_id": application_id,
        "ref": ref,
        "area": body.area,
        "priority": body.priority,
        "subject": body.subject,
        "description": body.description,
        "status": "open",
    }).execute().data[0]
    return row
