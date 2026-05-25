"""Unit tests for compute.py — composite, strength bands, mean-of-5 confidence."""
from __future__ import annotations

from app.services.ai_scoring.compute import (
    WEIGHTS, composite_percentage, strength_label, aggregate_confidence,
)
from app.services.ai_scoring.state import (
    SignalScore, Citation, ConfidenceFactors,
)


def _sig(name, score, cf=None):
    if cf is None:
        cf = ConfidenceFactors(
            data_completeness=1, evidence_specificity=1,
            internal_consistency=1, verifiability=1, answer_granularity=1,
        )
    return SignalScore(
        signal=name, score=score, rationale="x",
        evidence_citations=[Citation(source="Q1", quote="x")],
        confidence_factors=cf, flags=[],
    )


def test_weights_sum_to_one():
    assert sum(WEIGHTS.values()) == 1.0


def test_weights_match_spec():
    assert WEIGHTS["problem_impact"]  == 0.25
    assert WEIGHTS["completeness"]    == 0.30
    assert WEIGHTS["technical_depth"] == 0.25
    assert WEIGHTS["behavioural"]     == 0.00
    assert WEIGHTS["commitment"]      == 0.20


def test_composite_all_10s():
    scores = {
        "problem_impact":  _sig("problem_impact", 10),
        "completeness":    _sig("completeness", 10),
        "technical_depth": _sig("technical_depth", 10),
        "behavioural":     _sig("behavioural", 10),
        "commitment":      _sig("commitment", 10),
    }
    assert composite_percentage(scores) == 100.0


def test_composite_behavioural_is_zero_weighted():
    """Behavioural contributes 0 to composite regardless of score."""
    base = {
        "problem_impact":  _sig("problem_impact", 8),
        "completeness":    _sig("completeness", 8),
        "technical_depth": _sig("technical_depth", 8),
        "commitment":      _sig("commitment", 8),
    }
    s_with_high_b  = {**base, "behavioural": _sig("behavioural", 10)}
    s_with_low_b   = {**base, "behavioural": _sig("behavioural", 1)}

    assert composite_percentage(s_with_high_b) == composite_percentage(s_with_low_b) == 80.0


def test_strength_band_thresholds():
    assert strength_label(85) == "EXCEPTIONAL"
    assert strength_label(80) == "EXCEPTIONAL"
    assert strength_label(79.9) == "STRONG"
    assert strength_label(70) == "STRONG"
    assert strength_label(60) == "MODERATE"
    assert strength_label(50) == "WEAK"
    assert strength_label(49.9) == "NON-COMPETITIVE"


def test_aggregate_confidence_mean_of_5_factors_across_signals():
    """For each of the 5 factors, take the mean across the 5 signals,
    then take the mean of those 5 factor-means."""
    high = ConfidenceFactors(
        data_completeness=1, evidence_specificity=1,
        internal_consistency=1, verifiability=1, answer_granularity=1,
    )
    low = ConfidenceFactors(
        data_completeness=0, evidence_specificity=0,
        internal_consistency=0, verifiability=0, answer_granularity=0,
    )

    all_high = {n: _sig(n, 5, high) for n in
                ["problem_impact", "completeness", "technical_depth",
                 "behavioural", "commitment"]}
    assert aggregate_confidence(all_high) == 1.0

    all_low = {n: _sig(n, 5, low) for n in
               ["problem_impact", "completeness", "technical_depth",
                "behavioural", "commitment"]}
    assert aggregate_confidence(all_low) == 0.0


def test_aggregate_confidence_mixed():
    half = ConfidenceFactors(
        data_completeness=0.5, evidence_specificity=0.5,
        internal_consistency=0.5, verifiability=0.5, answer_granularity=0.5,
    )
    scores = {n: _sig(n, 5, half) for n in
              ["problem_impact", "completeness", "technical_depth",
               "behavioural", "commitment"]}
    assert aggregate_confidence(scores) == 0.5
