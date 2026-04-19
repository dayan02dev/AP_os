"""Pydantic models for the /auth router (Phase 3)."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

# ─── Request bodies ─────────────────────────────────────────────

class OTPRequest(BaseModel):
    email: EmailStr


class OTPVerify(BaseModel):
    email: EmailStr
    # Supabase email OTP is a fixed 6-digit numeric code.
    token: str = Field(min_length=6, max_length=6, pattern=r"^\d{6}$")


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=10)


# ─── Response bodies ────────────────────────────────────────────

class UserInfo(BaseModel):
    id: str
    email: EmailStr


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    user: UserInfo


class UserMe(BaseModel):
    """Shape returned by GET /auth/me — mirrors `profiles` columns."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    email: EmailStr
    full_name: str | None = None
    phone: str | None = None
    linkedin_url: str | None = None
    location_city: str | None = None
    location_country: str | None = None
    created_at: datetime | None = None


class SimpleOK(BaseModel):
    ok: bool
    message: str | None = None
