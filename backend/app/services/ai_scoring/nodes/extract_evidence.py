"""Pass 1 — Evidence Extractor node.

Reads the raw application row + optional resume_meta from graph state,
produces a structured 'evidence' dict that downstream scorers consume.
"""
from __future__ import annotations

import json
from pathlib import Path

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

_PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "extract_evidence.txt"
_PROMPT_TEXT = _PROMPT_PATH.read_text()


def run(state: dict, *, llm: BaseChatModel) -> dict:
    """Pure LangGraph node — returns the state delta {evidence: ...}."""
    row = state["application_row"]
    resume_meta = state.get("resume_meta")

    user_payload = {
        "application_row": row,
        "resume_meta": resume_meta,
    }
    messages = [
        SystemMessage(content=_PROMPT_TEXT),
        HumanMessage(content=json.dumps(user_payload, default=str)),
    ]
    response = llm.invoke(messages)
    text = response.content if hasattr(response, "content") else str(response)
    evidence = json.loads(text)

    return {"evidence": evidence}
