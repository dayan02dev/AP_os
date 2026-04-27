"""Pydantic models for the offline application-template upload flow.

Mirrors models/resume.py — tracks one row per .docx/.pdf the applicant
uploads after filling our offline template. Parsed answers (keyed Q9..Q19)
land in `parsed_data`; apply-to-application copies them to the matching
columns on `public.applications` only when the target column is currently
NULL/empty.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict


ParseStatus = Literal["pending", "processing", "completed", "failed"]


class ApplicationTemplateUploadResponse(BaseModel):
    template_id: UUID
    parse_status: ParseStatus
    original_filename: str | None = None
    parsed_data: dict[str, Any] | None = None
    message: str | None = None


class ApplicationTemplateRecord(BaseModel):
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


class ApplyTemplateResult(BaseModel):
    """Result of POST /application-templates/me/apply-to-application.

    `applied_fields`  → columns we wrote (was NULL/empty before).
    `skipped_fields`  → columns left untouched because the applicant had
                        already typed something there. Surfacing both
                        lets the wizard show a precise toast.
    `missing_answers` → questions the LLM couldn't extract — surfaced so
                        the wizard can highlight them later.
    """

    applied_fields: list[str]
    skipped_fields: list[str]
    missing_answers: list[str]
