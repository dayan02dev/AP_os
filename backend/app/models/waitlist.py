"""Pydantic models for SIP waitlist intake.

Mirrors the `sip_waitlist` table in backend/migrations/007_sip_waitlist.sql.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

# Mirrors the four options on the programs.html <select id="wl-stage">.
SipStage = Literal[
    "Incorporated · pre-revenue",
    "Incorporated · early revenue",
    "Raised seed / pre-Series A",
    "Series A or later",
]


class SipWaitlistCreate(BaseModel):
    """Request body for POST /sip/waitlist."""

    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    startup_name: str = Field(min_length=1, max_length=200)
    current_stage: SipStage
    source: str | None = Field(default="programs_page", max_length=64)


class SipWaitlistCreateResponse(BaseModel):
    id: UUID
    status: Literal["queued"] = "queued"


class SipWaitlistRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    email: EmailStr
    startup_name: str
    current_stage: str
    source: str | None = None
    created_at: datetime
