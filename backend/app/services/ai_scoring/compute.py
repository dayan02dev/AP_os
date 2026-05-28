"""Composite percentage, strength bands, and confidence aggregation."""
from __future__ import annotations

from statistics import mean

from .state import SignalScore


# ─── Weights ────────────────────────────────────────────────────────


WEIGHTS: dict[str, float] = {
    "problem_impact":  0.25,
    "completeness":    0.30,
    "technical_depth": 0.25,
    "behavioural":     0.00,   # scored but not weighted (post-psychometric only)
    "commitment":      0.20,
}
assert abs(sum(WEIGHTS.values()) - 1.0) < 1e-9


# ─── Composite ──────────────────────────────────────────────────────


def composite_percentage(scores: dict[str, SignalScore]) -> float:
    """Weighted composite as a 0-100 percentage.

    score (1-10) × weight, summed, ×10. Behavioural's 0% weight means
    it has no effect on the composite regardless of its score.
    """
    raw = sum(scores[name].score * w for name, w in WEIGHTS.items())
    return round(raw * 10, 1)


# ─── Strength bands ─────────────────────────────────────────────────


def strength_label(percentage: float) -> str:
    """Spec §3 strength bands. Boundaries are inclusive on the lower end."""
    if percentage >= 80:
        return "EXCEPTIONAL"
    if percentage >= 70:
        return "STRONG"
    if percentage >= 60:
        return "MODERATE"
    if percentage >= 50:
        return "WEAK"
    return "NON-COMPETITIVE"


# ─── Confidence aggregation ─────────────────────────────────────────


_FACTORS = (
    "data_completeness", "evidence_specificity", "internal_consistency",
    "verifiability", "answer_granularity",
)


def aggregate_confidence(scores: dict[str, SignalScore]) -> float:
    """Mean of the 5 factors, each averaged across the 5 signals.

    Equivalent to: take the full 5×5 matrix of factor values, mean them all.
    """
    cells: list[float] = []
    for score in scores.values():
        for factor_name in _FACTORS:
            cells.append(getattr(score.confidence_factors, factor_name))
    return round(mean(cells), 3)
