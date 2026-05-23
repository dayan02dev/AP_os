"""Unit tests for SIP application-template Pydantic models."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.models.sip_application_template import (
    SipApplicationTemplateRecord,
    SipApplicationTemplateUploadResponse,
    SipApplyTemplateResult,
)


def test_upload_response_minimum_fields() -> None:
    tid = uuid.uuid4()
    resp = SipApplicationTemplateUploadResponse(
        template_id=tid,
        parse_status="pending",
    )
    assert resp.template_id == tid
    assert resp.parse_status == "pending"
    assert resp.parsed_data is None
    assert resp.original_filename is None


def test_upload_response_rejects_bad_status() -> None:
    with pytest.raises(ValidationError):
        SipApplicationTemplateUploadResponse(
            template_id=uuid.uuid4(),
            parse_status="weird",
        )


def test_record_round_trip() -> None:
    payload = {
        "id": uuid.uuid4(),
        "user_id": uuid.uuid4(),
        "application_id": uuid.uuid4(),
        "storage_path": "abc/foo.docx",
        "original_filename": "sip.docx",
        "file_size_bytes": 1234,
        "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "parse_status": "completed",
        "parse_error": None,
        "parsed_at": datetime.now(timezone.utc),
        "parsed_data": {"Q5": "Yes — Pvt Ltd, registered in India"},
        "applied_to_application_at": None,
        "created_at": datetime.now(timezone.utc),
    }
    rec = SipApplicationTemplateRecord(**payload)
    assert rec.parsed_data == {"Q5": "Yes — Pvt Ltd, registered in India"}


def test_apply_result_lists_default_empty() -> None:
    result = SipApplyTemplateResult(
        applied_fields=["problem_describe"],
        skipped_fields=[],
        missing_answers=[],
    )
    assert result.applied_fields == ["problem_describe"]
    assert result.skipped_fields == []
    assert result.missing_answers == []
