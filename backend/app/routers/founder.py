"""TIR post-onboarding Founder Portal endpoints (Wave 1).

Gate: the caller must own a TIR application whose status is 'offered' or
'onboarded'. Access is by ownership, not RBAC role — this is the applicant's
own data. All reads/writes go through the service-role admin client; the
router enforces application_id ↔ user_id ownership.
"""
from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status

from ..config import settings
from ..deps import get_current_user
from ..models.founder import (
    ApproachIn,
    BomItemIn,
    BomItemPatch,
    EquipmentItemIn,
    EquipmentItemPatch,
    MouSignRequest,
    ProcurementItemIn,
    ProcurementItemPatch,
    TeamMemberIn,
    TeamMemberPatch,
)
from ..services import founder_mou, founder_query
from ..supabase_client import get_admin_client

log = logging.getLogger(__name__)

router = APIRouter(prefix="/founder", tags=["founder"])

_ACCESS_STATUSES = ("offered", "onboarded")


class FounderContext(dict):
    """{'user_id', 'application_id', 'status', 'app'} — the caller's onboarded TIR app."""


async def require_founder_access(
    user: Annotated[dict, Depends(get_current_user)],
) -> FounderContext:
    """Resolve the caller's most-recent offered/onboarded TIR application.

    Two independent gates, both of which must pass:

      1. Soft-launch allow-list. While FOUNDER_PORTAL_ALLOWLIST is non-empty,
         only the listed emails may open the portal — even if an admin
         advances someone else's application to 'offered'. Clearing the env
         var opens the portal to every offered/onboarded founder, which is the
         intended end state; we keep it set during the soft launch.
      2. Ownership + status: the caller must own a TIR application whose
         status is 'offered' or 'onboarded'.

    403 founder_access_denied on either failure. The two cases return the same
    code deliberately — a non-allow-listed founder shouldn't be able to tell
    the portal exists.
    """
    if not settings.founder_portal_allows(user.get("email")):
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail={"code": "founder_access_denied"},
        )
    sb = get_admin_client()
    rows = (
        sb.table("tir_applications")
        .select("id,status,grant_amount,submitted_at")
        .eq("user_id", user["user_id"])
        .in_("status", list(_ACCESS_STATUSES))
        .order("submitted_at", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail={"code": "founder_access_denied"},
        )
    app = rows[0]
    return FounderContext(
        user_id=user["user_id"],
        application_id=app["id"],
        status=app["status"],
        app=app,
    )


def _project_name(app: dict) -> str:
    emb = app.get("ai_screening_project_name")
    if isinstance(emb, list) and emb:
        return emb[0].get("project_name") or ""
    if isinstance(emb, dict):
        return emb.get("project_name") or ""
    return ""


@router.get("/me")
async def get_me(ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    mou = founder_query.fetch_mou(ctx["application_id"])
    signed = mou is not None
    return {
        "status": ctx["status"],
        "application_id": ctx["application_id"],
        "grant_amount": float(ctx["app"].get("grant_amount") or 0),
        "project_name": _project_name(ctx["app"]),
        "mou_signed": signed,
        "locked": {
            "cohort": ctx["status"] != "onboarded",
            "dashboard": ctx["status"] != "onboarded",
        },
    }


@router.get("/mou")
async def get_mou(ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    mou = founder_query.fetch_mou(ctx["application_id"])
    body = founder_mou.render_body(
        founder_name=_signer_default(ctx), venture=_project_name(ctx["app"]), date_str=""
    )
    return {
        "template_version": founder_mou.TEMPLATE_VERSION,
        "body": body,
        "signed": mou is not None,
        "signed_at": (mou or {}).get("signed_at"),
        "signer_name": (mou or {}).get("signer_name"),
        # Server-owned checklist — the browser renders exactly what we send
        # here rather than holding its own copy of the wording.
        "acknowledgements": founder_mou.ACKNOWLEDGEMENTS,
        "accepted_acknowledgements": (mou or {}).get("acknowledgements") or [],
    }


def _signer_default(ctx: dict) -> str:
    # best-effort: profile full_name; falls back to empty (FE prefills)
    rows = (
        get_admin_client().table("profiles").select("full_name")
        .eq("id", ctx["user_id"]).limit(1).execute().data or []
    )
    return (rows[0].get("full_name") if rows else "") or ""


@router.post("/mou/sign")
async def sign_mou(
    payload: MouSignRequest,
    ctx: Annotated[dict, Depends(require_founder_access)],
) -> dict:
    try:
        row = founder_mou.sign_and_onboard(
            application_id=ctx["application_id"],
            user_id=ctx["user_id"],
            signer_name=payload.signer_name,
            founder_name=payload.signer_name,
            venture=_project_name(ctx["app"]),
            signature_png=payload.signature_png,
            acknowledgements=payload.acknowledgements,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "invalid_signature", "message": str(exc)},
        ) from exc
    return {"signed": True, "signed_at": row["signed_at"], "status": "onboarded"}


@router.get("/mou/signed-url")
async def mou_signed_url(ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    url = founder_mou.signed_pdf_url(ctx["application_id"])
    if not url:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail={"code": "mou_not_signed"},
        )
    return {"url": url}


def _owned_or_404(sb, table: str, row_id: str, application_id: str) -> dict:
    rows = (
        sb.table(table).select("*").eq("id", row_id)
        .eq("application_id", application_id).limit(1).execute().data or []
    )
    if not rows:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND,
                            detail={"code": "not_found"})
    return rows[0]


# ── Organization / team ───────────────────────────────────────────────────
@router.get("/team")
async def list_team(ctx: Annotated[dict, Depends(require_founder_access)]) -> list[dict]:
    return founder_query.fetch_team(ctx["application_id"])


@router.post("/team")
async def add_team(body: TeamMemberIn, ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    sb = get_admin_client()
    row = {**body.model_dump(), "application_id": ctx["application_id"]}
    return sb.table("founder_team_members").insert(row).execute().data[0]


@router.patch("/team/{row_id}")
async def edit_team(row_id: str, body: TeamMemberPatch,
                    ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    sb = get_admin_client()
    _owned_or_404(sb, "founder_team_members", row_id, ctx["application_id"])
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    return sb.table("founder_team_members").update(patch).eq("id", row_id).execute().data[0]


@router.delete("/team/{row_id}", status_code=http_status.HTTP_204_NO_CONTENT, response_model=None)
async def del_team(row_id: str, ctx: Annotated[dict, Depends(require_founder_access)]) -> None:
    sb = get_admin_client()
    _owned_or_404(sb, "founder_team_members", row_id, ctx["application_id"])
    sb.table("founder_team_members").delete().eq("id", row_id).execute()


# ── Approach (hats) — single upsert row ───────────────────────────────────
@router.get("/approach")
async def get_approach(ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    return founder_query.fetch_approach(ctx["application_id"])


@router.put("/approach")
async def put_approach(body: ApproachIn, ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    sb = get_admin_client()
    row = {**body.model_dump(), "application_id": ctx["application_id"]}
    return sb.table("founder_approach").upsert(row, on_conflict="application_id").execute().data[0]


# ── BOM ───────────────────────────────────────────────────────────────────
@router.post("/bom")
async def add_bom(body: BomItemIn, ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    sb = get_admin_client()
    return sb.table("founder_bom_items").insert(
        {**body.model_dump(), "application_id": ctx["application_id"]}).execute().data[0]


@router.patch("/bom/{row_id}")
async def edit_bom(row_id: str, body: BomItemPatch,
                   ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    sb = get_admin_client()
    _owned_or_404(sb, "founder_bom_items", row_id, ctx["application_id"])
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    return sb.table("founder_bom_items").update(patch).eq("id", row_id).execute().data[0]


@router.delete("/bom/{row_id}", status_code=http_status.HTTP_204_NO_CONTENT, response_model=None)
async def del_bom(row_id: str, ctx: Annotated[dict, Depends(require_founder_access)]) -> None:
    sb = get_admin_client()
    _owned_or_404(sb, "founder_bom_items", row_id, ctx["application_id"])
    sb.table("founder_bom_items").delete().eq("id", row_id).execute()


# ── Equipment ─────────────────────────────────────────────────────────────
@router.post("/equipment")
async def add_equipment(body: EquipmentItemIn, ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    sb = get_admin_client()
    return sb.table("founder_equipment_items").insert(
        {**body.model_dump(), "application_id": ctx["application_id"]}).execute().data[0]


@router.patch("/equipment/{row_id}")
async def edit_equipment(row_id: str, body: EquipmentItemPatch,
                         ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    sb = get_admin_client()
    _owned_or_404(sb, "founder_equipment_items", row_id, ctx["application_id"])
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    return sb.table("founder_equipment_items").update(patch).eq("id", row_id).execute().data[0]


@router.delete("/equipment/{row_id}", status_code=http_status.HTTP_204_NO_CONTENT, response_model=None)
async def del_equipment(row_id: str, ctx: Annotated[dict, Depends(require_founder_access)]) -> None:
    sb = get_admin_client()
    _owned_or_404(sb, "founder_equipment_items", row_id, ctx["application_id"])
    sb.table("founder_equipment_items").delete().eq("id", row_id).execute()


# ── Procurement ───────────────────────────────────────────────────────────
@router.post("/procurement")
async def add_proc(body: ProcurementItemIn, ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    sb = get_admin_client()
    return sb.table("founder_procurement_items").insert(
        {**body.model_dump(), "application_id": ctx["application_id"]}).execute().data[0]


@router.patch("/procurement/{row_id}")
async def edit_proc(row_id: str, body: ProcurementItemPatch,
                    ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    sb = get_admin_client()
    _owned_or_404(sb, "founder_procurement_items", row_id, ctx["application_id"])
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    return sb.table("founder_procurement_items").update(patch).eq("id", row_id).execute().data[0]


@router.delete("/procurement/{row_id}", status_code=http_status.HTTP_204_NO_CONTENT, response_model=None)
async def del_proc(row_id: str, ctx: Annotated[dict, Depends(require_founder_access)]) -> None:
    sb = get_admin_client()
    _owned_or_404(sb, "founder_procurement_items", row_id, ctx["application_id"])
    sb.table("founder_procurement_items").delete().eq("id", row_id).execute()


@router.get("/expense")
async def get_expense(ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    return founder_query.expense_bundle(
        ctx["application_id"], float(ctx["app"].get("grant_amount") or 0)
    )


@router.get("/dashboard")
async def get_dashboard(ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    mou_signed = founder_query.fetch_mou(ctx["application_id"]) is not None
    return founder_query.dashboard_bundle(
        ctx["application_id"], ctx["status"],
        float(ctx["app"].get("grant_amount") or 0), mou_signed,
    )
