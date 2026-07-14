"""Jury v2 onboarding router.

  POST /admin/platform/jury/invites    Admin-gated bulk invite (manage_jury_roster).
  GET  /jury/respond/{token}           Public. Token → form view.
  POST /jury/respond/{token}           Public, IP rate-limited. Accept/decline;
                                       accept auto-creates the jury account.
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


# ── GET/POST /jury/respond/{token} — public respond endpoints (Task 3) ────


def _resolve_token(admin: Any, token: str) -> dict[str, Any]:
    try:
        result = (admin.table("jury_invites")
                  .select("id,name,email,token,status,invited_by,linkedin_url,expertise_domains")
                  .eq("token", token).limit(1).execute())
    except Exception as exc:
        log.error("jury_invites token lookup failed", extra={"err": str(exc)})
        raise HTTPException(status_code=500, detail="Failed to resolve token") from exc
    if not result.data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail="Invitation not found")
    return result.data[0]


@router.get("/jury/respond/{token}", response_model=JuryFormView)
async def get_jury_form(token: str) -> JuryFormView:
    invite = _resolve_token(get_admin_client(), token)
    return JuryFormView(name=invite["name"], email=invite["email"], status=invite["status"])


def _ensure_jury_account(
    admin: Any, invite: dict, *, reset_password: bool
) -> tuple[str, bool, str | None]:
    """Return (user_id, created_new, temp_password). Idempotent.

    New account → created with a fresh temp password. Existing account →
    when ``reset_password`` is True, its password is reset to a fresh temp
    value so the juror always receives working credentials (there is no other
    way for an external juror to learn their login). ``temp_password`` is
    non-None exactly when a fresh credential should be emailed.
    """
    email_lower = invite["email"].lower()
    existing = (admin.table("profiles").select("id").eq("email", email_lower)
                .limit(1).execute().data or [])
    if existing:
        user_id = existing[0]["id"]
        temp_password: str | None = None
        if reset_password:
            temp_password = secrets.token_urlsafe(16) + "!1Aa"
            admin.auth.admin.update_user_by_id(user_id, {"password": temp_password})
        return user_id, False, temp_password
    temp_password = secrets.token_urlsafe(16) + "!1Aa"
    create = admin.auth.admin.create_user({
        "email": email_lower, "password": temp_password, "email_confirm": True,
    })
    user_id = create.user.id
    admin.table("profiles").upsert({
        "id": user_id, "email": email_lower, "full_name": invite["name"],
    }).execute()
    return user_id, True, temp_password


def _grant_jury_role(admin: Any, user_id: str, granted_by: str | None) -> None:
    current = (admin.table("user_roles").select("role")
               .eq("user_id", user_id).execute().data or [])
    if not any(r.get("role") == "jury" for r in current):
        admin.table("user_roles").insert(
            {"user_id": user_id, "role": "jury", "granted_by": granted_by}).execute()


@router.post("/jury/respond/{token}", status_code=status.HTTP_200_OK)
@limiter.limit("5/hour", key_func=_respond_rate_key)
async def submit_jury_response(
    request: Request, token: str, payload: JuryRespondSubmit,
) -> dict[str, str]:
    admin = get_admin_client()
    invite = _resolve_token(admin, token)
    now = datetime.now(UTC).isoformat()

    # First response wins for the choice; declined stays declined.
    if invite["status"] == "declined":
        return {"status": "already_responded"}
    if not payload.accept:
        if invite["status"] == "accepted":
            return {"status": "already_responded"}
        admin.table("jury_invites").update(
            {"status": "declined", "responded_at": now}).eq("id", invite["id"]).execute()
        return {"status": "ok"}

    # ACCEPT — steps below are idempotent so a repeat POST is a safe retry.
    # First accept issues fresh credentials; a repeat POST (already accepted)
    # must NOT churn the password or re-email — the juror already has creds.
    was_accepted = invite["status"] == "accepted"
    admin.table("jury_invites").update({
        "status": "accepted", "responded_at": invite.get("responded_at") or now,
        "linkedin_url": payload.linkedin_url or invite.get("linkedin_url"),
        "expertise_domains": payload.expertise_domains or invite.get("expertise_domains") or [],
    }).eq("id", invite["id"]).execute()

    try:
        user_id, _created_new, temp_password = _ensure_jury_account(
            admin, invite, reset_password=not was_accepted)
        _grant_jury_role(admin, user_id, invite.get("invited_by"))
    except Exception as exc:
        log.error("jury accept account step failed", extra={"invite_id": invite["id"], "err": str(exc)})
        raise HTTPException(status_code=500, detail="Failed to set up jury access") from exc

    admin.table("jury_profiles").upsert({
        "juror_user_id": user_id, "invite_id": invite["id"],
        "expertise_domains": payload.expertise_domains or [],
        "linkedin_url": payload.linkedin_url,
        "enrichment_status": "pending", "updated_at": now,
    }, on_conflict="juror_user_id").execute()

    # Always email the login id + password on first accept (new OR existing
    # account) — an external juror has no other way to learn their credentials.
    # temp_password is set exactly on first accept; None on a retry.
    if temp_password:
        try:
            get_email_service().send_jury_credentials(
                to=invite["email"], jury_name=invite["name"],
                login_email=invite["email"], temp_password=temp_password,
                portal_url=frontend_url("/jury"))
        except Exception as exc:
            log.warning("jury credentials email failed (best-effort)",
                        extra={"invite_id": invite["id"], "err": str(exc)})

    publish_jury_job("jury_enrich", user_id)   # fire-and-forget; worker chains matching
    return {"status": "ok"}
