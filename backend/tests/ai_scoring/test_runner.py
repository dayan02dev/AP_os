"""Tests for the top-level runner.score_application() function."""
from __future__ import annotations

import json
from unittest.mock import MagicMock

from langchain_core.language_models.fake_chat_models import FakeListChatModel

from app.services.ai_scoring.runner import score_application


def _scripted_llm(sample_row):
    _synthesize_response = {
        "verdict": "This is a STRONG application for the TIR Track at ARTPARK.",
        "top_strength": (
            "Technical specificity at IIT Madras with Patent Granted IP and 10x faster "
            "inspection ties Q11 to Q12 cleanly. The compliant 6-DOF robotic arm with "
            "structured-light and deep-learning defect classifier represents a genuine "
            "hardware-software co-design breakthrough."
        ),
        "top_concern": (
            "Q15 execution hurdles are framed as research questions rather than engineering "
            "challenges. Sensor calibration drift in dusty environments requires empirical "
            "test data from manufacturing partner sites before the Q2 pilot milestone."
        ),
        "program_fit": (
            "Q17 GPU cluster ask aligns directly with ARTPARK's existing compute "
            "infrastructure and the pilot-customer network is an exact match for the Q2 "
            "milestone. ARTPARK provides the right validation environment."
        ),
        "recommendation": "ACCEPT within 14 days pending Patent Office confirmation and written LOI.",
    }
    _combined_signals = {
        sig: {
            "signal": sig, "score": 7,
            "rationale": "x",
            "evidence_citations": [{"source": "Q1", "quote": "x"}],
            "confidence_factors": {
                "data_completeness": 0.9, "evidence_specificity": 0.9,
                "internal_consistency": 0.9, "verifiability": 0.9,
                "answer_granularity": 0.9,
            },
            "flags": [],
        }
        for sig in ("problem_impact", "completeness", "technical_depth",
                    "behavioural", "commitment")
    }
    return FakeListChatModel(responses=[
        # 1× evidence extractor
        json.dumps({
            "basic": {"name": "REDACTED", "org": "IIT", "degree": "PhD"},
            "problem": {"describe": "x", "defined": "Yes"},
            "solution": {"describe": "x", "core_tech": "x",
                         "contrarian_insight": None, "stage": "Pilot-ready product"},
            "execution": {"will_break": "x", "milestone": "x",
                          "infrastructure": "x", "failure": None,
                          "hwsw_integration": None},
            "evidence_assets": {"file_count": 1, "file_names": ["a.pdf"],
                                "video_url_present": True},
            "resume": None,
            "derived": {"has_10x": True, "has_baseline_number": True,
                        "has_patent_keyword": False, "problem_word_count": 30},
        }),
        # 1× combined signal scorer (all 5 signals in one call)
        json.dumps(_combined_signals),
        # 1-4× synthesize (may be retried by quality gate up to 3 times)
        json.dumps(_synthesize_response),
        json.dumps(_synthesize_response),
        json.dumps(_synthesize_response),
        json.dumps(_synthesize_response),
    ])


class _FakeSupabase:
    def __init__(self, application_row):
        self.application_row = application_row
        self.upsert_calls = []
    def table(self, name):
        self._last = name
        return self
    def select(self, *_):
        return self
    def eq(self, *_, **__):
        return self
    def limit(self, *_):
        return self
    def execute(self):
        if self._last == "tir_applications":
            return type("R", (), {"data": [self.application_row]})()
        return type("R", (), {"data": []})()
    def upsert(self, payload, on_conflict=None):
        self.upsert_calls.append(payload)
        return self


def test_score_application_runs_end_to_end(sample_application_row):
    client = _FakeSupabase(sample_application_row)
    llm = _scripted_llm(sample_application_row)
    result = score_application(
        application_id="app-uuid-1", track="tir",
        supabase=client, llm=llm,
    )
    assert result["composite_percentage"] > 0
    assert result["summary_round_1"] is not None
    # Persistence ran
    assert len(client.upsert_calls) == 1
    assert client.upsert_calls[0]["application_id"] == "app-uuid-1"


def test_score_application_404s_unknown_id():
    client = _FakeSupabase(None)
    # Override execute() to return empty
    def _empty_execute():
        return type("R", (), {"data": []})()
    client.execute = _empty_execute
    import pytest
    with pytest.raises(ValueError, match="not found"):
        score_application(
            application_id="ghost-uuid", track="tir",
            supabase=client, llm=FakeListChatModel(responses=[]),
        )
