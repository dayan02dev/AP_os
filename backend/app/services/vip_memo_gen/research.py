"""Web-search research step: market and competitor facts with source URLs."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field, replace
from urllib.parse import urlsplit

import json_repair

from . import openrouter
from .budget import Budget, Deadline, DeadlineExceeded, RunLog, estimate_cost, paid_call
from .config import GenConfig
from .openrouter import PRICES, WEB_SEARCH_USD, Usage
from .prompts import render_research_messages

_FIELD_CHARS = 300
_SEARCH_RESULT_TOKENS = 15000  # native: assumed input tokens each search result adds
_EXA_USD_PER_RESULT = 0.004     # OpenRouter Exa pricing, $4 per 1000 results
_EXA_RESULT_TOKENS = 8000       # total input tokens the Exa results add (observed ~4.7K)
_SECTIONS = ("market", "competitors")
# Social and profile sites are never market evidence (a memo once cited LinkedIn
# profiles as market sources): excluded from the search where the engine
# supports it, and dropped from the results either way.
SOCIAL_DOMAINS = ("linkedin.com", "facebook.com", "x.com", "twitter.com", "instagram.com",
                  "youtube.com", "medium.com")


def is_social_url(url) -> bool:
    try:
        host = (urlsplit(str(url or "")).hostname or "").lower()
    except ValueError:
        return False
    return any(host == d or host.endswith("." + d) for d in SOCIAL_DOMAINS)


def _drop_social(parsed):
    """The research JSON without items whose URL is a social/profile site."""
    if not isinstance(parsed, dict):
        return parsed
    out = dict(parsed)
    for key in _SECTIONS:
        items = out.get(key)
        if isinstance(items, dict):
            items = [items]
        if not isinstance(items, list):
            continue
        kept = []
        for item in items:
            if isinstance(item, dict) and isinstance(item.get("companies"), list):
                item = {**item, "companies": [c for c in item["companies"]
                                              if not (isinstance(c, dict) and is_social_url(c.get("url")))]}
            elif isinstance(item, dict) and is_social_url(item.get("url")):
                continue
            kept.append(item)
        out[key] = kept
    return out


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
                    if url and url not in out and not is_social_url(url):
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
        if url and url not in out and not is_social_url(url):
            out[url] = {"section_key": "market", "title": str(c.get("title") or ""),
                        "publisher": "", "url": url, "year": None,
                        "claim": str(c.get("content") or "")[:300]}
    return list(out.values())


def estimate(cfg: GenConfig, input_chars: int) -> float:
    """Worst case: tokens plus the search fee and the result text fed back to the model."""
    pin, pout = PRICES[cfg.research_model]
    if cfg.search_engine == "exa":
        return (cfg.max_searches * _EXA_USD_PER_RESULT
                + ((input_chars / 4 + _EXA_RESULT_TOKENS) * pin + cfg.research_max_tokens * pout) / 1_000_000)
    per_search = WEB_SEARCH_USD + _SEARCH_RESULT_TOKENS * pin / 1_000_000
    return estimate_cost(cfg.research_model, input_chars, cfg.research_max_tokens) + cfg.max_searches * per_search


def run(profile: dict, cfg: GenConfig, budget: Budget, runs: RunLog,
        deadline: Deadline | None = None, *, messages: list[dict] | None = None,
        max_searches: int | None = None, step: str = "research") -> ResearchResult:
    """``messages`` / ``max_searches`` / ``step`` let the market refresh reuse this call."""
    if max_searches is not None:
        cfg = replace(cfg, max_searches=max_searches)
    messages = messages or render_research_messages(profile, cfg.max_searches)
    plugin = {"id": "web", "engine": cfg.search_engine, "max_results": cfg.max_searches}
    if cfg.search_engine == "exa":  # native Google search rejects domain filters
        plugin["exclude_domains"] = list(SOCIAL_DOMAINS)
    try:
        chars = sum(len(m["content"]) for m in messages)
        result = paid_call(step, cfg.research_model, estimate(cfg, chars), budget, runs, deadline,
                           lambda timeout: openrouter.chat(
                               cfg.research_model, messages, max_tokens=cfg.research_max_tokens,
                               plugins=[plugin],
                               response_format={"type": "json_object"},
                               zdr=False,  # no ZDR endpoint offers web search; profile is public/PII-free
                               timeout=timeout,
                           ))
    except DeadlineExceeded:
        raise
    except Exception:  # research is best-effort; the memo falls back to [To be confirmed]
        return ResearchResult()
    try:
        parsed = json_repair.loads(result.text)
    except Exception:
        parsed = None
    text = result.text
    if isinstance(parsed, dict):
        parsed = _drop_social(parsed)
        text = json.dumps(parsed, ensure_ascii=False)
    return ResearchResult(text, _sources(parsed, result.annotations), result.usage)
