"""Pydantic models for the /resume router and the LLM output shape."""

from __future__ import annotations

from pydantic import BaseModel, Field


class EducationEntry(BaseModel):
    institution: str | None = None
    degree: str | None = None
    field: str | None = None
    start_year: str | None = None
    end_year: str | None = None


class WorkExperience(BaseModel):
    company: str | None = None
    title: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    description: str | None = None


class Venture(BaseModel):
    name: str | None = None
    role: str | None = None
    description: str | None = None
    year_started: str | None = None


class ParsedResumeSchema(BaseModel):
    full_name: str | None = None
    email: str | None = None
    phone: str | None = None
    linkedin_url: str | None = None
    location: str | None = None
    education: list[EducationEntry] = Field(default_factory=list)
    work_experience: list[WorkExperience] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    ventures: list[Venture] = Field(default_factory=list)
    summary: str | None = None


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
    file_size_bytes: int
    mime_type: str
    parse_status: str
    parsed_data: ParsedResumeSchema | None = None
    parse_error: str | None = None
    parsed_at: str | None = None
    created_at: str


class ApplyToApplicationResult(BaseModel):
    applied_fields: list[str]
    skipped_fields: list[str]
