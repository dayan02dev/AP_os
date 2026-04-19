"""Pydantic models for support ticket intake.

Mirrors the `support_tickets` table in backend/migrations/001_initial_schema.sql.
The CHECK constraint on `category` is the authoritative enum; keep the Literal
in sync if it changes.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

SupportCategory = Literal["technical", "application", "general", "other"]
SupportStatus = Literal["open", "in_progress", "resolved", "closed"]


class SupportTicketCreate(BaseModel):
    """Request body for POST /support/ticket."""

    email: EmailStr
    subject: str = Field(min_length=5, max_length=200)
    body: str = Field(min_length=20, max_length=5000)
    category: SupportCategory


class SupportTicketCreateResponse(BaseModel):
    ticket_id: UUID
    status: Literal["open"] = "open"


class SupportTicketRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID | None = None
    email: EmailStr
    subject: str
    body: str
    category: SupportCategory | None = None
    status: SupportStatus = "open"
    email_delivery_status: str | None = None
    created_at: datetime


class SupportTicketListResponse(BaseModel):
    tickets: list[SupportTicketRead]
    total: int
