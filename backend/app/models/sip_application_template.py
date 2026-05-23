"""Pydantic models for the SIP offline application-template upload flow.

Mirrors models/application_template.py — tracks one row per .docx/.pdf
the applicant uploads after filling our SIP offline template. Parsed
answers (keyed Q5..Q24 minus Q7/Q22/Q23) land in `parsed_data`;
apply-to-application copies them to the matching columns on
public.sip_applications only when the target column is currently
NULL/empty (D6 — NULL-only writes, deliberate divergence from TIR).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


ParseStatus = Literal["pending", "processing", "completed", "failed"]


class SipApplicationTemplateUploadResponse(BaseModel):
    template_id: UUID
    parse_status: ParseStatus
    original_filename: str | None = None
    parsed_data: dict[str, Any] | None = None
    message: str | None = None


class SipApplicationTemplateRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    application_id: UUID | None = None
    storage_path: str
    original_filename: str | None = None
    file_size_bytes: int | None = None
    mime_type: str | None = None
    parse_status: ParseStatus
    parse_error: str | None = None
    parsed_at: datetime | None = None
    parsed_data: dict[str, Any] | None = None
    applied_to_application_at: datetime | None = None
    created_at: datetime


class SipApplyTemplateResult(BaseModel):
    """Result of POST /sip-application-templates/me/apply-to-application.

    `applied_fields`  → columns we wrote (were NULL/empty before).
    `skipped_fields`  → columns left untouched because the applicant had
                        already typed something there (NULL-only writes —
                        deliberate divergence from TIR's overwrite).
    `missing_answers` → questions the LLM couldn't extract (empty cell,
                        invalid URL, value not in canonical enum, etc.) —
                        surfaced so the wizard can highlight them later.
    """

    applied_fields: list[str]
    skipped_fields: list[str]
    missing_answers: list[str]
