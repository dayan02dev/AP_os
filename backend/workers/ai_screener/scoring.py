"""Scoring data structures and weighted-overall helper.

Pure module — no I/O, no imports beyond stdlib. Both stub.py and
openrouter_client.py import ScoreResult and compute_overall from here.

Weights (spec §6):
    score_problem     0.22
    score_solution    0.30
    score_tech        0.22
    score_founders    0.14
    score_commitment  0.12
"""

from __future__ import annotations

from dataclasses import dataclass


# ─── Category weights (must sum to 1.0) ────────────────────────────────
WEIGHTS: dict[str, float] = {
    "score_problem": 0.22,
    "score_solution": 0.30,
    "score_tech": 0.22,
    "score_founders": 0.14,
    "score_commitment": 0.12,
}


@dataclass(frozen=True)
class ScoreResult:
    """Result returned by either the stub scorer or the OpenRouter client.

    score_integrity is intentionally absent — it stays NULL in Phase 1 and
    the worker sets it to None when upserting to ai_screening.
    """

    score_problem: float
    score_solution: float
    score_tech: float
    score_founders: float
    score_commitment: float
    score_overall: float
    summary: str
    model: str
    raw_response: str


def compute_overall(
    problem: float,
    solution: float,
    tech: float,
    founders: float,
    commitment: float,
) -> float:
    """Return the weighted overall score, rounded to 1 decimal place.

    Each category score must be in [0.0, 10.0]; the caller is responsible
    for clamping before calling this function.

    >>> compute_overall(5.0, 5.0, 5.0, 5.0, 5.0)
    5.0
    >>> compute_overall(10.0, 10.0, 10.0, 10.0, 10.0)
    10.0
    >>> compute_overall(0.0, 0.0, 0.0, 0.0, 0.0)
    0.0
    """
    total = (
        problem * WEIGHTS["score_problem"]
        + solution * WEIGHTS["score_solution"]
        + tech * WEIGHTS["score_tech"]
        + founders * WEIGHTS["score_founders"]
        + commitment * WEIGHTS["score_commitment"]
    )
    return round(total, 1)
