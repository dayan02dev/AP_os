"""SIP waitlist router — public form intake.

The marketing page (/tir, programs landing) carries a "Notify me" form
that collects name + work email + startup name + current stage. This
router takes that POST, dedupes by email, and writes to the
``sip_waitlist`` table for the admin dashboard / launch-day blast on
22 May 2026.

Endpoint
    POST /sip/waitlist        Public, no auth, IP rate-limited.

Rate limiting
    5/hour per IP — the form is fire-and-forget so we don't need a per-user
    bucket; the IP cap is just there to make scripted abuse uninteresting.
    (Additive on top of the global 60/min/IP default from main.py.)

The DB has a unique index on lower(email) so re-submitting the same address
is a no-op (we 200 back the existing row's id rather than 409). That makes
the form idempotent from the user's POV: if they tab back and click again
they don't see a confusing error.
"""

# NOTE: deliberately no `from __future__ import annotations` — FastAPI +
# pydantic 2 cannot resolve stringified `Annotated` annotations on Depends.

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from slowapi.util import get_remote_address

from ..models.waitlist import SipWaitlistCreate, SipWaitlistCreateResponse
from ..supabase_client import get_admin_client
from ..utils.rate_limit import limiter

log = logging.getLogger(__name__)

router = APIRouter(prefix="/sip", tags=["waitlist"])


def _waitlist_rate_key(request: Request) -> str:
    return f"sip-waitlist:{get_remote_address(request)}"


@router.post(
    "/waitlist",
    response_model=SipWaitlistCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
@limiter.limit("5/hour", key_func=_waitlist_rate_key)
async def create_waitlist_entry(
    request: Request,
    payload: SipWaitlistCreate,
) -> SipWaitlistCreateResponse:
    admin = get_admin_client()

    # Pull client metadata for the row. Both nullable — if the proxy
    # didn't forward them, that's fine.
    ip_addr = get_remote_address(request)
    user_agent = request.headers.get("user-agent")

    row: dict[str, Any] = {
        "name": payload.name.strip(),
        "email": payload.email.lower().strip(),
        "startup_name": payload.startup_name.strip(),
        "current_stage": payload.current_stage,
        "source": payload.source or "programs_page",
        "ip_addr": ip_addr,
        "user_agent": user_agent,
    }

    # Try the insert. If it bumps the unique-on-lower(email) index, fall
    # back to fetching the existing row so the response stays a 201 with
    # an id — that keeps the form idempotent.
    try:
        result = admin.table("sip_waitlist").insert(row).execute()
        if result.data:
            inserted = result.data[0]
            log.info(
                "sip_waitlist insert ok",
                extra={"id": str(inserted["id"]), "email": row["email"]},
            )
            return SipWaitlistCreateResponse(id=inserted["id"])
    except Exception as exc:
        # Unique-violation surfaces as a generic exception from supabase-py;
        # we look for the "duplicate" sentinel in the error string.
        msg = str(exc).lower()
        if "duplicate" in msg or "unique" in msg or "23505" in msg:
            existing = (
                admin.table("sip_waitlist")
                .select("id")
                .eq("email", row["email"])
                .limit(1)
                .execute()
            )
            if existing.data:
                log.info(
                    "sip_waitlist duplicate (idempotent)",
                    extra={"id": str(existing.data[0]["id"]), "email": row["email"]},
                )
                return SipWaitlistCreateResponse(id=existing.data[0]["id"])
        log.error(
            "sip_waitlist insert failed",
            extra={"email": row["email"], "err": str(exc)},
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to record waitlist entry",
        ) from exc

    # Fall-through: empty insert.data without an exception is unexpected.
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Waitlist insert returned no row",
    )
