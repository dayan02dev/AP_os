from __future__ import annotations

from pydantic import BaseModel, Field


class LeverAnswersIn(BaseModel):
    """One lever's three answers plus the criteria the founder ticked.

    Option ids are validated against the catalog in the router rather than here
    — the valid set depends on (lever, question), which the request model does
    not know.
    """
    q1_option: str | None = Field(default=None, max_length=2)
    q2_option: str | None = Field(default=None, max_length=2)
    q3_option: str | None = Field(default=None, max_length=2)
    criteria_checked: list[str] = Field(default_factory=list, max_length=32)
