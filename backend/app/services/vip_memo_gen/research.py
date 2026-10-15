"""Web-search research step: market and competitor facts with source URLs."""
from __future__ import annotations

import re
import time
from collections.abc import Callable
from dataclasses import dataclass, field

import json_repair

from . import openrouter
from .budget import Budget, estimate_cost
from .config import GenConfig
from .openrouter import LlmResult, Usage
from .prompts import render_research_messages

_FIELD_CHARS = 300
_SECTIONS = ("market", "competitors")


@dataclass
class ResearchResult:
    json_text: str = ""
    sources: list[dict] = field(default_factory=list)
    usage: Usage = field(default_factory=Usage)


def _clean(value) -> str:
    """Founder text goes to a web-search model: flatten it and strip tag characters."""
    text = re.sub(r"\s+", " ", str(value or "")).replace("<", "").replace(">", "").strip()
    return text[:_FIELD_CHARS]


def _parse_block(application_block: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for part in re.split(r"\n\s*\n", application_block or ""):
        label, sep, value = part.partition(":")
        if sep and label.strip() and label.strip() not in fields:
            fields[label.strip()] = value.strip()
    return fields


def profile_from_application(application_block: str, documents: list[tuple[str, str]]) -> dict:
    """Search profile from application fields only. ``documents`` is deliberately unused."""
    f = _parse_block(application_block)
    solution = f.get("Solution", "")
    trl = f.get("TRL", "")
    one_liner = solution + (f" (TRL {trl})" if trl and solution else "")
    return {
        "name": _clean(f.get("Organisation", "")),
        "one_liner": _clean(one_liner),
        "sector": _clean(f.get("Core technology") or f.get("Problem", "")),
        "segments": [s for s in [_clean(f.get("Problem", ""))] if s],
        "geography": "India",
    }


def _clean_url(url) -> str:
    return url.strip() if isinstance(url, str) and url.strip().lower().startswith(("http://", "https://")) else ""


def _sources(parsed, annotations: list[dict]) -> list[dict]:
    out: dict[str, dict] = {}
    if isinstance(parsed, dict):
        for key in _SECTIONS:
            items = parsed.get(key)
            if isinstance(items, dict):
                items = [items]
            for item in items if isinstance(items, list) else []:
                subs = item.get("companies") if isinstance(item, dict) else None
                for it in (subs if isinstance(subs, list) else [item]):
                    if not isinstance(it, dict):
                        continue
                    url = _clean_url(it.get("url"))
                    if url and url not in out:
                        out[url] = {
                            "section_key": key,
                            "title": str(it.get("title") or it.get("name") or ""),
                            "publisher": str(it.get("publisher") or ""),
                            "url": url,
                            "year": it.get("year"),
                            "claim": str(it.get("claim") or it.get("figure")
                                         or it.get("what") or it.get("limitation") or ""),
                        }
    for ann in annotations or []:
        c = ann.get("url_citation") if isinstance(ann, dict) and ann.get("type") == "url_citation" else None
        url = _clean_url((c or {}).get("url"))
        if url and url not in out:
            out[url] = {"section_key": "market", "title": str(c.get("title") or ""),
                        "publisher": "", "url": url, "year": None,
                        "claim": str(c.get("content") or "")[:300]}
    return list(out.values())


def run(profile: dict, cfg: GenConfig, budget: Budget,
        on_usage: Callable[[str, LlmResult, int], None]) -> ResearchResult:
    messages = render_research_messages(profile, cfg.max_searches)
    max_tokens = 6000
    try:
        chars = sum(len(m["content"]) for m in messages)
        budget.check(estimate_cost(cfg.research_model, chars, max_tokens))
        t0 = time.monotonic()
        result = openrouter.chat(
            cfg.research_model, messages, max_tokens=max_tokens,
            plugins=[{"id": "web", "engine": "native", "max_results": cfg.max_searches}],
            response_format={"type": "json_object"},
        )
    except Exception:  # research is best-effort; the memo falls back to [To be confirmed]
        return ResearchResult()
    duration_ms = int((time.monotonic() - t0) * 1000)
    budget.add(result.usage.cost_usd)
    on_usage("research", result, duration_ms)
    try:
        parsed = json_repair.loads(result.text)
    except Exception:
        parsed = None
    return ResearchResult(result.text, _sources(parsed, result.annotations), result.usage)
