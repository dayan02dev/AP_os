"""Mentor onboarding router.

Endpoints:
  POST /mentors/invites          Admin-gated. Bulk-invite mentors by email; sends
                                 branded invitation email with a tokenised form link.
  GET  /mentors/respond/{token}  Public. Resolve a token → MentorFormView.
  POST /mentors/respond/{token}  Public, IP rate-limited. Submit a mentor's response.
"""

# NOTE: deliberately no `from __future__ import annotations` — FastAPI +
# pydantic 2 cannot resolve stringified `Annotated` annotations on Depends.

import logging
import secrets
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from slowapi.util import get_remote_address

from ..config import settings
from ..models.mentor import MentorFormView, MentorInviteCreate, MentorResponseSubmit
from ..rbac import require_capability
from ..services.email_service import get_email_service
from ..supabase_client import get_admin_client
from ..utils.rate_limit import limiter

log = logging.getLogger(__name__)

router = APIRouter(prefix="/mentors", tags=["mentors"])


def _respond_rate_key(request: Request) -> str:
    return f"mentor-respond:{get_remote_address(request)}"


# ── POST /mentors/invites ──────────────────────────────────────────────────

@router.post(
    "/invites",
    dependencies=[Depends(require_capability("manage_users"))],
    status_code=status.HTTP_200_OK,
)
async def create_mentor_invites(payload: MentorInviteCreate) -> dict[str, Any]:
    admin = get_admin_client()
    email_service = get_email_service()
    results = []

    for item in payload.invites:
        email_lower = item.email.lower().strip()

        # Check for existing invite by email (case-insensitive).
        try:
            existing = (
                admin.table("mentor_invites")
                .select("id,token,status")
                .ilike("email", email_lower)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            log.error(
                "mentor_invites check failed",
                extra={"email": email_lower, "err": str(exc)},
            )
            results.append({"email": email_lower, "status": "error", "form_url": None})
            continue

        if existing.data:
            row = existing.data[0]
            token = row["token"]
            form_url = _build_form_url(token)
            results.append({"email": email_lower, "status": "already_invited", "form_url": form_url})
            continue

        # Insert new invite.
        token = secrets.token_urlsafe(24)
        form_url = _build_form_url(token)
        try:
            insert = admin.table("mentor_invites").insert({
                "name": item.name.strip(),
                "email": email_lower,
                "token": token,
                "invited_by": payload.invited_by,
                "status": "invited",
            }).execute()
        except Exception as exc:
            log.error(
                "mentor_invites insert failed",
                extra={"email": email_lower, "err": str(exc)},
            )
            results.append({"email": email_lower, "status": "error", "form_url": None})
            continue

        if not insert.data:
            results.append({"email": email_lower, "status": "error", "form_url": None})
            continue

        invite_id = insert.data[0]["id"]

        # Send invitation email (best-effort — never fail the insert).
        try:
            email_service.send_mentor_invite(
                to=email_lower,
                mentor_name=item.name.strip(),
                form_url=form_url,
                reply_to=settings.mentor_invite_reply_to,
            )
            # Stamp sent_at + status on success.
            admin.table("mentor_invites").update({
                "sent_at": "now()",
                "status": "invited",
            }).eq("id", invite_id).execute()
        except Exception as exc:
            log.warning(
                "mentor invite email failed (best-effort)",
                extra={"email": email_lower, "err": str(exc)},
            )

        results.append({"email": email_lower, "status": "invited", "form_url": form_url})

    return {"results": results}


# ── GET /mentors/respond/{token} ───────────────────────────────────────────

@router.get(
    "/respond/{token}",
    response_model=MentorFormView,
    status_code=status.HTTP_200_OK,
)
async def get_mentor_form(token: str) -> MentorFormView:
    admin = get_admin_client()

    invite = _resolve_token(admin, token)

    # Check for existing response.
    try:
        resp_check = (
            admin.table("mentor_responses")
            .select("id")
            .eq("invite_id", invite["id"])
            .limit(1)
            .execute()
        )
        already_responded = bool(resp_check.data)
    except Exception as exc:
        log.warning(
            "mentor_responses check failed",
            extra={"invite_id": invite["id"], "err": str(exc)},
        )
        already_responded = False

    return MentorFormView(
        mentor_name=invite["name"],
        email=invite["email"],
        already_responded=already_responded,
    )


# ── POST /mentors/respond/{token} ──────────────────────────────────────────

@router.post(
    "/respond/{token}",
    status_code=status.HTTP_200_OK,
)
@limiter.limit("5/hour", key_func=_respond_rate_key)
async def submit_mentor_response(
    request: Request,
    token: str,
    payload: MentorResponseSubmit,
) -> dict[str, str]:
    admin = get_admin_client()
    invite = _resolve_token(admin, token)
    invite_id = invite["id"]

    # Idempotency: if already responded, return success silently.
    try:
        existing = (
            admin.table("mentor_responses")
            .select("id")
            .eq("invite_id", invite_id)
            .limit(1)
            .execute()
        )
        if existing.data:
            return {"status": "ok"}
    except Exception as exc:
        log.warning(
            "mentor_responses idempotency check failed",
            extra={"invite_id": invite_id, "err": str(exc)},
        )

    ip_addr = get_remote_address(request)
    user_agent = request.headers.get("user-agent")

    bank_details_json: Any = None
    bank_details_provided = False
    if payload.bank_details is not None:
        bank_details_json = payload.bank_details.model_dump()
        bank_details_provided = True

    row: dict[str, Any] = {
        "invite_id": invite_id,
        "willing": payload.willing,
        "days_available": payload.days_available,
        "honorarium_opt_in": payload.honorarium_opt_in,
        "bank_details": bank_details_json,
        "future_comms_opt_in": payload.future_comms_opt_in,
        "contact_email": str(payload.contact_email) if payload.contact_email else None,
        "ip_addr": ip_addr,
        "user_agent": user_agent,
    }

    try:
        admin.table("mentor_responses").insert(row).execute()
    except Exception as exc:
        log.error(
            "mentor_responses insert failed",
            extra={"invite_id": invite_id, "err": str(exc)},
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to record response",
        ) from exc

    # Update invite status.
    new_status = "responded" if payload.willing else "declined"
    try:
        admin.table("mentor_invites").update({"status": new_status}).eq("id", invite_id).execute()
    except Exception as exc:
        log.warning(
            "mentor_invites status update failed",
            extra={"invite_id": invite_id, "err": str(exc)},
        )

    # Staff notification (best-effort). Never include raw bank numbers.
    try:
        response_ctx = {
            "willing": payload.willing,
            "days_available": payload.days_available,
            "honorarium_opt_in": payload.honorarium_opt_in,
            "bank_details_provided": bank_details_provided,
            "future_comms_opt_in": payload.future_comms_opt_in,
            "contact_email": str(payload.contact_email) if payload.contact_email else None,
        }
        get_email_service().send_mentor_response_notification(
            to=settings.mentor_recipients_list,
            mentor={"name": invite["name"], "email": invite["email"]},
            response=response_ctx,
            reply_to=invite["email"],
        )
    except Exception as exc:
        log.warning(
            "mentor response notification failed (best-effort)",
            extra={"invite_id": invite_id, "err": str(exc)},
        )

    return {"status": "ok"}


# ── Helpers ────────────────────────────────────────────────────────────────

def _build_form_url(token: str) -> str:
    base = (settings.frontend_origins or ["http://localhost:5173"])[0].rstrip("/")
    return f"{base}/mentors/respond/{token}"


def _resolve_token(admin: Any, token: str) -> dict[str, Any]:
    """Resolve a token to an invite row; 404 if none."""
    try:
        result = (
            admin.table("mentor_invites")
            .select("id,name,email,token,status")
            .eq("token", token)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        log.error("mentor_invites token lookup failed", extra={"err": str(exc)})
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to resolve token",
        ) from exc

    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Invitation not found",
        )
    return result.data[0]
