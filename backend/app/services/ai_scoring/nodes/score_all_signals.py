"""Combined Pass 2 — score all 5 signals in a single LLM call.

Loads each signal's rubric from prompts/signals/<signal>.txt (kept as
source of truth for individual rubric content) and concatenates them
into one combined prompt at import time.
"""
from __future__ import annotations

import json
from pathlib import Path

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel

from ..state import SignalScore

_PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts" / "signals"
_SIGNAL_ORDER = (
    "problem_impact", "completeness", "technical_depth",
    "behavioural", "commitment",
)

_PREAMBLE = """You are scoring a TIR application on ALL 5 signals in a single pass.
Each signal has its own rubric below. Apply each independently — do
not let one signal's score influence another's.

You will receive a structured evidence object from Pass 1 containing
all Q&A pairs. Score on the 1-10 ladder. Every score must be backed
by verbatim evidence citations.

CRITICAL — SIGNAL ISOLATION:
  - Behavioural reads ONLY: Q18 + voice across Q9/Q11/Q12/Q15/Q16/Q17/Q19 + resume.
    Do NOT read Q4, Q6, Q7, or Q16 for behavioural — those are commitment's evidence.
  - Commitment reads ONLY: Q4, Q6, Q7, Q16, resume completion patterns.
    Do NOT read Q18 for commitment — that is behavioural's evidence.

═══════════════════════════════════════════════════════════════════
"""

_OUTPUT_SCHEMA = """
OUTPUT FORMAT

Return a SINGLE JSON object with exactly these 5 keys, each value a
complete SignalScore:

{
  "problem_impact":  {"signal": "problem_impact",  "score": <int 1-10>, "rationale": "...", "evidence_citations": [{"source": "Q9", "quote": "..."}], "confidence_factors": {"data_completeness": <0-1>, "evidence_specificity": <0-1>, "internal_consistency": <0-1>, "verifiability": <0-1>, "answer_granularity": <0-1>}, "flags": []},
  "completeness":    {"signal": "completeness",    "score": <int>, ...},
  "technical_depth": {"signal": "technical_depth", "score": <int>, ...},
  "behavioural":     {"signal": "behavioural",     "score": <int>, ...},
  "commitment":      {"signal": "commitment",      "score": <int>, ...}
}

Return JSON only, no prose, no markdown fences.
"""


def _build_prompt() -> str:
    parts = [_PREAMBLE]
    for sig in _SIGNAL_ORDER:
        rubric = (_PROMPTS_DIR / f"{sig}.txt").read_text()
        header = sig.upper().replace("_", " ")
        parts.append(f"\n═══ SIGNAL: {header} ═══\n\n{rubric}\n")
    parts.append(_OUTPUT_SCHEMA)
    return "".join(parts)


_PROMPT_TEXT = _build_prompt()


class _AllSignalsResponse(BaseModel):
    problem_impact: SignalScore
    completeness: SignalScore
    technical_depth: SignalScore
    behavioural: SignalScore
    commitment: SignalScore


def run(state: dict, *, llm: BaseChatModel) -> dict:
    messages = [
        SystemMessage(content=_PROMPT_TEXT),
        HumanMessage(content=json.dumps({"evidence": state["evidence"]}, default=str)),
    ]
    response = llm.invoke(messages)
    text = response.content if hasattr(response, "content") else str(response)
    parsed = _AllSignalsResponse.model_validate_json(text)
    return {
        "score_problem_impact":  parsed.problem_impact,
        "score_completeness":    parsed.completeness,
        "score_technical_depth": parsed.technical_depth,
        "score_behavioural":     parsed.behavioural,
        "score_commitment":      parsed.commitment,
    }
