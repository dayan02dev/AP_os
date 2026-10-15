"""Env-driven configuration for the VIP memo generator."""
from __future__ import annotations

import math
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class GenConfig:
    writer_model: str
    research_model: str
    extract_model: str
    max_cost_usd: float
    max_searches: int
    file_chars: int = 60000
    writer_max_tokens: int = 20000  # leaves room for one repair call under $1


def _num(name: str, default: str, cast):
    raw = os.getenv(name, default)
    try:
        return cast(raw)
    except ValueError as e:
        raise ValueError(f"{name} must be a valid {cast.__name__}, got {raw!r}") from e


def load_config() -> GenConfig:
    env = os.getenv
    max_cost = _num("VIP_MEMO_MAX_COST_USD", "1.00", float)
    if not math.isfinite(max_cost) or max_cost <= 0:
        raise ValueError(f"VIP_MEMO_MAX_COST_USD must be a finite number > 0, got {max_cost!r}")
    max_searches = _num("VIP_MEMO_MAX_SEARCHES", "8", int)
    if max_searches < 0:
        raise ValueError(f"VIP_MEMO_MAX_SEARCHES must be >= 0, got {max_searches!r}")
    return GenConfig(
        writer_model=env("VIP_MEMO_WRITER_MODEL", "anthropic/claude-opus-5.5"),
        research_model=env("VIP_MEMO_RESEARCH_MODEL", "anthropic/claude-sonnet-5.5"),
        extract_model=env("VIP_MEMO_EXTRACT_MODEL", "anthropic/claude-haiku-5.5"),
        max_cost_usd=max_cost,
        max_searches=max_searches,
    )
