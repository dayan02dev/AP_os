"""Auth router — email OTP flow backed by Supabase (Phase 3).

Endpoints
    POST /auth/request-otp       3/15min per email
    POST /auth/verify-otp        5/15min per email; returns access+refresh tokens
    POST /auth/refresh           no per-email cap (global 60/min/IP applies)
    POST /auth/logout            auth required; stateless — tokens invalidated client-side
    GET  /auth/me                auth required; returns the caller's profiles row

Security notes
    - Never log OTP tokens, access tokens, or refresh tokens. Not at INFO, not
      at DEBUG, not in error messages. If you need to debug a token, use a
      temporary `repr(token)[:8] + '…'` slice.
    - Never reveal whether an email is registered. `request-otp` always
      returns the same success message.
    - Supabase exception details are logged server-side with a request_id and
      translated to a generic {"error": {...}} payload for the client.
    - Per-email rate limiting uses an in-memory sliding window. Fine for a
      single Lambda container at our scale; swap to Redis if we go
      multi-container. The global slowapi limiter still applies in parallel.
"""

from __future__ import annotations

import contextlib
import logging
import time
import uuid
from collections import defaultdict
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException, Request, status
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

log = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


# ─── Per-email rate-limiting ──────────────────────────────────────
# Separate buckets from the global slowapi limiter: this one is keyed on the
# normalised email, not IP. Prevents one IP from spraying OTPs at many
# addresses AND prevents one address from being abused from many IPs.

_otp_windows: dict[str, list[float]] = defaultdict(list)
_otp_lock = Lock()

_REQUEST_OTP_MAX = 3          # 3 requests …
_REQUEST_OTP_WINDOW_S = 900   # … per 15 min per email
_VERIFY_OTP_MAX = 5
_VERIFY_OTP_WINDOW_S = 900


def _check_email_rate(bucket: str, email: str, max_count: int, window_s: int) -> None:
    """Sliding window. Raises 429 if the (bucket, email) pair is over quota.

    We key on `"<bucket>:<email>"` so request-otp and verify-otp buckets don't
    share counts.
    """
    now = time.time()
    cutoff = now - window_s
    key = f"{bucket}:{email}"
    with _otp_lock:
        timestamps = _otp_windows[key]
        # Prune expired entries in-place so the dict doesn't grow unbounded.
        fresh = [ts for ts in timestamps if ts > cutoff]
        if len(fresh) >= max_count:
            _otp_windows[key] = fresh
            retry_after = int(window_s - (now - fresh[0])) + 1
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many {bucket} requests. Try again in {retry_after}s.",
                headers={"Retry-After": str(retry_after)},
            )
        fresh.append(now)
        _otp_windows[key] = fresh


def _reset_email_rate_limits() -> None:
    """Test hook — called from tests/test_auth.py fixtures."""
    with _otp_lock:
        _otp_windows.clear()


# ─── Error helper ─────────────────────────────────────────────────
def _error(status_code: int, code: str, message: str) -> JSONResponse:
    """Shape: {"error": {"code": str, "message": str}} per spec."""
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": message}},
    )


def _new_request_id() -> str:
    return uuid.uuid4().hex[:12]


# ─── Routes ───────────────────────────────────────────────────────

@router.post("/request-otp", response_model=SimpleOK)
async def request_otp(payload: OTPRequest, request: Request):
    """Send a 6-digit OTP to the supplied email.

    Response is identical whether or not the email exists in the system —
    never use this endpoint to probe which emails are registered.
    """
    email = payload.email.lower().strip()
    _check_email_rate("request-otp", email, _REQUEST_OTP_MAX, _REQUEST_OTP_WINDOW_S)

    req_id = _new_request_id()
    try:
        anon = get_anon_client()
        anon.auth.sign_in_with_otp(
            {"email": email, "options": {"should_create_user": True}}
        )
    except Exception as exc:
        # Log server-side with the request_id so we can correlate in SRE triage.
        log.exception(
            "auth.request-otp supabase call failed",
            extra={"request_id": req_id, "email_hash": hash(email)},
        )
        # Don't bubble the specific error to the client.
        _ = exc  # consumed by the log above
        return _error(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "auth_error",
            f"Unable to send OTP at this time (ref {req_id}).",
        )

    return SimpleOK(
        ok=True,
        message="If this email is registered, an OTP has been sent.",
    )


@router.post("/verify-otp", response_model=TokenResponse)
async def verify_otp(payload: OTPVerify, request: Request):
    """Verify the 6-digit OTP, return access+refresh tokens."""
    email = payload.email.lower().strip()
    _check_email_rate("verify-otp", email, _VERIFY_OTP_MAX, _VERIFY_OTP_WINDOW_S)

    req_id = _new_request_id()
    try:
        anon = get_anon_client()
        result = anon.auth.verify_otp(
            {"email": email, "token": payload.token, "type": "email"}
        )
    except Exception:
        log.exception(
            "auth.verify-otp supabase call failed",
            extra={"request_id": req_id, "email_hash": hash(email)},
        )
        # Treat any verify_otp exception as "invalid or expired" — Supabase
        # raises for wrong code, expired code, and unknown email alike, and we
        # don't want to distinguish for the caller.
        return _error(
            status.HTTP_401_UNAUTHORIZED,
            "otp_invalid",
            "Invalid or expired OTP.",
        )

    session = getattr(result, "session", None)
    user = getattr(result, "user", None)
    if session is None or user is None:
        log.warning(
            "auth.verify-otp result missing session/user",
            extra={"request_id": req_id},
        )
        return _error(
            status.HTTP_401_UNAUTHORIZED,
            "otp_invalid",
            "Invalid or expired OTP.",
        )

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
        # Audit failures must never block the caller. Log and move on.
        log.warning(
            "auth.verify-otp audit insert failed",
            extra={"request_id": req_id, "user_id": user.id},
        )

    return TokenResponse(
        access_token=session.access_token,
        refresh_token=session.refresh_token,
        user=UserInfo(id=user.id, email=user.email),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(payload: RefreshRequest):
    """Exchange a refresh token for a new access+refresh pair."""
    req_id = _new_request_id()
    try:
        anon = get_anon_client()
        result = anon.auth.refresh_session(payload.refresh_token)
    except Exception:
        log.exception(
            "auth.refresh supabase call failed",
            extra={"request_id": req_id},
        )
        return _error(
            status.HTTP_401_UNAUTHORIZED,
            "refresh_failed",
            "Refresh token is invalid or expired.",
        )

    session = getattr(result, "session", None)
    user = getattr(result, "user", None)
    if session is None or user is None:
        return _error(
            status.HTTP_401_UNAUTHORIZED,
            "refresh_failed",
            "Refresh token is invalid or expired.",
        )

    return TokenResponse(
        access_token=session.access_token,
        refresh_token=session.refresh_token,
        user=UserInfo(id=user.id, email=user.email),
    )


@router.post("/logout", response_model=SimpleOK)
async def logout(current_user: dict = Depends(get_current_user)):
    """Best-effort sign-out.

    The session is actually invalidated on the client by dropping the tokens.
    The server call is a courtesy — we try to sign out the anon client's
    session if it has one, and return ok regardless.
    """
    # Stateless FastAPI → no session to sign out most of the time. Suppress any
    # error from the best-effort call; dropping the tokens client-side is what
    # actually terminates the session.
    with contextlib.suppress(Exception):
        get_anon_client().auth.sign_out()
    return SimpleOK(ok=True)


@router.get("/me", response_model=UserMe)
async def me(current_user: dict = Depends(get_current_user)):
    """Return the caller's profiles row."""
    req_id = _new_request_id()
    try:
        res = (
            get_admin_client()
            .table("profiles")
            .select("id, email, full_name, phone, linkedin_url, location_city, location_country, created_at")
            .eq("id", current_user["user_id"])
            .limit(1)
            .execute()
        )
    except Exception:
        log.exception(
            "auth.me profile fetch failed",
            extra={"request_id": req_id, "user_id": current_user["user_id"]},
        )
        return _error(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "profile_fetch_failed",
            f"Unable to load profile (ref {req_id}).",
        )

    rows = res.data or []
    if not rows:
        # Edge case: auth user exists but the handle_new_user trigger didn't
        # fire (test fixtures, race, etc.). Synthesize a minimal row from the
        # auth token rather than 404.
        return UserMe(
            id=current_user["user_id"],
            email=current_user["email"],
        )

    return UserMe.model_validate(rows[0])
