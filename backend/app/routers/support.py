"""Support router — ticket intake + outbound SES email (Phase 6).

Endpoints
    POST /support/ticket       Optional auth. File a ticket; fan out email to
                               staff + ack to submitter. Never rolls the DB
                               insert back on email failure.
    GET  /support/tickets/me   Required auth. List caller's own tickets.

Rate limiting
    3/hour per IP for anonymous submitters.
    10/hour per bearer-token-bucket for authenticated submitters.
    (Both are additive on top of the global 60/min/IP default from main.py.)

`get_current_user_optional` is defined locally rather than shared via deps.py
because the optional-auth pattern is only used here; the authoritative
`get_current_user` from deps.py is reused for the required-auth route.
"""

# NOTE: deliberately no `from __future__ import annotations` — FastAPI +
# pydantic 2 cannot resolve stringified `Annotated[Model, Depends(...)]`
# annotations, so keep runtime (non-stringified) type hints in this file.

import logging
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from slowapi.util import get_remote_address

from ..config import settings
from ..deps import CurrentUser, get_current_user
from ..models.support import (
    SupportTicketCreate,
    SupportTicketCreateResponse,
    SupportTicketListResponse,
    SupportTicketRead,
)
from ..services.access_request_flag import looks_like_access_request
from ..services.email_service import EmailDeliveryError, get_email_service
from ..supabase_client import get_admin_client
from ..utils.rate_limit import limiter, per_user_rate_limit

# 60/min/user on GET /tickets/me (the authed listing endpoint).
_rl_list_my_tickets = per_user_rate_limit("support-list-me", 60, 60)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/support", tags=["support"])


# ── Optional-auth dependency ───────────────────────────────────────────
# Returns None if no Bearer token is present or the token is invalid, so
# anonymous submitters can still file tickets. Any auth failure degrades to
# anonymous rather than 401 — this is the one place in the API where that
# behaviour is desired.
async def get_current_user_optional(
    authorization: Annotated[str | None, Header()] = None,
) -> CurrentUser | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    try:
        return await get_current_user(authorization=authorization)
    except HTTPException:
        return None


# ── Hardcoded default support recipients ───────────────────────────────
# Used when SUPPORT_RECIPIENT_EMAILS is not set in the environment. These must
# be verified in SES while the account is in sandbox mode.
DEFAULT_SUPPORT_RECIPIENTS: list[str] = [
    "dev@artpark.in",
    "udayan.pawar@artpark.in",
    "nirav@artpark.in",
]


def _resolve_support_recipients() -> list[str]:
    configured = settings.support_recipients_list
    return configured if configured else DEFAULT_SUPPORT_RECIPIENTS


# ── Dynamic rate-limit configuration ───────────────────────────────────
# slowapi accepts callables for both `limit_value` and `key_func`. The
# `key_func` receives the request and returns a bucket string; slowapi then
# passes that bucket string into the limit provider as `key`, so the limit
# itself can vary by bucket.
def _support_rate_key(request: Request) -> str:
    auth = (request.headers.get("authorization") or "").lower()
    if auth.startswith("bearer "):
        # We haven't decoded the token at this point; use a prefix of the raw
        # token as a stable per-session bucket. Different tokens for the same
        # user still share a bucket as a proxy for "this user".
        token = auth.split(" ", 1)[1].strip()
        return f"support:authed:{token[:32]}"
    return f"support:anon:{get_remote_address(request)}"


def _support_rate_limit(key: str) -> str:
    # `key` is whatever _support_rate_key returned for this request.
    return "10/hour" if key.startswith("support:authed:") else "3/hour"


# ── Routes ─────────────────────────────────────────────────────────────
@router.post(
    "/ticket",
    response_model=SupportTicketCreateResponse,
    status_code=status.HTTP_200_OK,
)
@limiter.limit(_support_rate_limit, key_func=_support_rate_key)
async def create_ticket(
    request: Request,
    payload: SupportTicketCreate,
    user: CurrentUser | None = Depends(get_current_user_optional),
) -> SupportTicketCreateResponse:
    admin = get_admin_client()

    row: dict[str, Any] = {
        "user_id": user["user_id"] if user else None,
        "email": payload.email,
        "subject": payload.subject,
        "body": payload.body,
        "category": payload.category,
        "status": "open",
    }

    # 1. Insert the ticket. If this fails we 500 — nothing else to do.
    try:
        insert = admin.table("support_tickets").insert(row).execute()
    except Exception as exc:
        log.error("support.ticket insert failed", extra={"err": str(exc)})
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to file ticket",
        ) from exc

    # Social-engineering tripwire. Once every privileged route is denied,
    # asking a human is the cheapest remaining attack — that is exactly what
    # happened on 2026-08-19. The marker below is what the CloudWatch metric
    # filter alarms on; the ticket itself is still filed and answered normally.
    if looks_like_access_request(payload.subject, payload.body):
        log.warning(
            "SECURITY_ACCESS_REQUEST support ticket requests privileged access",
            extra={
                "security_event": "access_request_ticket",
                "ticket_email": payload.email,
                "authenticated": bool(user),
            },
        )

    if not insert.data:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Ticket insert returned no row",
        )

    ticket = insert.data[0]
    ticket_id = ticket["id"]

    # 2. Fan out emails. NEVER fail the request if email fails — the ticket
    # is already stored, the user needs confirmation it was filed, and staff
    # can poll the DB if SES is down.
    email_service = get_email_service()

    delivery_status: str
    try:
        email_service.send_support_ticket(ticket, _resolve_support_recipients())
        delivery_status = "sent"
    except EmailDeliveryError as exc:
        log.error(
            "support.ticket staff email failed",
            extra={"ticket_id": str(ticket_id), "err": str(exc)},
        )
        delivery_status = "failed"
    except Exception:  # truly unexpected — log + continue
        log.exception(
            "support.ticket staff email unexpected failure",
            extra={"ticket_id": str(ticket_id)},
        )
        delivery_status = "failed"

    # 3. Stamp the delivery status on the ticket row. Best-effort — if this
    # update itself fails, the ticket stays with NULL delivery status, which
    # ops can still interpret.
    try:
        admin.table("support_tickets").update(
            {"email_delivery_status": delivery_status}
        ).eq("id", ticket_id).execute()
    except Exception as exc:
        log.warning(
            "support.ticket delivery_status update failed",
            extra={"ticket_id": str(ticket_id), "err": str(exc)},
        )

    # 4. Send the submitter their acknowledgement. Also best-effort.
    try:
        email_service.send_ticket_acknowledgement(
            to=payload.email,
            ticket_id=str(ticket_id),
            subject_summary=payload.subject,
        )
    except Exception as exc:
        log.warning(
            "support.ticket ack email failed",
            extra={"ticket_id": str(ticket_id), "err": str(exc)},
        )

    # 5. Audit log — best-effort. The `audit_logs` table has no RLS policies
    # so this insert relies on the service-role client.
    try:
        admin.table("audit_logs").insert(
            {
                "user_id": user["user_id"] if user else None,
                "action": "support.ticket_created",
                "metadata": {
                    "ticket_id": str(ticket_id),
                    "category": payload.category,
                    "email_delivery_status": delivery_status,
                },
            }
        ).execute()
    except Exception as exc:
        log.warning(
            "support.ticket audit_log insert failed",
            extra={"ticket_id": str(ticket_id), "err": str(exc)},
        )

    return SupportTicketCreateResponse(ticket_id=ticket_id, status="open")


@router.get(
    "/tickets/me",
    response_model=SupportTicketListResponse,
    dependencies=[Depends(_rl_list_my_tickets)],
)
async def list_my_tickets(
    user: CurrentUser = Depends(get_current_user),
    limit: int = Query(20, ge=1, le=100),
) -> SupportTicketListResponse:
    admin = get_admin_client()
    try:
        result = (
            admin.table("support_tickets")
            .select("*")
            .eq("user_id", user["user_id"])
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
    except Exception as exc:
        log.error(
            "support.tickets.me query failed",
            extra={"user_id": user["user_id"], "err": str(exc)},
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to list tickets",
        ) from exc

    rows = result.data or []
    tickets = [SupportTicketRead.model_validate(r) for r in rows]
    return SupportTicketListResponse(tickets=tickets, total=len(tickets))
