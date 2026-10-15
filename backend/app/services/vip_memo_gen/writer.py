"""Writer step: one JSON-mode call; salvage; at most one cheap, document-free repair call.

Every output goes json_repair -> ``schema.salvage`` -> ``parse_memo``. Whatever still fails
carries the raw model text (``exc.raw``, plus ``exc.raw_write`` after a repair) so the
pipeline can store it and ``scripts/revalidate_vip_memo.py`` can recover it at no cost.
"""
from __future__ import annotations

import logging
import math
from datetime import UTC, datetime

import json_repair

from . import openrouter
from .budget import (
    Budget,
    BudgetExceeded,
    Deadline,
    DeadlineExceeded,
    RunLog,
    estimate_cost,
    paid_call,
)
from .config import GenConfig
from .openrouter import PRICES, LlmResult, OpenRouterError
from .prompts import REPAIR_PROMPT, REPAIR_SYSTEM
from .schema import MemoValidationError, memo_to_dict, parse_memo, salvage

log = logging.getLogger(__name__)

_MAX_LOGGED = 20
_MAX_REPORTED = 10
_MSG_CHARS = 200
TRUNCATED = "output truncated at max_tokens"
PREPARED_BY = "ARTPARK VIP memo generator"
MIN_REPAIR_TOKENS = 16000  # a full memo at low reasoning needs ~15k output tokens


def _stamp(data: dict) -> None:
    data["version"] = 2
    data["prepared_by"] = PREPARED_BY
    data["generated_at"] = datetime.now(UTC).isoformat()


def _call(step: str, messages: list[dict], cfg: GenConfig, budget: Budget, runs: RunLog,
          deadline: Deadline | None, effort: str, max_tokens: int | None = None) -> LlmResult:
    max_tokens = max_tokens or cfg.writer_max_tokens
    chars = sum(len(m["content"]) for m in messages)
    estimate = estimate_cost(cfg.writer_model, chars, max_tokens)
    return paid_call(step, cfg.writer_model, estimate, budget, runs, deadline, lambda timeout: openrouter.chat(
        cfg.writer_model, messages,
        max_tokens=max_tokens, reasoning_effort=effort,
        response_format={"type": "json_object"},  # never json_schema: Anthropic caps optional/union params
        timeout=timeout,
    ))


def _load(text: str) -> dict:
    try:
        data = json_repair.loads(text)
    except Exception as e:
        raise MemoValidationError([f"response is not valid JSON: {type(e).__name__}"]) from e
    if isinstance(data, list):  # several top-level values: take the first object
        data = next((x for x in data if isinstance(x, dict)), data)
    if not isinstance(data, dict):
        raise MemoValidationError(["response is not a JSON object"])
    return data


def validate(text: str) -> tuple[dict, list[str]]:
    """Raw model text -> (normalised memo, salvage notes). No model call."""
    data = _load(text)
    _stamp(data)  # model values for these are never trusted (nor required)
    data, notes = salvage(data)
    memo = memo_to_dict(parse_memo(data))
    _stamp(memo)
    return memo, notes


def _failure(step: str, result: LlmResult, err: MemoValidationError, cfg: GenConfig) -> MemoValidationError:
    """Log field paths and messages only (never memo content); return the error to raise."""
    msgs = [m[:_MSG_CHARS] for m in err.messages[:_MAX_LOGGED]]
    truncated = result.finish_reason == "length"
    log.warning("vip memo %s failed validation: model=%s finish_reason=%s output_tokens=%s "
                "max_tokens=%s errors=%d: %s", step, result.model, result.finish_reason,
                result.usage.output_tokens, cfg.writer_max_tokens, len(err.messages), " | ".join(msgs))
    if truncated:
        out = MemoValidationError([TRUNCATED])
    else:
        out = MemoValidationError(
            ["validation: " + "; ".join(m[:_MSG_CHARS] for m in err.messages[:_MAX_REPORTED])])
    out.raw, out.raw_write = result.text, None
    return out


def repair_max_tokens(messages: list[dict], cfg: GenConfig, budget: Budget) -> int:
    """Largest output allowance whose worst-case cost still fits the remaining budget."""
    pin, pout = PRICES[cfg.writer_model]
    input_cost = sum(len(m["content"]) for m in messages) / 4 * pin / 1_000_000
    fits = math.floor((budget.remaining - input_cost) * 1_000_000 / pout) if pout else cfg.writer_max_tokens
    return max(0, min(cfg.writer_max_tokens, fits))


def _attach(e: BaseException, raw: str, messages: list[str]) -> None:
    e.raw, e.raw_write = raw, None  # type: ignore[attr-defined]
    if not getattr(e, "messages", None):
        e.messages = messages  # type: ignore[attr-defined]


def write(messages: list[dict], cfg: GenConfig, budget: Budget, runs: RunLog,
          deadline: Deadline | None = None, notes: list[str] | None = None) -> dict:
    """``notes`` (out): salvage notes of the accepted memo, paths only."""
    notes = notes if notes is not None else []
    result = _call("write", messages, cfg, budget, runs, deadline, "medium")
    try:
        memo, found = validate(result.text)
    except MemoValidationError as err:
        failure = _failure("write", result, err, cfg)
        errors = err.messages
    else:
        notes += ([TRUNCATED] if result.finish_reason == "length" else []) + found
        return memo
    if result.finish_reason == "length":
        raise failure  # a repair would be cut off the same way
    repair = [
        {"role": "system", "content": REPAIR_SYSTEM},
        {"role": "user", "content": REPAIR_PROMPT.format(errors="\n".join(errors), raw=result.text)},
    ]
    write_text = result.text
    repair_max = repair_max_tokens(repair, cfg, budget)
    try:
        if repair_max < MIN_REPAIR_TOKENS:  # a cut-off repair would only waste money
            raise BudgetExceeded(f"repair skipped: only {repair_max} output tokens fit the remaining "
                                 f"${budget.remaining:.4f} (needs {MIN_REPAIR_TOKENS})")
        result = _call("repair", repair, cfg, budget, runs, deadline, "low", repair_max)
    except (BudgetExceeded, DeadlineExceeded, OpenRouterError) as e:
        _attach(e, write_text, failure.messages)
        raise
    try:
        memo, found = validate(result.text)
    except MemoValidationError as err:
        failure = _failure("repair", result, err, cfg)
        failure.raw_write = write_text
        raise failure from err
    notes += ["repaired by a second call"] + found
    return memo
