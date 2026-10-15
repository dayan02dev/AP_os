"""Writer step: one structured-output call, plus at most one repair call."""
from __future__ import annotations

from datetime import UTC, datetime

import json_repair

from . import openrouter
from .budget import Budget, Deadline, RunLog, estimate_cost, paid_call
from .config import GenConfig
from .openrouter import LlmResult
from .prompts import REPAIR_PROMPT
from .schema import MemoValidationError, memo_to_dict, parse_memo, writer_json_schema

PREPARED_BY = "ARTPARK VIP memo generator"


def _stamp(data: dict) -> None:
    data["version"] = 2
    data["prepared_by"] = PREPARED_BY
    data["generated_at"] = datetime.now(UTC).isoformat()


def _call(step: str, messages: list[dict], cfg: GenConfig, budget: Budget, runs: RunLog,
          deadline: Deadline | None) -> LlmResult:
    chars = sum(len(m["content"]) for m in messages)
    estimate = estimate_cost(cfg.writer_model, chars, cfg.writer_max_tokens)
    return paid_call(step, cfg.writer_model, estimate, budget, runs, deadline, lambda timeout: openrouter.chat(
        cfg.writer_model, messages,
        max_tokens=cfg.writer_max_tokens, reasoning_effort="medium",
        response_format={"type": "json_schema", "json_schema": {
            "name": "vip_memo_v2", "strict": False, "schema": writer_json_schema()}},
        timeout=timeout,
    ))


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


def write(messages: list[dict], cfg: GenConfig, budget: Budget, runs: RunLog,
          deadline: Deadline | None = None) -> dict:
    result = _call("write", messages, cfg, budget, runs, deadline)
    try:
        return _validate(result.text)
    except MemoValidationError as err:
        errors = "\n".join(err.messages)
    repair = messages + [
        {"role": "assistant", "content": result.text},
        {"role": "user", "content": REPAIR_PROMPT.format(errors=errors)},
    ]
    result = _call("repair", repair, cfg, budget, runs, deadline)
    return _validate(result.text)
