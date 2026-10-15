"""Writer step: one structured-output call, plus at most one repair call."""
from __future__ import annotations

import time
from collections.abc import Callable
from datetime import UTC, datetime

import json_repair

from . import openrouter
from .budget import Budget, estimate_cost
from .config import GenConfig
from .openrouter import LlmResult
from .prompts import REPAIR_PROMPT
from .schema import MemoValidationError, memo_to_dict, parse_memo, writer_json_schema

PREPARED_BY = "ARTPARK VIP memo generator"


def _stamp(data: dict) -> None:
    data["version"] = 2
    data["prepared_by"] = PREPARED_BY
    data["generated_at"] = datetime.now(UTC).isoformat()


def _call(step: str, messages: list[dict], cfg: GenConfig, budget: Budget,
          on_usage: Callable[[str, LlmResult, int], None]) -> LlmResult:
    chars = sum(len(m["content"]) for m in messages)
    budget.check(estimate_cost(cfg.writer_model, chars, cfg.writer_max_tokens))
    t0 = time.monotonic()
    result = openrouter.chat(
        cfg.writer_model, messages,
        max_tokens=cfg.writer_max_tokens, reasoning_effort="medium",
        response_format={"type": "json_schema", "json_schema": {
            "name": "vip_memo_v2", "strict": False, "schema": writer_json_schema()}},
    )
    budget.add(result.usage.cost_usd)
    on_usage(step, result, int((time.monotonic() - t0) * 1000))
    return result


def _validate(text: str) -> dict:
    try:
        data = json_repair.loads(text)
    except Exception as e:
        raise MemoValidationError([f"response is not valid JSON: {e}"]) from e
    if not isinstance(data, dict):
        raise MemoValidationError(["response is not a JSON object"])
    _stamp(data)  # model values for these are never trusted (nor required)
    memo = memo_to_dict(parse_memo(data))
    _stamp(memo)
    return memo


def write(messages: list[dict], cfg: GenConfig, budget: Budget,
          on_usage: Callable[[str, LlmResult, int], None]) -> dict:
    result = _call("write", messages, cfg, budget, on_usage)
    try:
        return _validate(result.text)
    except MemoValidationError as err:
        errors = "\n".join(err.messages)
    repair = messages + [
        {"role": "assistant", "content": result.text},
        {"role": "user", "content": REPAIR_PROMPT.format(errors=errors)},
    ]
    result = _call("repair", repair, cfg, budget, on_usage)
    return _validate(result.text)
