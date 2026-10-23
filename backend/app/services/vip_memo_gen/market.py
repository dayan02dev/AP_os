"""Market refresh: re-research and re-write only ``sections.market`` of an existing memo.

Used after the main writer for new memos and by ``scripts/refresh_vip_memo_market.py`` for
stored ones. The rest of the memo is passed to the model as context and never changed (apart
from the market takeaway/source and the verification tags).
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field

import json_repair
from pydantic import ValidationError

from . import research
from .budget import Budget, Deadline, RunLog
from .config import GenConfig
from .openrouter import ModelRefusal
from .prompts import render_market_messages, render_market_research_messages
from .schema import Market, MemoValidationError, _Salvager
from .tags import retag
from .writer import _call

log = logging.getLogger(__name__)

MARKET_MAX_COST_USD = 0.60     # ceiling for one refresh (research + write), on top of the memo
MARKET_SEARCHES = 12
MARKET_MAX_TOKENS = 12000
_FIELD_CHARS = 300
_MAX_SEGMENTS = 5


@dataclass
class MarketResult:
    memo: dict
    sources: list[dict] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    writer: str = ""


def _flat(v) -> str:
    if isinstance(v, list):
        return " ".join(_flat(x) for x in v)
    return str(v or "")


def _clean(v) -> str:
    text = re.sub(r"\s+", " ", _flat(v)).replace("<", "").replace(">", "").strip()
    return text[:_FIELD_CHARS]


def profile_from_memo(memo: dict) -> dict:
    """Search profile from the memo itself (company, product, the segments it already names)."""
    sec = memo.get("sections") or {}
    segments: list[str] = []
    for r in (sec.get("market") or {}).get("rows") or []:
        if isinstance(r, dict) and r.get("segment"):
            segments.append(_clean(r["segment"]))
    for g in (sec.get("competitors") or {}).get("groups") or []:
        if isinstance(g, dict) and g.get("segment"):
            segments.append(_clean(g["segment"]))
    segments = [s for s in dict.fromkeys(segments) if s and "[" not in s][:_MAX_SEGMENTS]
    what = sec.get("what") or {}
    product = sec.get("product") or {}
    return {
        "name": _clean(memo.get("name")),
        "one_liner": _clean(memo.get("headline") or memo.get("in_short") or what.get("in_short")),
        "product": _clean([product.get("kind"), product.get("note")]),
        "sector": _clean(((memo.get("snapshot") or {}).get("sector") or {}).get("value")),
        "segments": segments,
    }


def _context(memo: dict) -> str:
    """The memo the writer sees: everything except the internal recommendation."""
    return json.dumps({k: v for k, v in memo.items() if k != "recommendation"},
                      ensure_ascii=False, separators=(",", ":"))


def parse_market(text: str) -> tuple[dict, str, str, list[str]]:
    """Model text -> (market section, takeaway, source, salvage notes)."""
    try:
        data = json_repair.loads(text)
    except Exception as e:
        raise MemoValidationError([f"market response is not valid JSON: {type(e).__name__}"]) from e
    if not isinstance(data, dict):
        raise MemoValidationError(["market response is not a JSON object"])
    raw = data.get("market")
    if not isinstance(raw, dict):  # the section itself, without the wrapper
        raw = data if "rows" in data else None
    if not isinstance(raw, dict) or not isinstance(raw.get("rows"), list) or not raw["rows"]:
        raise MemoValidationError(["market: no rows"])
    s = _Salvager()
    fixed = s.market(dict(raw), "sections.market")
    try:
        market = Market.model_validate(fixed).model_dump(mode="json", exclude_none=True)
    except ValidationError as e:
        raise MemoValidationError([f"market: {x['msg']}" for x in e.errors()]) from e
    return market, _flat(data.get("takeaway")).strip(), _flat(data.get("source")).strip(), s.notes


def refresh(memo: dict, application_block: str, cfg: GenConfig, budget: Budget, runs: RunLog,
            deadline: Deadline | None = None) -> MarketResult:
    """A copy of ``memo`` with a re-researched market section. Raises on failure (the caller
    keeps the memo it has)."""
    found = research.run(
        {}, cfg, budget, runs, deadline,
        messages=render_market_research_messages(profile_from_memo(memo), MARKET_SEARCHES),
        max_searches=MARKET_SEARCHES, step="market_research",
    )
    messages = render_market_messages(_context(memo), application_block, found.json_text or "{}")
    model = cfg.writer_model
    try:
        result = _call("market_write", messages, cfg, budget, runs, deadline, "medium",
                       MARKET_MAX_TOKENS, model)
    except ModelRefusal:
        if not cfg.fallback_model:
            raise
        model = cfg.fallback_model
        result = _call("market_write_fallback", messages, cfg, budget, runs, deadline, "medium",
                       MARKET_MAX_TOKENS, model)
    market, takeaway, source, notes = parse_market(result.text)
    out = json.loads(json.dumps(memo))  # deep copy
    out["sections"]["market"] = market
    if takeaway:
        out.setdefault("takeaways", {})["market"] = takeaway
    if source:
        out.setdefault("sources", {})["market"] = source
    out, _ = retag(out)
    return MarketResult(out, [s for s in found.sources], notes, model)


def new_budget() -> Budget:
    return Budget(MARKET_MAX_COST_USD)
