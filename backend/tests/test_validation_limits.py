"""Tests for Phase 8 input-length hardening on Pydantic models.

Strings over cap and lists over max_length must be rejected by the model
itself — no need to hit the DB or the HTTP layer for these checks.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.models.application import ApplicationUpdate
from app.models.resume import ParsedResumeSchema
from app.models.support import SupportTicketCreate


def test_application_full_name_too_long():
    with pytest.raises(ValidationError):
        ApplicationUpdate(basic_full_name="A" * 5000)


def test_application_long_text_over_cap():
    with pytest.raises(ValidationError):
        ApplicationUpdate(solution_describe="x " * 6000)  # >> 5000 chars


def test_application_teammates_list_over_cap():
    with pytest.raises(ValidationError):
        ApplicationUpdate(basic_teammates=[{"email": "a@b.com"}] * 15)


def test_application_evidence_files_over_cap():
    with pytest.raises(ValidationError):
        ApplicationUpdate(evidence_files=[{"name": "f"} for _ in range(25)])


def test_application_accepts_values_at_cap():
    # Fields at exactly the cap length must pass.
    ApplicationUpdate(basic_full_name="A" * 200)
    ApplicationUpdate(solution_describe="x" * 5000)


def test_application_rejects_unknown_fields():
    with pytest.raises(ValidationError):
        ApplicationUpdate(not_a_real_field="oops")


def test_application_rejects_invalid_enum():
    with pytest.raises(ValidationError):
        ApplicationUpdate(basic_has_team="totally made up")


def test_parsed_resume_summary_over_cap():
    with pytest.raises(ValidationError):
        ParsedResumeSchema(summary="s" * 10000)


def test_parsed_resume_skills_over_cap():
    with pytest.raises(ValidationError):
        ParsedResumeSchema(skills=[f"skill-{i}" for i in range(300)])


def test_parsed_resume_accepts_realistic_shape():
    ParsedResumeSchema(
        full_name="Test Person",
        email="t@example.com",
        skills=["python", "react"],
        summary="Short summary.",
    )


def test_support_ticket_subject_too_short():
    with pytest.raises(ValidationError):
        SupportTicketCreate(
            email="a@b.com", subject="hi", body="z" * 50, category="technical",
        )


def test_support_ticket_body_too_short():
    with pytest.raises(ValidationError):
        SupportTicketCreate(
            email="a@b.com", subject="valid subject",
            body="too short", category="technical",
        )


def test_support_ticket_body_too_long():
    with pytest.raises(ValidationError):
        SupportTicketCreate(
            email="a@b.com", subject="valid subject",
            body="x" * 6000, category="technical",
        )


def test_support_ticket_bad_email():
    with pytest.raises(ValidationError):
        SupportTicketCreate(
            email="not-an-email", subject="valid subject",
            body="z" * 50, category="technical",
        )


def test_support_ticket_bad_category():
    with pytest.raises(ValidationError):
        SupportTicketCreate(
            email="a@b.com", subject="valid subject",
            body="z" * 50, category="not-a-category",
        )


def test_application_linkedin_url_over_cap():
    with pytest.raises(ValidationError):
        ApplicationUpdate(linkedin_url="https://linkedin.com/in/" + "x" * 500)


def test_application_github_url_over_cap():
    with pytest.raises(ValidationError):
        ApplicationUpdate(github_url="https://github.com/" + "x" * 500)


def test_application_resume_file_id_rejects_non_uuid():
    with pytest.raises(ValidationError):
        ApplicationUpdate(resume_file_id="not-a-uuid")
