"""Env-driven configuration for the VIP memo generator."""
from __future__ import annotations

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
    writer_max_tokens: int = 32000


def _num(name: str, default: str, cast):
    raw = os.getenv(name, default)
    try:
        return cast(raw)
    except ValueError as e:
        raise ValueError(f"{name} must be a valid {cast.__name__}, got {raw!r}") from e


def load_config() -> GenConfig:
    env = os.getenv
    return GenConfig(
        writer_model=env("VIP_MEMO_WRITER_MODEL", "anthropic/claude-opus-5.5"),
        research_model=env("VIP_MEMO_RESEARCH_MODEL", "anthropic/claude-sonnet-5.5"),
        extract_model=env("VIP_MEMO_EXTRACT_MODEL", "anthropic/claude-haiku-5.5"),
        max_cost_usd=_num("VIP_MEMO_MAX_COST_USD", "1.00", float),
        max_searches=_num("VIP_MEMO_MAX_SEARCHES", "8", int),
    )
