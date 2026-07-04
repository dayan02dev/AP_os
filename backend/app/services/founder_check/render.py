"""Format a stored ai_screening.founder_check dict into display bullets and
merge them into a `sections` object under the "founder" key. Dependency-light:
imported by the reviewer/leadership/admin detail paths, so it must NOT import
the LangGraph pipeline (graph.py / langgraph).
"""
from __future__ import annotations


def founder_bullets(fc: dict | None) -> list[str]:
    """Return the four labelled bullet strings, skipping empty fields."""
    if not fc:
        return []
    bullets: list[str] = []
    verdict = (fc.get("verdict") or "").strip()
    conf = (fc.get("confidence") or "").strip()
    if verdict:
        bullets.append(
            f"Verdict: {verdict} ({conf} confidence)" if conf else f"Verdict: {verdict}"
        )
    if fc.get("top_signals"):
        bullets.append(f"Top signals: {str(fc['top_signals']).strip()}")
    if fc.get("gaps"):
        bullets.append(f"Gaps / red flags: {str(fc['gaps']).strip()}")
    if fc.get("whats_rare"):
        bullets.append(f"What's rare: {str(fc['whats_rare']).strip()}")
    return bullets


def merge_sections(sections: dict | None, fc: dict | None) -> dict | None:
    """Return a copy of `sections` with a "founder" bullet list added when a
    founder_check is present. Returns None only when both inputs are empty."""
    bullets = founder_bullets(fc)
    base = dict(sections or {})
    if bullets:
        base["founder"] = bullets
    return base or None
