"""Jury v2 onboarding router.

  POST /admin/platform/jury/invites    Admin-gated bulk invite (manage_jury_roster).
  GET  /jury/respond/{token}           Public. Token → form view.            [Task 3]
  POST /jury/respond/{token}           Public, IP rate-limited. Accept/decline;
                                       accept auto-creates the jury account.  [Task 3]
"""
# NOTE: no `from __future__ import annotations` — FastAPI + pydantic 2 cannot
# resolve stringified Annotated deps (same constraint as routers/mentors.py).

import logging
import secrets
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from slowapi.util import get_remote_address

from ..config import settings
from ..deps import get_current_user
from ..models.jury import JuryFormView, JuryInviteCreate, JuryRespondSubmit
from ..rbac import require_capability
from ..services.email_service import frontend_url, get_email_service
from ..services.sqs_publisher import publish_jury_job
from ..supabase_client import get_admin_client
from ..utils.rate_limit import limiter

log = logging.getLogger(__name__)

router = APIRouter(tags=["jury-invites"])


def _respond_rate_key(request: Request) -> str:
    return f"jury-respond:{get_remote_address(request)}"


def _form_url(token: str) -> str:
    return frontend_url(f"/jury/respond/{token}")


@router.post(
    "/admin/platform/jury/invites",
    dependencies=[Depends(require_capability("manage_jury_roster"))],
    status_code=status.HTTP_200_OK,
)
async def create_jury_invites(
    payload: JuryInviteCreate, current_user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    admin = get_admin_client()
    email_service = get_email_service()
    results = []
    for item in payload.invites:
        email_lower = item.email.lower().strip()
        try:
            existing = (admin.table("jury_invites").select("id,token,status")
                        .eq("email", email_lower).limit(1).execute())
        except Exception as exc:
            log.error("jury_invites check failed", extra={"email": email_lower, "err": str(exc)})
            results.append({"email": email_lower, "status": "error", "form_url": None})
            continue
        if existing.data:
            results.append({"email": email_lower, "status": "already_invited",
                            "form_url": _form_url(existing.data[0]["token"])})
            continue
        token = secrets.token_urlsafe(24)
        try:
            insert = admin.table("jury_invites").insert({
                "name": item.name.strip(), "email": email_lower, "token": token,
                "invited_by": current_user["user_id"], "status": "invited",
            }).execute()
        except Exception as exc:
            log.error("jury_invites insert failed", extra={"email": email_lower, "err": str(exc)})
            results.append({"email": email_lower, "status": "error", "form_url": None})
            continue
        if not insert.data:
            results.append({"email": email_lower, "status": "error", "form_url": None})
            continue
        try:
            email_service.send_jury_invite(
                to=email_lower, jury_name=item.name.strip(),
                form_url=_form_url(token), reply_to=settings.jury_invite_reply_to)
            admin.table("jury_invites").update(
                {"sent_at": datetime.now(UTC).isoformat()}).eq("id", insert.data[0]["id"]).execute()
        except Exception as exc:
            log.warning("jury invite email failed (best-effort)",
                        extra={"email": email_lower, "err": str(exc)})
        results.append({"email": email_lower, "status": "invited", "form_url": _form_url(token)})
    return {"results": results}


# NOTE: the public GET/POST /jury/respond/{token} endpoints (accept/decline,
# account auto-creation, profile upsert, enrich-job publish) are appended to
# this file in Task 3. `publish_jury_job` and `HTTPException`/`JuryFormView`/
# `JuryRespondSubmit` are imported above in anticipation of that task.
