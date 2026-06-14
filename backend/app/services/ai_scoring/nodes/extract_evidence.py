"""Pass 1 — Evidence Extractor node.

Reads the raw application row + optional resume_meta from graph state,
produces a structured 'evidence' dict that downstream scorers consume.
"""
from __future__ import annotations

import json
from pathlib import Path

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

from .._json_utils import extract_json_text

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

    # PROVISIONAL_V0 — SIP-only evidence augmentation. The SIP track reuses
    # this TIR-shaped node + prompt as a baseline; we attach a sip_evidence
    # block (especially traction, which has no TIR analogue) so the LLM sees
    # the SIP-salient signals. The TIR path adds NO key and is unchanged.
    if state.get("track") == "sip":
        from ..tracks.sip_evidence import sip_application_evidence

        user_payload["sip_evidence"] = sip_application_evidence(row)

    messages = [
        SystemMessage(content=_PROMPT_TEXT),
        HumanMessage(content=json.dumps(user_payload, default=str)),
    ]
    response = llm.invoke(messages)
    text = response.content if hasattr(response, "content") else str(response)
    evidence = json.loads(extract_json_text(text))

    return {"evidence": evidence}
