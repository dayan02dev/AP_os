"""Hard per-memo cost ceiling."""
from __future__ import annotations

from .openrouter import PRICES


class BudgetExceeded(RuntimeError):
    pass


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
