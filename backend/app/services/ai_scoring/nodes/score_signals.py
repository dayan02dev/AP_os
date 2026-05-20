"""Pass 2 — Signal scorer node factory.

Each of the 5 scorers is identical structurally; only the prompt text
and the output-slot name differ. make_scorer_node(signal, llm) returns
a callable that LangGraph can attach to the graph.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Callable

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

from ..state import SignalScore

_PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts" / "signals"


def _load_prompt(signal: str) -> str:
    return (_PROMPTS_DIR / f"{signal}.txt").read_text()


def make_scorer_node(signal: str, llm: BaseChatModel) -> Callable[[dict], dict]:
    """Build a LangGraph node that scores one signal.

    The returned callable reads state['evidence'] and writes
    state['score_<signal>'] = SignalScore(...).
    """
    prompt = _load_prompt(signal)
    slot_name = f"score_{signal}"

    def node(state: dict) -> dict:
        messages = [
            SystemMessage(content=prompt),
            HumanMessage(content=json.dumps({"evidence": state["evidence"]}, default=str)),
        ]
        response = llm.invoke(messages)
        text = response.content if hasattr(response, "content") else str(response)
        score_obj = SignalScore.model_validate_json(text)
        return {slot_name: score_obj}

    node.__name__ = f"score_{signal}_node"
    return node
