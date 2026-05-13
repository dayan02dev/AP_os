"""Deterministic stub scorer for AI screening (Phase 1 default).

No I/O. Seeds Python's random.Random with a hash of the application_id so
the same application always produces the same scores regardless of Lambda
container or invocation order.

Public surface:
    score(application_id: str) -> ScoreResult
"""

from __future__ import annotations

import json
import random

from .scoring import ScoreResult, compute_overall

# Gaussian distribution parameters for each category score.
_MU: float = 6.5
_SIGMA: float = 1.2


def _clamp(value: float, lo: float = 0.0, hi: float = 10.0) -> float:
    """Clamp a float to [lo, hi]."""
    return max(lo, min(hi, value))


def score(application_id: str) -> ScoreResult:
    """Return a deterministic ScoreResult for the given application_id.

    The seed is derived from the application_id so the same application
    always scores identically across runs and Lambda containers.

    Args:
        application_id: UUID string identifying the application.

    Returns:
        A ScoreResult with five category scores, weighted overall, summary,
        model name ``"stub"``, and a raw_response JSON string encoding the
        seed and distribution parameters for audit purposes.
    """
    seed = hash(application_id) & 0xFFFFFFFF
    rng = random.Random(seed)

    problem = round(_clamp(rng.gauss(_MU, _SIGMA)), 1)
    solution = round(_clamp(rng.gauss(_MU, _SIGMA)), 1)
    tech = round(_clamp(rng.gauss(_MU, _SIGMA)), 1)
    founders = round(_clamp(rng.gauss(_MU, _SIGMA)), 1)
    commitment = round(_clamp(rng.gauss(_MU, _SIGMA)), 1)

    overall = compute_overall(problem, solution, tech, founders, commitment)
    summary = f"Stub screening for {application_id[:8]} — overall {overall:.1f}."
    raw = json.dumps({"seed": seed, "mu": _MU, "sigma": _SIGMA})

    return ScoreResult(
        score_problem=problem,
        score_solution=solution,
        score_tech=tech,
        score_founders=founders,
        score_commitment=commitment,
        score_overall=overall,
        summary=summary,
        model="stub",
        raw_response=raw,
    )
