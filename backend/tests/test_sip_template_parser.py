"""Unit tests for services.sip_template_parser.

Uses the committed fixtures under tests/fixtures/. The OpenRouter LLM
calls are stubbed — these tests exercise the deterministic extraction
+ slicing path and the SIP-specific orchestration.
"""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from app.services.sip_template_parser import (
    QUESTION_TO_SIP_COLUMN,
    SIP_QUESTION_IDS,
    parse_sip_template,
)
from app.services.template_parser import TemplateParseError

FIXTURE_DIR = Path(__file__).parent / "fixtures"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def _load_fixture(name: str) -> bytes:
    return (FIXTURE_DIR / name).read_bytes()


def test_question_to_sip_column_covers_all_17_questions() -> None:
    assert set(QUESTION_TO_SIP_COLUMN.keys()) == set(SIP_QUESTION_IDS)


def test_question_to_sip_column_maps_mcq_to_check_constraint_columns() -> None:
    assert QUESTION_TO_SIP_COLUMN["Q5"] == "sip_incorporated"
    assert QUESTION_TO_SIP_COLUMN["Q6"] == "sip_trl"
    assert QUESTION_TO_SIP_COLUMN["Q8"] == "basic_incubator_association"
    assert QUESTION_TO_SIP_COLUMN["Q10"] == "basic_hear_about"
    assert QUESTION_TO_SIP_COLUMN["Q15"] == "sip_traction"
    assert QUESTION_TO_SIP_COLUMN["Q24"] == "sip_demo_video_url"


@pytest.mark.asyncio
async def test_parse_anchored_complete_returns_all_17_keys() -> None:
    file_bytes = _load_fixture("sip_template_anchored_complete.docx")

    async def fake_normalize(payload, *, user_id=None):
        out = {qid: None for qid in SIP_QUESTION_IDS}
        for qid, entry in payload.items():
            if "options" in entry:
                ticked = [o for o in entry["options"] if o.get("checked")]
                if len(ticked) == 1:
                    out[qid] = ticked[0]["label"]
                else:
                    out[qid] = entry["free_text"].strip() or None
            else:
                out[qid] = entry["free_text"].strip() or None
        return out

    with patch("app.services.sip_template_parser.OpenRouterClient") as mock_client:
        instance = mock_client.return_value
        instance.normalize_sip_template_answers = AsyncMock(side_effect=fake_normalize)
        result = await parse_sip_template(
            file_bytes=file_bytes, mime=DOCX_MIME, user_id="u-1",
        )

    assert set(result.keys()) == set(SIP_QUESTION_IDS)
    assert result["Q11"], "Q11 (problem describe) should be filled"


@pytest.mark.asyncio
async def test_parse_empty_document_raises_template_parse_error() -> None:
    with pytest.raises(TemplateParseError) as excinfo:
        await parse_sip_template(file_bytes=b"", mime=DOCX_MIME, user_id="u-2")
    assert excinfo.value.code == "empty_document"


@pytest.mark.asyncio
async def test_parse_anchors_stripped_falls_back_to_freeform() -> None:
    file_bytes = _load_fixture("sip_template_anchors_stripped.docx")

    async def fake_freeform(document_text, *, user_id=None):
        return {qid: None for qid in SIP_QUESTION_IDS} | {
            "Q11": "Recovered via freeform fallback.",
        }

    with patch("app.services.sip_template_parser.OpenRouterClient") as mock_client:
        instance = mock_client.return_value
        instance.extract_sip_template_answers_freeform = AsyncMock(side_effect=fake_freeform)
        result = await parse_sip_template(
            file_bytes=file_bytes, mime=DOCX_MIME, user_id="u-3",
        )

    assert result["Q11"] == "Recovered via freeform fallback."
    assert result["Q5"] is None


@pytest.mark.asyncio
async def test_parse_tir_template_returns_mostly_null_for_sip_keys() -> None:
    """A TIR .docx uploaded to the SIP flow should yield null for all
    SIP-specific keys (Q5/Q6/Q8/Q24 etc.).  The TIR template shares some
    question IDs (Q9-Q19) with SIP, so the anchor path fires and the LLM
    normaliser is called — we stub normalize_sip_template_answers to return
    null for every SIP key, which is what a real LLM would return when the
    answers don't match the SIP schema.
    """
    file_bytes = _load_fixture("sip_template_tir_uploaded.docx")

    async def fake_normalize(payload, *, user_id=None):
        return {qid: None for qid in SIP_QUESTION_IDS}

    with patch("app.services.sip_template_parser.OpenRouterClient") as mock_client:
        instance = mock_client.return_value
        instance.normalize_sip_template_answers = AsyncMock(side_effect=fake_normalize)
        result = await parse_sip_template(
            file_bytes=file_bytes, mime=DOCX_MIME, user_id="u-4",
        )

    filled = [v for v in result.values() if v]
    assert len(filled) == 0
