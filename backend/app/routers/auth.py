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
    PasswordSignIn,
    RefreshRequest,
    SetPassword,
    SimpleOK,
    TokenResponse,
    TrackUpdate,
    TrackUpdateResponse,
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

# Password-auth: 5 attempts per 15 minutes per email. Anything tighter would
# punish legitimate users on a typo; anything looser would let a botnet brute
# force a single account given enough emails to spread across.
_PWD_SIGNIN_MAX = 5
_PWD_SIGNIN_WINDOW_S = 15 * 60

# Set-password is per-user (Bearer-keyed) — 5/hour is plenty for the legitimate
# "set initial password" + "change password" flows and stops a stolen-token
# attacker from rotating credentials at speed.
_SET_PASSWORD_MAX = 5
_SET_PASSWORD_WINDOW_S = 60 * 60


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
    # If the caller passed a track ('tir' or 'sip'), pipe it into the
    # auth.users metadata so the handle_new_user() trigger can stamp
    # profiles.track on first signup. For existing users this `data` is
    # ignored — track is locked once set.
    options: dict = {"should_create_user": True}
    if payload.track:
        options["data"] = {"track": payload.track}
    try:
        anon = get_anon_client()
        anon.auth.sign_in_with_otp({"email": email, "options": options})
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
    except Exception as exc:
        # Expired / rotated / missing refresh tokens are normal client state,
        # not server faults — log at INFO without a traceback so ERROR-level
        # alerts only fire on genuinely unexpected failures. gotrue surfaces
        # all of these as AuthApiError; httpx 4xx counts too.
        cls = type(exc).__name__
        msg = str(exc)
        is_expected = (
            "AuthApiError" in cls
            or "AuthError" in cls
            or "HTTPStatusError" in cls
        )
        if is_expected:
            log.info(
                "auth.refresh rejected by supabase",
                extra={"ref": req_id, "err": msg[:200], "exc_cls": cls},
            )
        else:
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


def _password_set_for(user_id: str) -> bool:
    """Read `app_metadata.password_set` from auth.users for this user.

    We stamp this flag in /auth/set-password rather than poking at the
    encrypted_password column directly. Supabase doesn't expose the column
    on its admin API (and rightly so), and a custom SQL function or schema
    column would mean another migration. The metadata flag is the cleanest
    no-migration signal.
    """
    try:
        admin = get_admin_client()
        res = admin.auth.admin.get_user_by_id(user_id)
        user = getattr(res, "user", None) or res
        meta = getattr(user, "app_metadata", None) or {}
        return bool(meta.get("password_set", False))
    except Exception:
        # Failing closed (return False) means a transient admin-API blip
        # would re-prompt the user to set a password. Annoying but harmless.
        log.warning("password_set lookup failed", extra={"user_id": user_id})
        return False


@router.get(
    "/me",
    response_model=UserMe,
    dependencies=[Depends(per_user_rate_limit("auth-me", 120, 60))],
)
async def me(current_user: dict = Depends(get_current_user)):
    """Return the caller's profiles row + password_set flag."""
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

    password_set = _password_set_for(current_user["user_id"])

    rows = res.data or []
    if not rows:
        # Edge case: auth user exists but handle_new_user trigger didn't fire.
        return UserMe(
            id=current_user["user_id"],
            email=current_user["email"],
            password_set=password_set,
        )
    row = {**rows[0], "password_set": password_set}
    return UserMe.model_validate(row)


# ─── Password sign-in (Phase B) ─────────────────────────────────
#
# Sign in with email + password. Returns the same TokenResponse shape as
# /auth/verify-otp so the frontend can use one onSuccess code path.
#
# Same anti-enumeration response policy as request-otp: any failure mode
# (no such email, wrong password, no password set) returns the same generic
# 401, so an attacker can't tell which.
@router.post("/sign-in-password", response_model=TokenResponse)
async def sign_in_password(payload: PasswordSignIn, request: Request):
    email = payload.email.lower().strip()
    # Per-email bucket — a single email being hammered with bad passwords
    # gets locked, but the limit doesn't cross-pollinate across users (so
    # one applicant's typo storm doesn't block their colleague).
    check_and_record("sign-in-password", email, _PWD_SIGNIN_MAX, _PWD_SIGNIN_WINDOW_S)

    req_id = _new_request_id()
    try:
        anon = get_anon_client()
        result = anon.auth.sign_in_with_password(
            {"email": email, "password": payload.password}
        )
    except Exception as exc:
        log.info(
            "auth.sign-in-password failed",
            extra={"auth_event": "password_signin_failed", "ref": req_id,
                   "email_hash": hash(email)},
        )
        if _is_supabase_rate_limit(exc):
            return _error(
                status.HTTP_429_TOO_MANY_REQUESTS,
                "rate_limited",
                "Too many sign-in attempts. Try again in a few minutes.",
            )
        # Generic 401 for "invalid credentials", "user not found", and "no
        # password set on this account" — frontend renders one message.
        return _error(
            status.HTTP_401_UNAUTHORIZED,
            "invalid_credentials",
            "Invalid email or password.",
        )

    session = getattr(result, "session", None)
    user = getattr(result, "user", None)
    if session is None or user is None:
        return _error(
            status.HTTP_401_UNAUTHORIZED,
            "invalid_credentials",
            "Invalid email or password.",
        )

    # Audit the successful signin — same shape as verify-otp's audit row.
    try:
        get_admin_client().table("audit_logs").insert(
            {
                "user_id": user.id,
                "action": "auth.password_signin",
                "metadata": {"request_id": req_id},
                "ip_address": request.client.host if request.client else None,
                "user_agent": request.headers.get("user-agent"),
            }
        ).execute()
    except Exception:
        log.warning("auth.password-signin audit insert failed",
                    extra={"ref": req_id, "user_id": user.id})

    return TokenResponse(
        access_token=session.access_token,
        refresh_token=session.refresh_token,
        user=UserInfo(id=user.id, email=user.email),
    )


# ─── Set / change password (Phase B) ────────────────────────────
#
# Sets the password for the currently-authenticated user (Bearer required).
# Uses the admin client to update the password and stamp `app_metadata.
# password_set = true` so /auth/me can report the flag without a SQL
# function or schema change.
#
# The "Secure password change" Supabase setting requires the user to have
# logged in within the last 24h (session-recency check happens server-side
# inside Supabase) — meaning a stolen long-lived refresh token alone can't
# rotate the password. After 24h, the user must re-OTP first.
@router.post(
    "/set-password",
    response_model=SimpleOK,
    dependencies=[Depends(per_user_rate_limit("auth-set-password",
                                              _SET_PASSWORD_MAX,
                                              _SET_PASSWORD_WINDOW_S))],
)
async def set_password(
    payload: SetPassword,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["user_id"]
    req_id = _new_request_id()

    try:
        admin = get_admin_client()
        # Merge with existing app_metadata so we don't blow away anything
        # else that might land there in the future.
        existing = admin.auth.admin.get_user_by_id(user_id)
        existing_user = getattr(existing, "user", None) or existing
        prev_meta = dict(getattr(existing_user, "app_metadata", None) or {})
        prev_meta["password_set"] = True

        admin.auth.admin.update_user_by_id(
            user_id,
            {"password": payload.password, "app_metadata": prev_meta},
        )
    except Exception as exc:
        log.exception(
            "auth.set-password failed",
            extra={"auth_event": "set_password_failed", "ref": req_id,
                   "user_id": user_id},
        )
        msg = str(exc).lower()
        # Supabase rejects weak passwords with a 422 / "weak_password" code.
        # Translate to a 422 the frontend can show inline next to the field.
        if "weak" in msg or "password" in msg and "must" in msg:
            return _error(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "weak_password",
                "Password doesn't meet the strength requirements. "
                "It must be at least 8 characters with upper- and lower-case "
                "letters, a digit, and a symbol.",
            )
        return _error(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "set_password_failed",
            f"Could not update password (ref {req_id}).",
        )

    # Audit the change — matches the OTP/password-signin audit shape.
    try:
        get_admin_client().table("audit_logs").insert(
            {
                "user_id": user_id,
                "action": "auth.password_set",
                "metadata": {"request_id": req_id},
                "ip_address": request.client.host if request.client else None,
                "user_agent": request.headers.get("user-agent"),
            }
        ).execute()
    except Exception:
        log.warning("auth.set-password audit insert failed",
                    extra={"ref": req_id, "user_id": user_id})

    return SimpleOK(ok=True, message="Password updated.")


# ─── Track flip (chooser screen) ────────────────────────────────
#
# The unified TIR/SIP chooser on `/apply` lets a single applicant explore
# (and draft) both tracks. The SIP track's RLS policies in migration
# 011_sip_track.sql gate every SELECT/INSERT/UPDATE on `sip_applications`
# and SIP storage buckets behind:
#
#     EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND track='sip')
#
# The TIR tables have no such gate. So when the user picks SIP at the
# chooser the frontend MUST flip `profiles.track` to 'sip' (and back to
# 'tir' when they pick TIR), otherwise RLS blocks drafting + viewing.
#
# Migration 010's column comment says "Locked once set; only an admin
# (service role) can change it." — that's still accurate, because this
# endpoint runs through the service-role admin client server-side. The
# user can't UPDATE the column directly via RLS; they can only ask this
# endpoint to do it, and the endpoint enforces:
#   - Bearer auth (get_current_user)
#   - The new track must be one of {'tir','sip'} (Pydantic Literal)
#   - The UPDATE is scoped to the caller's own profiles row
#
# Submit-time cross-track lock (so a single user can't SUBMIT in both
# tracks) lives elsewhere — that's not this endpoint's job.
_TRACK_FLIP_MAX = 30      # 30 flips/min/user — chooser doesn't need more
_TRACK_FLIP_WINDOW_S = 60


@router.patch(
    "/me/track",
    response_model=TrackUpdateResponse,
    dependencies=[Depends(per_user_rate_limit("auth-me-track",
                                              _TRACK_FLIP_MAX,
                                              _TRACK_FLIP_WINDOW_S))],
)
async def patch_my_track(
    payload: TrackUpdate,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["user_id"]
    req_id = _new_request_id()
    new_track = payload.track

    try:
        admin = get_admin_client()
        (
            admin.table("profiles")
            .update({"track": new_track})
            .eq("id", user_id)
            .execute()
        )
    except Exception:
        log.exception(
            "auth.patch-me-track failed",
            extra={"auth_event": "track_update_failed", "ref": req_id,
                   "user_id": user_id, "new_track": new_track},
        )
        return _error(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "track_update_failed",
            f"Could not update track (ref {req_id}).",
        )

    return TrackUpdateResponse(ok=True, track=new_track)
