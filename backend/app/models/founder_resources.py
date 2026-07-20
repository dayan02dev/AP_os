"""Request models for the Founders Resources tabs (/founder/store,
/founder/fundraising, /founder/partners, /founder/assets, /founder/support).
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

TicketArea = Literal["IT", "Facilities"]
TicketPriority = Literal["Low", "Medium", "High", "Urgent"]

_TEXT = 300
_LONG = 2000


class CartItemIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    product_id: str = Field(min_length=1, max_length=_TEXT)
    qty: float = Field(default=1, ge=1)


class CartQtyIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    qty: float = Field(ge=0)  # qty <= 0 deletes the line


class QuoteRequestIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    product_id: str = Field(min_length=1, max_length=_TEXT)


class IntroIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    investor_id: str = Field(min_length=1, max_length=_TEXT)


class PartnerRequestIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    partner_id: str = Field(min_length=1, max_length=_TEXT)


class BookingIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    asset_id: str = Field(min_length=1, max_length=_TEXT)
    date: str = Field(min_length=1, max_length=40)
    slot: str = Field(min_length=1, max_length=_TEXT)


class TicketIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    area: TicketArea
    priority: TicketPriority = "Medium"
    subject: str = Field(min_length=1, max_length=_TEXT)
    description: str | None = Field(default=None, max_length=_LONG)
