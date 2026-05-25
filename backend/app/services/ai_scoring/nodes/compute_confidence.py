"""Pass 3b — LangGraph node wrapping compute.composite + compute.strength_label."""
from __future__ import annotations

from ..compute import (
    aggregate_confidence, composite_percentage, strength_label,
)


_SIGNAL_NAMES = ("problem_impact", "completeness", "technical_depth",
                 "behavioural", "commitment")


def run(state: dict) -> dict:
    scores = {name: state[f"score_{name}"] for name in _SIGNAL_NAMES}
    pct = composite_percentage(scores)
    return {
        "composite_percentage": pct,
        "strength_label": strength_label(pct),
        "confidence_overall": aggregate_confidence(scores),
    }
