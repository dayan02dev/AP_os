"""Unit tests for the Pass 2 signal scorer factory."""
from __future__ import annotations

from app.services.ai_scoring.nodes.score_signals import make_scorer_node


def test_make_scorer_node_returns_callable(fake_llm):
    llm = fake_llm([{
        "signal": "problem_impact", "score": 8,
        "rationale": "Specific population + quantified pain + clear urgency.",
        "evidence_citations": [{"source": "Q9", "quote": "Defect miss rate ~3%"}],
        "confidence_factors": {
            "data_completeness": 1.0, "evidence_specificity": 0.9,
            "internal_consistency": 0.9, "verifiability": 0.8,
            "answer_granularity": 0.9,
        },
        "flags": [],
    }])
    scorer = make_scorer_node("problem_impact", llm)
    state = {"evidence": {"problem": {"describe": "x", "defined": "Yes"}}}
    result = scorer(state)
    assert "score_problem_impact" in result
    assert result["score_problem_impact"].signal == "problem_impact"
    assert result["score_problem_impact"].score == 8


def test_scorer_writes_to_correct_state_slot(fake_llm):
    """Each of the 5 scorers writes to its own state slot."""
    for signal in ("problem_impact", "completeness", "technical_depth",
                   "behavioural", "commitment"):
        llm = fake_llm([{
            "signal": signal, "score": 5,
            "rationale": "x",
            "evidence_citations": [{"source": "Q1", "quote": "x"}],
            "confidence_factors": {
                "data_completeness": 0.5, "evidence_specificity": 0.5,
                "internal_consistency": 0.5, "verifiability": 0.5,
                "answer_granularity": 0.5,
            },
            "flags": [],
        }])
        scorer = make_scorer_node(signal, llm)
        result = scorer({"evidence": {}})
        slot_name = f"score_{signal}"
        assert slot_name in result
        assert result[slot_name].score == 5
