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

from ..deps import get_current_user
from ..models.founder import MouSignRequest
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

    403 founder_access_denied if the user has no such application.
    """
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
