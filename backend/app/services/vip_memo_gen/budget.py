"""Hard per-memo cost ceiling, Lambda deadline guard, and the metered paid-call wrapper."""
from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any, Protocol

from .openrouter import PRICES, LlmResult, OpenRouterError, Usage

MAX_CALL_TIMEOUT_S = 600.0
MIN_CALL_REMAINING_S = 120.0  # below this, a paid call is not started
_TIMEOUT_MARGIN_S = 45.0      # time left for bookkeeping after the call returns
_ERROR_CHARS = 500


class BudgetExceeded(RuntimeError):
    pass


class DeadlineExceeded(RuntimeError):
    """Not enough Lambda time left for a paid call; the pipeline treats it as retryable."""


class Budget:
    def __init__(self, ceiling_usd: float, spent_usd: float = 0.0):
        self.ceiling_usd = ceiling_usd
        self.spent_usd = spent_usd

    @property
    def remaining(self) -> float:
        return self.ceiling_usd - self.spent_usd

    def check(self, estimate_usd: float) -> None:
        if self.spent_usd + estimate_usd > self.ceiling_usd:
            raise BudgetExceeded(
                f"estimate ${estimate_usd:.4f} exceeds remaining ${self.remaining:.4f}")

    def add(self, cost_usd: float) -> None:
        self.spent_usd += cost_usd


def estimate_cost(model: str, input_chars: int, max_output_tokens: int) -> float:
    """Worst case: chars/4 input tokens plus the full output allowance."""
    pin, pout = PRICES[model]
    return (input_chars / 4 * pin + max_output_tokens * pout) / 1_000_000


class Deadline:
    """End of the current Lambda invocation, from ``context.get_remaining_time_in_millis()``."""

    def __init__(self, remaining_ms: int | None):
        self._end = None if remaining_ms is None else time.monotonic() + remaining_ms / 1000

    def call_timeout(self) -> float:
        """HTTP timeout for the next paid call; raises DeadlineExceeded if too little time is left."""
        if self._end is None:
            return MAX_CALL_TIMEOUT_S
        remaining = self._end - time.monotonic()
        if remaining < MIN_CALL_REMAINING_S:
            raise DeadlineExceeded(f"{remaining:.0f}s left in the invocation; paid call not started")
        return min(MAX_CALL_TIMEOUT_S, remaining - _TIMEOUT_MARGIN_S)


class RunLog(Protocol):
    def start(self, step: str, model: str, estimate_usd: float) -> Any: ...

    def finish(self, run_id: Any, model: str, usage: Usage, duration_ms: int,
               ok: bool, error: str | None) -> None: ...


def paid_call(step: str, model: str, estimate_usd: float, budget: Budget, runs: RunLog,
              deadline: Deadline | None, call: Callable[[float], LlmResult]) -> LlmResult:
    """Check the budget, then run ``call(timeout)`` under a provisional run row.

    The row is written at ``estimate_usd`` before the call and settled to the actual
    cost after it. If the invocation dies mid-call the row stays at the estimate, so
    a redelivery counts the interrupted call against the ceiling.
    """
    budget.check(estimate_usd)
    timeout = deadline.call_timeout() if deadline else MAX_CALL_TIMEOUT_S
    run_id = runs.start(step, model, estimate_usd)
    t0 = time.monotonic()
    try:
        result = call(timeout)
    except OpenRouterError as e:
        cost = estimate_usd if e.maybe_billed else 0.0
        budget.add(cost)
        runs.finish(run_id, model, Usage(cost_usd=cost), int((time.monotonic() - t0) * 1000),
                    False, str(e)[:_ERROR_CHARS])
        raise
    except BaseException:
        budget.add(estimate_usd)  # the row stays pending at the estimate
        raise
    budget.add(result.usage.cost_usd)
    runs.finish(run_id, result.model, result.usage, int((time.monotonic() - t0) * 1000), True, None)
    return result
