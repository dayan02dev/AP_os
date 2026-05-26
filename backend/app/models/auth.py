"""Pydantic models for the /auth router (Phase 3)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field

# Track values match the CHECK constraint on profiles.track.
TrackValue = Literal["tir", "sip"]


# ─── Request bodies ─────────────────────────────────────────────

class OTPRequest(BaseModel):
    email: EmailStr
    # Optional. When set on the FIRST OTP request (i.e. signup), the value
    # is written to auth.users.raw_user_meta_data and read by the
    # handle_new_user() trigger to populate profiles.track. For existing
    # users this field is ignored — track is locked once set.
    track: TrackValue | None = None


class OTPVerify(BaseModel):
    email: EmailStr
    # Supabase email OTP is a fixed 6-digit numeric code.
    token: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=10)


# Password auth (Phase B). Supabase enforces lowercase+uppercase+digit+symbol
# and min length 8 server-side; we mirror just the length here so an obviously
# wrong payload is rejected before we hit Supabase. The full character-class
# check is the frontend's job (immediate feedback) and Supabase's job
# (authoritative). Don't double-check here — the rules can drift.
class PasswordSignIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class SetPassword(BaseModel):
    """New password for the currently-authenticated user.

    No `current_password` field: Supabase's "Secure password change" setting
    (24h recent-login window) gates this server-side. After 24h the session
    must re-auth via OTP before this endpoint will succeed.
    """

    password: str = Field(min_length=8, max_length=128)


# ─── Response bodies ────────────────────────────────────────────

class UserInfo(BaseModel):
    id: str
    email: EmailStr


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    user: UserInfo


class UserMe(BaseModel):
    """Shape returned by GET /auth/me — mirrors `profiles` columns + a
    `password_set` flag derived from auth.users.app_metadata so the
    frontend can decide whether to force the user through SetPasswordPage
    after OTP verify."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    email: EmailStr
    full_name: str | None = None
    phone: str | None = None
    linkedin_url: str | None = None
    location_city: str | None = None
    location_country: str | None = None
    created_at: datetime | None = None
    password_set: bool = False


class SimpleOK(BaseModel):
    ok: bool
    message: str | None = None


# ─── Track flip (chooser screen) ────────────────────────────────
#
# PATCH /auth/me/track lets the frontend chooser flip the user's
# profiles.track between 'tir' and 'sip' so the SIP RLS policies
# (migration 011) permit drafting in the chosen track. See
# routers/auth.py::patch_my_track for the full rationale.
class TrackUpdate(BaseModel):
    track: TrackValue


class TrackUpdateResponse(BaseModel):
    ok: bool
    track: TrackValue
