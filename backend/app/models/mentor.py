"""Pydantic models for the mentor onboarding feature."""

from __future__ import annotations

from pydantic import BaseModel, EmailStr, model_validator


class MentorInviteItem(BaseModel):
    name: str
    email: EmailStr


class MentorInviteCreate(BaseModel):
    invites: list[MentorInviteItem]
    invited_by: str | None = None


class MentorFormView(BaseModel):
    mentor_name: str
    email: str
    already_responded: bool


class BankDetails(BaseModel):
    account_name: str
    account_number: str
    ifsc: str


class MentorResponseSubmit(BaseModel):
    willing: bool
    days_available: str | None = None
    honorarium_opt_in: bool | None = None
    bank_details: BankDetails | None = None
    future_comms_opt_in: bool | None = None
    contact_email: EmailStr | None = None

    @model_validator(mode="after")
    def _check_conditional_fields(self) -> "MentorResponseSubmit":
        if self.willing and not self.days_available:
            raise ValueError("days_available is required when willing is True")
        if self.honorarium_opt_in and not self.bank_details:
            raise ValueError("bank_details is required when honorarium_opt_in is True")
        return self
