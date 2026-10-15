"""Writer step: one JSON-mode call, plus at most one repair call."""
from __future__ import annotations

import logging
from datetime import UTC, datetime

import json_repair

from . import openrouter
from .budget import Budget, Deadline, RunLog, estimate_cost, paid_call
from .config import GenConfig
from .openrouter import LlmResult
from .prompts import REPAIR_PROMPT
from .schema import MemoValidationError, memo_to_dict, parse_memo

log = logging.getLogger(__name__)

_MAX_LOGGED = 20
_MAX_REPORTED = 10
_MSG_CHARS = 200
TRUNCATED = "output truncated at max_tokens"
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
        response_format={"type": "json_object"},
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


def _failure(step: str, result: LlmResult, err: MemoValidationError, cfg: GenConfig) -> MemoValidationError:
    """Log field paths and messages only (never memo content); return the error to raise."""
    msgs = [m[:_MSG_CHARS] for m in err.messages[:_MAX_LOGGED]]
    truncated = result.finish_reason == "length"
    log.warning("vip memo %s failed validation: model=%s finish_reason=%s output_tokens=%s "
                "max_tokens=%s errors=%d: %s", step, result.model, result.finish_reason,
                result.usage.output_tokens, cfg.writer_max_tokens, len(err.messages), " | ".join(msgs))
    if truncated:
        return MemoValidationError([TRUNCATED])
    return MemoValidationError(["validation: " + "; ".join(m[:_MSG_CHARS] for m in err.messages[:_MAX_REPORTED])])


def write(messages: list[dict], cfg: GenConfig, budget: Budget, runs: RunLog,
          deadline: Deadline | None = None) -> dict:
    result = _call("write", messages, cfg, budget, runs, deadline)
    try:
        return _validate(result.text)
    except MemoValidationError as err:
        failure = _failure("write", result, err, cfg)
        errors = "\n".join(err.messages)
    if result.finish_reason == "length":
        raise failure  # a repair would be cut off the same way
    repair = messages + [
        {"role": "assistant", "content": result.text},
        {"role": "user", "content": REPAIR_PROMPT.format(errors=errors)},
    ]
    result = _call("repair", repair, cfg, budget, runs, deadline)
    try:
        return _validate(result.text)
    except MemoValidationError as err:
        raise _failure("repair", result, err, cfg) from err
