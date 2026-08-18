"""Request/response models for the /founder post-onboarding portal (TIR)."""
from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

EmploymentType = Literal["full-time", "part-time", "contract", "advisor", "intern"]
ProcurementStatus = Literal["estimate", "quoted", "po", "received"]
ProcurementCategory = Literal["BOM", "Equipment", "Other", "Service"]

_TEXT = 300
_LONG = 2000

_PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")


class CollaboratorIn(BaseModel):
    """One collaborator's party details for the agreements this founder's
    track requires. The founder supplies exactly ONE set of these per
    collaborator (1-3 of them) and the same values feed every agreement --
    keys mirror app.services.agreements._COLLAB_FIELDS exactly: name, pan,
    parent_name (s/o/d/o), address."""

    model_config = ConfigDict(extra="ignore")
    name: str = Field(min_length=1, max_length=200)
    pan: str = Field(min_length=10, max_length=10)
    parent_name: str = Field(min_length=1, max_length=200)
    address: str = Field(min_length=1, max_length=1000)

    @field_validator("pan")
    @classmethod
    def _upper_pan(cls, v: str) -> str:
        v = v.strip().upper()
        if not _PAN_RE.match(v):
            raise ValueError("PAN must be 5 letters, 4 digits, 1 letter (e.g. ABCDE1234F)")
        return v


class MouPreviewRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    collaborators: list[CollaboratorIn] = Field(min_length=1, max_length=3)


class MouSignRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    signer_name: str = Field(min_length=1, max_length=200)
    # data URL: "data:image/png;base64,...."
    signature_png: str = Field(min_length=32, max_length=2_000_000)
    # Ids of the residency acknowledgements the founder ticked. The canonical
    # list lives in services/founder_mou.ACKNOWLEDGEMENTS; completeness is
    # enforced there (sign_and_onboard) so the rule holds for every caller,
    # not just this request shape.
    acknowledgements: list[str] = Field(default_factory=list, max_length=32)
    # 1-3 collaborators; the same values feed every agreement the founder's
    # track requires (agreements.TRACK_AGREEMENTS) in one signing action.
    collaborators: list[CollaboratorIn] = Field(min_length=1, max_length=3)


class TeamMemberIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str = Field(min_length=1, max_length=_TEXT)
    title: str | None = Field(default=None, max_length=_TEXT)
    employment_type: EmploymentType = "full-time"
    monthly_cost: float = Field(default=0, ge=0)
    sort_order: int = 0


class TeamMemberPatch(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str | None = Field(default=None, max_length=_TEXT)
    title: str | None = Field(default=None, max_length=_TEXT)
    employment_type: EmploymentType | None = None
    monthly_cost: float | None = Field(default=None, ge=0)
    sort_order: int | None = None


class ApproachIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    business_member_id: str | None = None
    technology_member_id: str | None = None
    product_member_id: str | None = None
    customer_member_id: str | None = None
    notes: str | None = Field(default=None, max_length=_LONG)


class BomItemIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    item: str = Field(min_length=1, max_length=_TEXT)
    qty: float = Field(default=0, ge=0)
    unit_cost: float = Field(default=0, ge=0)
    sort_order: int = 0


class BomItemPatch(BaseModel):
    model_config = ConfigDict(extra="ignore")
    item: str | None = Field(default=None, max_length=_TEXT)
    qty: float | None = Field(default=None, ge=0)
    unit_cost: float | None = Field(default=None, ge=0)
    sort_order: int | None = None


class EquipmentItemIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    item: str = Field(min_length=1, max_length=_TEXT)
    cost: float = Field(default=0, ge=0)
    sort_order: int = 0


class EquipmentItemPatch(BaseModel):
    model_config = ConfigDict(extra="ignore")
    item: str | None = Field(default=None, max_length=_TEXT)
    cost: float | None = Field(default=None, ge=0)
    sort_order: int | None = None


class ProcurementItemIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    item: str = Field(min_length=1, max_length=_TEXT)
    category: ProcurementCategory = "Other"
    qty: float = Field(default=1, ge=0)
    estimate: float = Field(default=0, ge=0)
    vendor: str | None = Field(default=None, max_length=_TEXT)
    quote: float = Field(default=0, ge=0)
    lead_weeks: int = Field(default=0, ge=0)
    status: ProcurementStatus = "estimate"


class ProcurementItemPatch(BaseModel):
    model_config = ConfigDict(extra="ignore")
    item: str | None = Field(default=None, max_length=_TEXT)
    category: ProcurementCategory | None = None
    qty: float | None = Field(default=None, ge=0)
    estimate: float | None = Field(default=None, ge=0)
    vendor: str | None = Field(default=None, max_length=_TEXT)
    quote: float | None = Field(default=None, ge=0)
    lead_weeks: int | None = Field(default=None, ge=0)
    status: ProcurementStatus | None = None
