"""Quality gate — 10 deterministic checks on a Round1Summary.

Each check returns a list of failure strings (empty list = pass).
evaluate_summary() runs all of them and returns a structured report.
"""
from __future__ import annotations

import re

from ..state import Round1Summary


_WEASEL_WORDS = (
    "very", "quite", "somewhat", "consider", "maybe", "might", "possibly",
)
_ALLOWED_VERBS = ("ACCEPT", "WAITLIST", "REJECT", "HOLD")
_SCORE_NUMBER_RE = re.compile(r"\b\d+\s*/\s*10\b|\b\d+\s+out of\s+10\b", re.IGNORECASE)
_DEADLINE_RE = re.compile(r"\bwithin\s+\d+\s+(days?|weeks?|hours?)\b", re.IGNORECASE)
_ARTPARK_RE = re.compile(r"artpark", re.IGNORECASE)
_PASSIVE_RE = re.compile(
    r"\b(is|are|was|were|been|being|be)\s+\w+ed\b", re.IGNORECASE
)
_NUMBER_OR_NAMED_ENTITY_RE = re.compile(
    r"\b\d+|\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+|\bQ\d+",
)


def _sections(summary: Round1Summary) -> dict[str, str]:
    return {
        "verdict": summary.verdict,
        "top_strength": summary.top_strength,
        "top_concern": summary.top_concern,
        "program_fit": summary.program_fit,
        "recommendation": summary.recommendation,
    }


def _word_count(text: str) -> int:
    return len(text.split())


# ─── Individual checks ─────────────────────────────────────────────


def check_word_count(summary: Round1Summary, lo: int = 200, hi: int = 280) -> list[str]:
    total = sum(_word_count(v) for v in _sections(summary).values())
    if lo <= total <= hi:
        return []
    return [f"word count {total} outside range {lo}-{hi}"]


def check_score_numbers_in_prose(summary: Round1Summary) -> list[str]:
    fails: list[str] = []
    for name, text in _sections(summary).items():
        if _SCORE_NUMBER_RE.search(text):
            fails.append(f"section '{name}' contains raw score number")
    return fails


def check_weasel_words(summary: Round1Summary) -> list[str]:
    fails: list[str] = []
    for name, text in _sections(summary).items():
        for w in _WEASEL_WORDS:
            if re.search(rf"\b{w}\b", text, re.IGNORECASE):
                fails.append(f"section '{name}' contains weasel word '{w}'")
                break
    return fails


def check_recommendation_verb(summary: Round1Summary) -> list[str]:
    rec = summary.recommendation.strip()
    first = rec.split()[0] if rec else ""
    if first in _ALLOWED_VERBS:
        return []
    if first.upper() in _ALLOWED_VERBS:
        return [f"recommendation verb '{first}' should be uppercase ALL CAPS"]
    return [f"recommendation must start with one of {_ALLOWED_VERBS}"]


def check_accept_has_deadline(summary: Round1Summary) -> list[str]:
    rec = summary.recommendation
    if not rec.lstrip().upper().startswith("ACCEPT"):
        return []
    if _DEADLINE_RE.search(rec):
        return []
    return ["ACCEPT recommendation must include a 'within N days' deadline"]


def check_artpark_reference(summary: Round1Summary) -> list[str]:
    if _ARTPARK_RE.search(summary.program_fit):
        return []
    # ARTPARK assets list also commonly mentioned by name (motion-capture,
    # GPU cluster, etc.) — for the strictest check, require the word.
    return ["program_fit must reference ARTPARK by name"]


def check_specific_entity_per_section(summary: Round1Summary) -> list[str]:
    fails: list[str] = []
    for name, text in _sections(summary).items():
        if not _NUMBER_OR_NAMED_ENTITY_RE.search(text):
            fails.append(f"section '{name}' lacks any specific entity (number or proper noun)")
    return fails


def check_passive_voice_density(summary: Round1Summary, threshold: float = 0.10) -> list[str]:
    """Rough heuristic — fraction of sentences with a be-verb + past participle."""
    all_text = " ".join(_sections(summary).values())
    sentences = re.split(r"[.!?]+", all_text)
    sentences = [s for s in sentences if s.strip()]
    if not sentences:
        return []
    passive = sum(1 for s in sentences if _PASSIVE_RE.search(s))
    density = passive / len(sentences)
    if density >= threshold:
        return [f"passive voice density {density:.0%} ≥ threshold {threshold:.0%}"]
    return []


# ─── Top-level dispatcher ──────────────────────────────────────────


def evaluate_summary(summary: Round1Summary) -> dict:
    """Run all checks. Returns {passed: bool, failures: [...]}.

    'passed' is True iff all hard checks pass. The passive-voice check
    is treated as informational only (warning, not blocker).
    """
    hard_failures: list[str] = []
    hard_failures.extend(check_word_count(summary))
    hard_failures.extend(check_score_numbers_in_prose(summary))
    hard_failures.extend(check_weasel_words(summary))
    hard_failures.extend(check_recommendation_verb(summary))
    hard_failures.extend(check_accept_has_deadline(summary))
    hard_failures.extend(check_artpark_reference(summary))
    hard_failures.extend(check_specific_entity_per_section(summary))

    warnings = check_passive_voice_density(summary)

    return {
        "passed": len(hard_failures) == 0,
        "failures": hard_failures,
        "warnings": warnings,
    }
