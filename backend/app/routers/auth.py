"""Auth router — email OTP flow backed by Supabase (Phase 3, Phase 8 hardened).

Endpoints + rate limits:

  POST /auth/request-otp   3/15min per email (check-only; record on success)
  POST /auth/verify-otp    5/15min per email (check-AND-record)
  POST /auth/refresh       30/min per IP (slowapi)
  POST /auth/logout        30/min per user (Bearer-token bucket)
  GET  /auth/me            120/min per user

Security notes
    - Never log OTP tokens, access tokens, or refresh tokens. Not at INFO, not
      at DEBUG, not in error messages. utils/logging.py redacts JWTs and
      Authorization headers as a safety net.
    - Never reveal whether an email is registered. `request-otp` always
      returns the same success message.
    - Supabase exception details are logged server-side with a request_id and
      translated to a generic {"error": {...}} payload for the client.
    - Per-email / per-user rate limits live in utils/rate_limit.py and are
      per-container (not distributed) — see that file for the cost-model note.
"""

# NOTE: deliberately no `from __future__ import annotations` — slowapi's
# `@limiter.limit(...)` wrapper interacts badly with FastAPI's type
# introspection when the endpoint's Pydantic body param is a forward ref.
# Same gotcha as routers/support.py.

import contextlib
import logging
import uuid

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import JSONResponse

from ..deps import get_current_user
from ..models.auth import (
    OTPRequest,
    OTPVerify,
    RefreshRequest,
    SimpleOK,
    TokenResponse,
    UserInfo,
    UserMe,
)
from ..supabase_client import get_admin_client, get_anon_client
from ..utils.rate_limit import (
    check_and_record,
    check_rate,
    limiter,
    per_token_key,
    per_user_rate_limit,
    record_rate,
    reset_buckets_for_tests,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


# ─── Rate-limit constants ──────────────────────────────────────────
# These match the Phase 8 spec's rate-limit table; utils/rate_limit.py is
# where the in-memory mechanics live.

_REQUEST_OTP_MAX = 3            # 3 successful sends
_REQUEST_OTP_WINDOW_S = 15 * 60  # per 15 minutes per email

_VERIFY_OTP_MAX = 5              # 5 attempts (success or fail — brute-force defence)
_VERIFY_OTP_WINDOW_S = 15 * 60   # per 15 minutes per email


def _reset_email_rate_limits() -> None:
    """Test-only: flush the in-memory rate-limit state between tests."""
    reset_buckets_for_tests()


# ─── Error helper ─────────────────────────────────────────────────

def _error(status_code: int, code: str, message: str) -> JSONResponse:
    """Shape: {"error": {"code": str, "message": str}} per spec."""
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": message}},
    )


def _new_request_id() -> str:
    return uuid.uuid4().hex[:12]


def _is_supabase_rate_limit(exc: Exception) -> bool:
    status_code = getattr(exc, "status", None) or getattr(exc, "status_code", None)
    if status_code == 429:
        return True
    msg = str(exc).lower()
    return "rate limit" in msg or "too many" in msg or "429" in msg


def _is_smtp_send_failure(exc: Exception) -> bool:
    """Supabase 500 when SMTP rejects. Not a transient — don't silently retry."""
    status_code = getattr(exc, "status", None) or getattr(exc, "status_code", None)
    msg = str(exc).lower()
    return status_code == 500 and (
        "sending confirmation email" in msg
        or "sending email" in msg
        or "smtp" in msg
    )


# ─── Routes ───────────────────────────────────────────────────────

@router.post("/request-otp", response_model=SimpleOK)
async def request_otp(payload: OTPRequest, request: Request):
    """Send a 6-digit OTP to the supplied email.

    Response is intentionally the same whether or not the email exists, so
    this endpoint can't be used to enumerate registered users.
    """
    email = payload.email.lower().strip()
    # Check-only: a Supabase / network blip shouldn't burn the caller's quota.
    check_rate("request-otp", email, _REQUEST_OTP_MAX, _REQUEST_OTP_WINDOW_S)

    req_id = _new_request_id()
    try:
        anon = get_anon_client()
        anon.auth.sign_in_with_otp(
            {"email": email, "options": {"should_create_user": True}}
        )
    except Exception as exc:
        log.exception(
            "auth.request-otp supabase call failed",
            extra={"auth_event": "request_otp_failed", "ref": req_id, "email_hash": hash(email)},
        )
        if _is_supabase_rate_limit(exc):
            return _error(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "supabase_email_rate_limited",
                "Supabase's email rate limit is temporarily exceeded. Try again "
                "in a few minutes, use a different email, or raise the limit in "
                "Supabase Dashboard → Authentication → Rate Limits.",
            )
        if _is_smtp_send_failure(exc):
            return _error(
                status.HTTP_502_BAD_GATEWAY,
                "supabase_smtp_failed",
                "Supabase accepted the OTP request but couldn't deliver the email. "
                "Check Supabase Dashboard → Authentication → SMTP Settings: the "
                "sender domain probably isn't verified with your SMTP provider. "
                "As a dev bypass, run `python backend/scripts/dev_get_otp.py <email>`.",
            )
        return _error(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "auth_error",
            f"Unable to send OTP at this time (ref {req_id}).",
        )

    # Success path — consume one slot.
    record_rate("request-otp", email)
    return SimpleOK(ok=True, message="If this email is registered, an OTP has been sent.")


@router.post("/verify-otp", response_model=TokenResponse)
async def verify_otp(payload: OTPVerify, request: Request):
    """Verify the 6-digit OTP, return access+refresh tokens."""
    email = payload.email.lower().strip()
    # Every verify attempt counts (brute-force defence over 6-digit code space).
    check_and_record("verify-otp", email, _VERIFY_OTP_MAX, _VERIFY_OTP_WINDOW_S)

    req_id = _new_request_id()
    try:
        anon = get_anon_client()
        result = anon.auth.verify_otp(
            {"email": email, "token": payload.token, "type": "email"}
        )
    except Exception:
        log.exception(
            "auth.verify-otp supabase call failed",
            extra={"auth_event": "verify_otp_failed", "ref": req_id, "email_hash": hash(email)},
        )
        return _error(status.HTTP_401_UNAUTHORIZED, "otp_invalid", "Invalid or expired OTP.")

    session = getattr(result, "session", None)
    user = getattr(result, "user", None)
    if session is None or user is None:
        log.warning("auth.verify-otp result missing session/user", extra={"ref": req_id})
        return _error(status.HTTP_401_UNAUTHORIZED, "otp_invalid", "Invalid or expired OTP.")

    # Audit log — service-role client bypasses RLS on audit_logs.
    try:
        get_admin_client().table("audit_logs").insert(
            {
                "user_id": user.id,
                "action": "auth.verified",
                "metadata": {"request_id": req_id},
                "ip_address": request.client.host if request.client else None,
                "user_agent": request.headers.get("user-agent"),
            }
        ).execute()
    except Exception:
        log.warning("auth.verify-otp audit insert failed",
                    extra={"ref": req_id, "user_id": user.id})

    return TokenResponse(
        access_token=session.access_token,
        refresh_token=session.refresh_token,
        user=UserInfo(id=user.id, email=user.email),
    )


# Refresh is IP-keyed via slowapi — refresh tokens are long-lived and often
# come from clients under NAT, so 30/min/IP is a reasonable shared ceiling.
@router.post("/refresh", response_model=TokenResponse)
@limiter.limit("30/minute")
async def refresh(request: Request, payload: RefreshRequest):
    req_id = _new_request_id()
    try:
        anon = get_anon_client()
        result = anon.auth.refresh_session(payload.refresh_token)
    except Exception:
        log.exception("auth.refresh supabase call failed", extra={"ref": req_id})
        return _error(status.HTTP_401_UNAUTHORIZED, "refresh_failed",
                      "Refresh token is invalid or expired.")

    session = getattr(result, "session", None)
    user = getattr(result, "user", None)
    if session is None or user is None:
        return _error(status.HTTP_401_UNAUTHORIZED, "refresh_failed",
                      "Refresh token is invalid or expired.")

    return TokenResponse(
        access_token=session.access_token,
        refresh_token=session.refresh_token,
        user=UserInfo(id=user.id, email=user.email),
    )


@router.post(
    "/logout",
    response_model=SimpleOK,
    dependencies=[Depends(per_user_rate_limit("auth-logout", 30, 60))],
)
async def logout(current_user: dict = Depends(get_current_user)):
    """Best-effort sign-out. Dropping tokens client-side is what matters."""
    with contextlib.suppress(Exception):
        get_anon_client().auth.sign_out()
    return SimpleOK(ok=True)


@router.get(
    "/me",
    response_model=UserMe,
    dependencies=[Depends(per_user_rate_limit("auth-me", 120, 60))],
)
async def me(current_user: dict = Depends(get_current_user)):
    """Return the caller's profiles row."""
    req_id = _new_request_id()
    try:
        res = (
            get_admin_client()
            .table("profiles")
            .select(
                "id, email, full_name, phone, linkedin_url, location_city, "
                "location_country, created_at"
            )
            .eq("id", current_user["user_id"])
            .limit(1)
            .execute()
        )
    except Exception:
        log.exception("auth.me profile fetch failed",
                      extra={"ref": req_id, "user_id": current_user["user_id"]})
        return _error(
            status.HTTP_500_INTERNAL_SERVER_ERROR, "profile_fetch_failed",
            f"Unable to load profile (ref {req_id}).",
        )

    rows = res.data or []
    if not rows:
        # Edge case: auth user exists but handle_new_user trigger didn't fire.
        return UserMe(id=current_user["user_id"], email=current_user["email"])
    return UserMe.model_validate(rows[0])
