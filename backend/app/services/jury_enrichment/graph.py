"""LangGraph pipeline: research (web-grounded) → extract → map domains."""
import json
import logging
from typing import TypedDict

from langgraph.graph import END, START, StateGraph

from .client import MODEL_ONLINE, _post
from .prompts import EXTRACT_SYSTEM, MAP_DOMAINS_SYSTEM, RESEARCH_SYSTEM

log = logging.getLogger(__name__)


class JuryEnrichState(TypedDict, total=False):
    name: str
    self_domains: list[str]
    linkedin_url: str | None
    taxonomy: list[str]
    research: str
    profile: dict
    domains: list[str]
    error: str


def _parse_json(raw: str) -> dict:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
    try:
        out = json.loads(cleaned)
    except json.JSONDecodeError:
        try:
            from json_repair import repair_json
            out = json.loads(repair_json(cleaned))
        except Exception:
            return {}
    return out if isinstance(out, dict) else {}


def _research_node(state: JuryEnrichState) -> dict:
    try:
        hints = []
        if state.get("linkedin_url"):
            hints.append(f"LinkedIn: {state['linkedin_url']}")
        if state.get("self_domains"):
            hints.append("Self-declared expertise: " + ", ".join(state["self_domains"]))
        user = f"Person: {state['name']}\n" + "\n".join(hints)
        raw = _post(
            [{"role": "system", "content": RESEARCH_SYSTEM},
             {"role": "user", "content": user}],
            model=MODEL_ONLINE)
        return {"research": raw}
    except Exception as exc:  # noqa: BLE001
        log.warning("jury enrich research failed: %s", exc)
        return {"research": "", "error": str(exc)}


def _extract_node(state: JuryEnrichState) -> dict:
    if not state.get("research"):
        return {"profile": {}}
    try:
        raw = _post(
            [{"role": "system", "content": EXTRACT_SYSTEM},
             {"role": "user", "content": state["research"]}],
            json_mode=True)
        return {"profile": _parse_json(raw)}
    except Exception as exc:  # noqa: BLE001
        return {"profile": {}, "error": str(exc)}


def _map_domains_node(state: JuryEnrichState) -> dict:
    profile = state.get("profile") or {}
    taxonomy = state.get("taxonomy") or []
    if not profile or not taxonomy:
        return {"domains": state.get("self_domains") or []}
    try:
        user = json.dumps({"profile": profile,
                           "self_declared": state.get("self_domains") or [],
                           "taxonomy": taxonomy})
        raw = _post(
            [{"role": "system", "content": MAP_DOMAINS_SYSTEM},
             {"role": "user", "content": user}],
            json_mode=True)
        parsed = _parse_json(raw)
        domains = [d for d in (parsed.get("domains") or []) if d in taxonomy]
        return {"domains": domains or (state.get("self_domains") or [])}
    except Exception as exc:  # noqa: BLE001
        return {"domains": state.get("self_domains") or [], "error": str(exc)}


def build_graph():
    # Node id can't be "research" — it collides with the `research` state key
    # (LangGraph raises "already being used as a state key"), unlike
    # founder_check's node names which never match a TypedDict field.
    g = StateGraph(JuryEnrichState)
    g.add_node("do_research", _research_node)
    g.add_node("extract", _extract_node)
    g.add_node("map_domains", _map_domains_node)
    g.add_edge(START, "do_research")
    g.add_edge("do_research", "extract")
    g.add_edge("extract", "map_domains")
    g.add_edge("map_domains", END)
    return g.compile()
