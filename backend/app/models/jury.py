"""Pydantic models for the jury v2 (invite → accept → pick-3) flow."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class JuryInviteItem(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    email: EmailStr


class JuryInviteCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    invites: list[JuryInviteItem] = Field(..., min_length=1, max_length=50)


class JuryFormView(BaseModel):
    name: str
    email: str
    status: str  # invited | accepted | declined


class JuryRespondSubmit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    accept: bool
    expertise_domains: list[str] = Field(default_factory=list, max_length=20)
    linkedin_url: str | None = Field(default=None, max_length=500)


class SelectionItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    application_id: str = Field(..., min_length=1)
    application_track: str = Field(..., pattern="^(tir|sip)$")
    note: str | None = Field(default=None, max_length=2000)


class SelectionsPut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    selections: list[SelectionItem]
