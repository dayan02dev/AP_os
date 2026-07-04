"""LangGraph pipeline: résumé bytes -> structured JSON (extract) -> 4-bullet
verdict dict (scout). Isolated from ai_pipeline. Nodes call founder_check.client.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from . import client

_PROMPTS = Path(__file__).parent / "prompts"
PDF_MIME = "application/pdf"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

_VERDICTS = ("EXCEPTIONAL", "STRONG", "PROMISING", "STANDARD", "INSUFFICIENT DATA")
_MARKER = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s*")


class FounderCheckState(TypedDict, total=False):
    resume_bytes: bytes
    mime: str
    resume_json: dict
    verdict: dict
    error: str


def _prompt(name: str) -> str:
    return (_PROMPTS / f"{name}.txt").read_text(encoding="utf-8").strip()


def _parse_json(raw: str) -> dict:
    text = (raw or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text.split("\n", 1)[1] if "\n" in text else text
        text = text.rsplit("```", 1)[0].strip() if "```" in text else text.strip()
    try:
        val = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        try:
            from json_repair import repair_json
            val = json.loads(repair_json(text))
        except Exception:  # noqa: BLE001
            return {}
    return val if isinstance(val, dict) else {}


def parse_verdict(raw: str) -> dict:
    """Parse the 4-bullet talent-scout output into a structured dict."""
    text = (raw or "").strip().strip("`")
    d = {"verdict": "", "confidence": "", "top_signals": "", "gaps": "", "whats_rare": ""}
    for line in text.splitlines():
        s = _MARKER.sub("", line.strip()).strip()
        if not s:
            continue
        low = s.lower()
        val = s.split(":", 1)[1].strip() if ":" in s else s
        if low.startswith("verdict"):
            up = val.upper()
            for v in _VERDICTS:
                if v in up:
                    d["verdict"] = v
                    break
            m = re.search(r"\b(LOW|MEDIUM|MED|HIGH)\b", up)
            if m:
                d["confidence"] = "MED" if m.group(1) in ("MED", "MEDIUM") else m.group(1)
        elif low.startswith("top signal"):
            d["top_signals"] = val
        elif low.startswith("gap") or "red flag" in low:
            d["gaps"] = val
        elif low.startswith("what"):
            d["whats_rare"] = val
    if not d["verdict"]:
        d["verdict"] = "INSUFFICIENT DATA"
    if not d["confidence"]:
        d["confidence"] = "LOW"
    return d


def _extract_node(state: FounderCheckState) -> dict:
    mime = (state.get("mime") or "").lower().strip()
    prompt = _prompt("extract")
    try:
        if mime == PDF_MIME:
            raw = client.ocr_pdf_to_json(state["resume_bytes"], prompt)
        elif mime == DOCX_MIME:
            from ..file_parser import extract_text
            text = extract_text(state["resume_bytes"], mime)
            raw = client.structure_text_to_json(text, prompt)
        else:
            return {"resume_json": {}, "error": f"unsupported mime {mime!r}"}
        return {"resume_json": _parse_json(raw)}
    except Exception as exc:  # noqa: BLE001
        return {"resume_json": {}, "error": str(exc)}


def _scout_node(state: FounderCheckState) -> dict:
    rj = state.get("resume_json") or {}
    if not rj:
        return {"verdict": {
            "verdict": "INSUFFICIENT DATA", "confidence": "LOW",
            "top_signals": "", "gaps": "no résumé text could be read",
            "whats_rare": "nothing distinctly rare",
        }}
    raw = client.scout(json.dumps(rj, ensure_ascii=False), _prompt("scout"))
    return {"verdict": parse_verdict(raw)}


def build_graph():
    g = StateGraph(FounderCheckState)
    g.add_node("extract", _extract_node)
    g.add_node("scout", _scout_node)
    g.add_edge(START, "extract")
    g.add_edge("extract", "scout")
    g.add_edge("scout", END)
    return g.compile()
