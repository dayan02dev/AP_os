"""Unit tests for the combined Pass 2 signal scorer."""
from __future__ import annotations

import json
from langchain_core.language_models.fake_chat_models import FakeListChatModel

from app.services.ai_scoring.nodes.score_all_signals import run as score_all


def _signal_payload(name, score):
    return {
        "signal": name, "score": score,
        "rationale": "x",
        "evidence_citations": [{"source": "Q1", "quote": "x"}],
        "confidence_factors": {
            "data_completeness": 0.9, "evidence_specificity": 0.9,
            "internal_consistency": 0.9, "verifiability": 0.9,
            "answer_granularity": 0.9,
        },
        "flags": [],
    }


def test_combined_scorer_returns_all_5_signals():
    combined = {
        "problem_impact":  _signal_payload("problem_impact",  8),
        "completeness":    _signal_payload("completeness",    7),
        "technical_depth": _signal_payload("technical_depth", 9),
        "behavioural":     _signal_payload("behavioural",     6),
        "commitment":      _signal_payload("commitment",      7),
    }
    llm = FakeListChatModel(responses=[json.dumps(combined)])
    state = {"evidence": {"problem": {"describe": "x", "defined": "Yes"}}}
    result = score_all(state, llm=llm)
    assert result["score_problem_impact"].score == 8
    assert result["score_completeness"].score == 7
    assert result["score_technical_depth"].score == 9
    assert result["score_behavioural"].score == 6
    assert result["score_commitment"].score == 7
    for sig in ("problem_impact", "completeness", "technical_depth",
                "behavioural", "commitment"):
        assert result[f"score_{sig}"].signal == sig
