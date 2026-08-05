"""Pydantic models for the jury v2 (invite → accept → pick-3) flow."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator


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


class JuryBankDetails(BaseModel):
    """Honorarium payout details. Persisted to jury_responses.bank_details and
    NEVER returned by any read endpoint — see routers/jury_invites.py."""
    model_config = ConfigDict(extra="forbid")
    account_name: str | None = Field(default=None, max_length=200)
    account_number: str | None = Field(default=None, max_length=40)
    ifsc: str | None = Field(default=None, max_length=20)
    bank_name: str | None = Field(default=None, max_length=200)
    pan: str | None = Field(default=None, max_length=20)

    def is_complete(self) -> bool:
        return all(
            (getattr(self, f) or "").strip()
            for f in ("account_name", "account_number", "ifsc")
        )


class JuryRespondSubmit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    accept: bool

    # Professional context — seeds enrichment + domain matching.
    expertise_domains: list[str] = Field(default_factory=list, max_length=20)
    linkedin_url: str | None = Field(default=None, max_length=500)
    full_name: str | None = Field(default=None, max_length=200)
    affiliation: str | None = Field(default=None, max_length=200)
    designation: str | None = Field(default=None, max_length=200)
    contact_email: str | None = Field(default=None, max_length=200)
    contact_phone: str | None = Field(default=None, max_length=40)

    # Engagement terms.
    mentoring_opt_in: bool | None = None
    max_startups: int | None = Field(default=None, ge=1, le=3)

    # Honorarium. Bank details are required only when the juror opts IN.
    honorarium_opt_in: bool | None = None
    bank_details: JuryBankDetails | None = None

    notes: str | None = Field(default=None, max_length=2000)
    future_comms_opt_in: bool | None = None

    @model_validator(mode="after")
    def _require_context_on_accept(self) -> "JuryRespondSubmit":
        # Accepting jurors MUST supply expertise + LinkedIn so enrichment has a
        # reliable seed. Decline needs nothing.
        if not self.accept:
            return self
        if not [d for d in self.expertise_domains if d and d.strip()]:
            raise ValueError("expertise_domains is required when accepting")
        if not (self.linkedin_url and self.linkedin_url.strip()):
            raise ValueError("linkedin_url is required when accepting")
        # Opting into the honorarium without payout details would leave finance
        # unable to pay them; opting out is always allowed and skips the block.
        if self.honorarium_opt_in:
            if self.bank_details is None or not self.bank_details.is_complete():
                raise ValueError(
                    "bank_details (account_name, account_number, ifsc) are "
                    "required when opting into the honorarium"
                )
        return self


class SelectionItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    application_id: str = Field(..., min_length=1)
    application_track: str = Field(..., pattern="^(tir|sip)$")
    note: str | None = Field(default=None, max_length=2000)


class SelectionsPut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    selections: list[SelectionItem]
