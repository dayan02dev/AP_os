"""Tests for Pass 4 synthesize node."""
from __future__ import annotations

from app.services.ai_scoring.nodes.synthesize import run as synthesize_node
from app.services.ai_scoring.state import (
    Citation, ConfidenceFactors, SignalScore,
)


def _sig(name, score=8):
    return SignalScore(
        signal=name, score=score, rationale="x",
        evidence_citations=[Citation(source="Q1", quote="x")],
        confidence_factors=ConfidenceFactors(
            data_completeness=0.9, evidence_specificity=0.9,
            internal_consistency=0.9, verifiability=0.9, answer_granularity=0.9,
        ),
        flags=[],
    )


def _state():
    return {
        "score_problem_impact": _sig("problem_impact", 8),
        "score_completeness": _sig("completeness", 8),
        "score_technical_depth": _sig("technical_depth", 8),
        "score_behavioural": _sig("behavioural", 6),
        "score_commitment": _sig("commitment", 7),
        "caps_applied": [],
        "composite_percentage": 75.5,
        "strength_label": "STRONG",
        "confidence_overall": 0.85,
        "tsp_context": None,
    }


def test_synthesize_returns_round1_summary(fake_llm):
    llm = fake_llm([{
        "verdict": "This is a STRONG application for the TIR Track.",
        "top_strength": "Technical specificity at IIT Madras backed by Patent Granted.",
        "top_concern": "Q15 hurdles framed as research questions risks scope drift.",
        "program_fit": "Q17 ask for 6-DOF rig matches ARTPARK motion-capture arena.",
        "recommendation": "ACCEPT within 14 days pending Patent Office confirmation.",
    }])
    result = synthesize_node(_state(), llm=llm)
    assert "summary_round_1" in result
    s = result["summary_round_1"]
    assert "STRONG" in s.verdict
    assert s.recommendation.startswith("ACCEPT")


def test_synthesize_with_tsp_context_raises(fake_llm):
    """Round 2 path not implemented in v1 — must raise NotImplementedError."""
    llm = fake_llm([{}])
    state = _state()
    state["tsp_context"] = {"composite_score": 60}
    import pytest
    with pytest.raises(NotImplementedError):
        synthesize_node(state, llm=llm)
