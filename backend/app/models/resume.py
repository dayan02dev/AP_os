"""Pydantic models for the /resume router and the LLM output shape.

Caps are applied so an adversarial or hallucinating LLM can't flood the DB
with megabyte-sized JSON blobs. Real resumes fit inside these bounds with
plenty of headroom.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class EducationEntry(BaseModel):
    institution: str | None = Field(default=None, max_length=300)
    degree: str | None = Field(default=None, max_length=200)
    field: str | None = Field(default=None, max_length=200)
    start_year: str | None = Field(default=None, max_length=20)
    end_year: str | None = Field(default=None, max_length=20)


class WorkExperience(BaseModel):
    company: str | None = Field(default=None, max_length=300)
    title: str | None = Field(default=None, max_length=200)
    start_date: str | None = Field(default=None, max_length=30)
    end_date: str | None = Field(default=None, max_length=30)
    description: str | None = Field(default=None, max_length=3000)


class Venture(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    role: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=3000)
    year_started: str | None = Field(default=None, max_length=20)


class ParsedResumeSchema(BaseModel):
    full_name: str | None = Field(default=None, max_length=200)
    email: str | None = Field(default=None, max_length=320)
    phone: str | None = Field(default=None, max_length=30)
    linkedin_url: str | None = Field(default=None, max_length=1000)
    location: str | None = Field(default=None, max_length=200)
    education: list[EducationEntry] = Field(default_factory=list, max_length=30)
    work_experience: list[WorkExperience] = Field(default_factory=list, max_length=50)
    skills: list[str] = Field(default_factory=list, max_length=200)
    ventures: list[Venture] = Field(default_factory=list, max_length=30)
    summary: str | None = Field(default=None, max_length=5000)


class ResumeUploadResponse(BaseModel):
    resume_id: str
    parse_status: str
    original_filename: str
    parsed_data: ParsedResumeSchema | None = None
    message: str | None = None


class ResumeRecord(BaseModel):
    id: str
    user_id: str
    storage_path: str
    original_filename: str
    file_size_bytes: int = Field(ge=0)
    mime_type: str
    parse_status: str
    parsed_data: ParsedResumeSchema | None = None
    parse_error: str | None = None
    parsed_at: str | None = None
    created_at: str


class ApplyToApplicationResult(BaseModel):
    applied_fields: list[str]
    skipped_fields: list[str]
