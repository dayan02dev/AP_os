"""Pass 4 — Synthesize node.

Round 1: reads scores + composite + caps + confidence, calls LLM with
the round-1 prompt, returns a Round1Summary in state['summary_round_1'].

Round 2: NOT IMPLEMENTED in v1. If state['tsp_context'] is non-None,
raises NotImplementedError. The seam is in place for future TSP work.
"""
from __future__ import annotations

import json
from pathlib import Path

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

from .._json_utils import extract_json_text
from ..state import Round1Summary

_BASE = Path(__file__).resolve().parent.parent
_PROMPT_TEXT = (_BASE / "prompts" / "synthesize_round_1.txt").read_text()
_ARTPARK_ASSETS = (_BASE / "artpark_assets.md").read_text()


def run(state: dict, *, llm: BaseChatModel) -> dict:
    if state.get("tsp_context"):
        raise NotImplementedError(
            "Round 2 (TSP) synthesis is not implemented in v1; "
            "tsp_context must be None."
        )

    payload = {
        "scores": {
            name: state[f"score_{name}"].model_dump()
            for name in ("problem_impact", "completeness", "technical_depth",
                         "behavioural", "commitment")
        },
        "composite_percentage": state["composite_percentage"],
        "strength_label": state["strength_label"],
        "confidence_overall": state["confidence_overall"],
        "caps_applied": [e.model_dump() for e in state.get("caps_applied", [])],
        "artpark_assets": _ARTPARK_ASSETS,
    }
    messages = [
        SystemMessage(content=_PROMPT_TEXT),
        HumanMessage(content=json.dumps(payload, default=str)),
    ]
    response = llm.invoke(messages)
    text = response.content if hasattr(response, "content") else str(response)
    summary = Round1Summary.model_validate_json(extract_json_text(text))
    return {"summary_round_1": summary}
