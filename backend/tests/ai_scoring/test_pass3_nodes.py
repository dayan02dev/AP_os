"""Tests for Pass 3 LangGraph node wrappers over caps.py + compute.py."""
from __future__ import annotations

from app.services.ai_scoring.nodes.apply_caps import run as apply_caps_node
from app.services.ai_scoring.nodes.compute_confidence import run as compute_node
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


def test_apply_caps_node_returns_capped_scores_and_events(sample_application_row):
    """Wrapping caps.apply_all_caps as a LangGraph node."""
    state = {
        "application_row": {**sample_application_row,
                            "basic_incubator_association": "Yes",
                            "basic_incubator_details": "Currently incubated at XYZ."},
        "resume_meta": None,
        "score_problem_impact": _sig("problem_impact"),
        "score_completeness": _sig("completeness"),
        "score_technical_depth": _sig("technical_depth"),
        "score_behavioural": _sig("behavioural"),
        "score_commitment": _sig("commitment"),
    }
    result = apply_caps_node(state)
    # C1 should fire → commitment capped at 3
    assert result["score_commitment"].score == 3
    assert "caps_applied" in result
    assert len(result["caps_applied"]) >= 1


def test_compute_confidence_node_returns_composite_and_strength(sample_application_row):
    state = {
        "score_problem_impact": _sig("problem_impact", 8),
        "score_completeness": _sig("completeness", 8),
        "score_technical_depth": _sig("technical_depth", 8),
        "score_behavioural": _sig("behavioural", 8),    # 0% weight
        "score_commitment": _sig("commitment", 8),
    }
    result = compute_node(state)
    assert result["composite_percentage"] == 80.0
    assert result["strength_label"] == "EXCEPTIONAL"
    assert 0.0 <= result["confidence_overall"] <= 1.0
