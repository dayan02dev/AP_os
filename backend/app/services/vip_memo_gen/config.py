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


def load_config() -> GenConfig:
    env = os.getenv
    return GenConfig(
        writer_model=env("VIP_MEMO_WRITER_MODEL", "anthropic/claude-opus-5.5"),
        research_model=env("VIP_MEMO_RESEARCH_MODEL", "anthropic/claude-sonnet-5.5"),
        extract_model=env("VIP_MEMO_EXTRACT_MODEL", "anthropic/claude-haiku-5.5"),
        max_cost_usd=float(env("VIP_MEMO_MAX_COST_USD", "1.00")),
        max_searches=int(env("VIP_MEMO_MAX_SEARCHES", "8")),
    )
