"""Unit tests for SIP template normalization in OpenRouterClient."""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.llm_service import (
    LLMParseError,
    OpenRouterClient,
    SIP_TEMPLATE_Q5_OPTIONS,
    SIP_TEMPLATE_Q6_OPTIONS,
    SIP_TEMPLATE_Q8_OPTIONS,
    SIP_TEMPLATE_Q10_OPTIONS,
    SIP_TEMPLATE_Q15_OPTIONS,
    SIP_TEMPLATE_REQUIRED_KEYS,
)


def test_sip_q5_options_match_db_check_constraint() -> None:
    assert SIP_TEMPLATE_Q5_OPTIONS == [
        "Yes — Pvt Ltd, registered in India",
        "Not yet — we're still pre-incorporation",
    ]


def test_sip_q6_options_match_db_check_constraint() -> None:
    assert SIP_TEMPLATE_Q6_OPTIONS == [
        "TRL 3 or earlier — research stage",
        "TRL 4 — lab-validated prototype",
        "TRL 5 — pilot-tested in a relevant environment",
        "TRL 6+ — demonstrated in operational setting",
    ]


def test_sip_q8_options_are_yes_no() -> None:
    assert SIP_TEMPLATE_Q8_OPTIONS == ["Yes", "No"]


def test_sip_q10_options_include_other() -> None:
    assert "Other" in SIP_TEMPLATE_Q10_OPTIONS
    assert len(SIP_TEMPLATE_Q10_OPTIONS) == 8


def test_sip_q15_options_match_db_check_constraint() -> None:
    assert SIP_TEMPLATE_Q15_OPTIONS == [
        "Pre-revenue — building toward our first pilot",
        "Active pilots (paid or unpaid) with design partners",
        "Paying pilots — customers have paid for early access",
        "Live paying customers — repeat revenue",
    ]


def test_sip_required_keys_cover_17_questions() -> None:
    expected = {f"Q{n}" for n in [5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 24]}
    assert SIP_TEMPLATE_REQUIRED_KEYS == expected


@pytest.mark.asyncio
async def test_normalize_sip_template_answers_happy_path() -> None:
    client = OpenRouterClient(api_key="fake", model="google/gemini-2.0-flash-001")
    fake_body = {
        "choices": [
            {
                "message": {
                    "content": json.dumps({k: None for k in SIP_TEMPLATE_REQUIRED_KEYS} | {
                        "Q5": "Yes — Pvt Ltd, registered in India",
                        "Q11": "We are solving X.",
                    })
                }
            }
        ],
        "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150},
        "model": "google/gemini-2.0-flash-001",
    }

    async def fake_post_and_read(*args, **kwargs):
        return fake_body

    with patch.object(client, "_post_and_read", side_effect=fake_post_and_read):
        result = await client.normalize_sip_template_answers(
            {"Q5": {"free_text": "", "options": []}}, user_id="u-test"
        )

    assert result["Q5"] == "Yes — Pvt Ltd, registered in India"
    assert result["Q11"] == "We are solving X."
    assert result["Q12"] is None


@pytest.mark.asyncio
async def test_normalize_sip_template_answers_strict_keys() -> None:
    client = OpenRouterClient(api_key="fake", model="google/gemini-2.0-flash-001")
    bad_body = {
        "choices": [{"message": {"content": json.dumps({"Q5": "yes"})}}],
        "usage": {},
        "model": "x",
    }

    async def fake_post_and_read(*args, **kwargs):
        return bad_body

    with patch.object(client, "_post_and_read", side_effect=fake_post_and_read):
        with pytest.raises(LLMParseError, match="missing required keys"):
            await client.normalize_sip_template_answers({}, user_id="u")


def test_sip_system_prompt_normalises_q10_other_variant() -> None:
    """The SIP anchor-based prompt instructs the LLM to normalize verbose
    'Other' variants to the canonical 'Other' string."""
    from app.services.llm_service import OpenRouterClient
    prompt = OpenRouterClient._SIP_TEMPLATE_SYSTEM_PROMPT
    # The rule must mention Q10 specifically AND the canonical "Other".
    assert "Q10" in prompt
    # Must explicitly mention the verbose label or the normalization intent.
    assert "Other (please specify" in prompt or "parenthetical" in prompt.lower()
    # Must say to emit "Other" without the suffix.
    assert 'emit exactly the string "Other"' in prompt or "canonical" in prompt.lower()


def test_sip_freeform_prompt_normalises_q10_other_variant() -> None:
    """Same normalization rule must apply to the freeform-fallback prompt."""
    from app.services.llm_service import OpenRouterClient
    prompt = OpenRouterClient._SIP_TEMPLATE_FREEFORM_SYSTEM_PROMPT
    assert "Q10" in prompt
    assert "Other (please specify" in prompt or "parenthetical" in prompt.lower()
    assert 'emit exactly the string "Other"' in prompt or "canonical" in prompt.lower()
