"""AIR scoring — the rules that turn 18 answers into levels.

Pure functions over air_catalog. No DB, no I/O.

R2 (the ladder) is the load-bearing rule. The three questions per lever are
progressive bands whose ranges overlap: for scientific_principles, q1 spans
AIR 1-3, q2 spans 2-5, q3 spans 5-9. A plain max() over the answers would let
a venture claim AIR 7 on q3 while admitting AIR 1 on q1 — skipping two gates.
So a question may only lift the level if the question before it is answered at
its own maximum.
"""
from __future__ import annotations

from . import air_catalog as cat

_Q_ORDER = ("q1", "q2", "q3")


def lever_level(lever: str, answers: dict[str, str | None]) -> int | None:
    """The AIR level a lever's answers claim, or None if q1 is unanswered.

    Walks the questions in order. Each question can only raise the level while
    every preceding question sits at its own maximum; the first question that
    is unanswered, unrecognised, or below its maximum stops the ladder.
    """
    level: int | None = None
    for q_id in _Q_ORDER:
        got = cat.level_for_option(lever, q_id, answers.get(q_id) or "")
        if got is None:
            break
        level = got if level is None else max(level, got)
        if got < cat.question_max(lever, q_id):
            break
    return level


def score_levers(scores: dict[str, dict[str, str | None]]) -> dict[str, int | None]:
    """Every lever's level, keyed by lever. Levers absent from `scores` are None."""
    return {
        lever: lever_level(lever, scores.get(lever) or {})
        for lever in cat.LEVER_KEYS
    }


def _family_min(levels: dict[str, int | None], keys: tuple[str, ...]) -> int | None:
    """Minimum across a family — None if ANY lever in it is unscored.

    Deliberately not a partial minimum: a family with an unscored lever has no
    defensible score, and reporting min() over the rest would overstate it.
    """
    values = [levels.get(k) for k in keys]
    if any(v is None for v in values):
        return None
    return min(values)  # type: ignore[type-var]


def rollups(levels: dict[str, int | None]) -> dict[str, int | None]:
    """Technology, Commercial and Overall AIR.

    A venture is only as mature as its weakest lever, so every rollup is a
    minimum. Technology and Commercial are surfaced separately because the
    TRL-plus-CRL split is what AIR exists to express.
    """
    return {
        "technology": _family_min(levels, cat.TECHNOLOGY_LEVERS),
        "commercial": _family_min(levels, cat.COMMERCIAL_LEVERS),
        "overall": _family_min(levels, cat.LEVER_KEYS),
    }
