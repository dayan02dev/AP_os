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


@router.get("/me")
async def get_me(ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    return {
        "status": ctx["status"],
        "application_id": ctx["application_id"],
        "grant_amount": float(ctx["app"].get("grant_amount") or 0),
        "mou_signed": False,  # real value wired in Task 8
        "locked": {"cohort": ctx["status"] != "onboarded", "dashboard": ctx["status"] != "onboarded"},
    }
