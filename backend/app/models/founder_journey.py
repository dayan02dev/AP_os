"""Request models for the residency journey (/founder/experiments,
/founder/tasks, /founder/review). Mirrors the mockup's onboarding wizard —
see TIR Onboarding.dc.html state.experiments / state.tasks / submit()/renderVals().

Pass/kill-criteria locking (once an experiment leaves 'not-started') is a
front-end concern (disabled inputs) per the design's `critStyle` — the
backend accepts edits to any field on any PATCH, matching the plan's
"FE lock + BE allows" decision.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Track = Literal["technical", "commercial"]
Risk = Literal["high", "medium", "low"]
ExperimentStatus = Literal["not-started", "running", "validated", "invalidated"]
TestType = Literal[
    "literature", "simulation", "expert", "customer", "retro", "breadboard", "prototype",
]
TaskStatus = Literal["todo", "doing", "done"]
ReviewStatus = Literal["draft", "pending", "approved"]

_TEXT = 300
_LONG = 2000


class ExperimentIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    track: Track
    gate: int = Field(default=1, ge=1, le=3)
    risk: Risk = "medium"
    status: ExperimentStatus = "not-started"
    test_type: TestType = "literature"
    start_week: int = Field(default=1, ge=1, le=24)
    weeks: int = Field(default=4, ge=1, le=24)
    assumption: str = Field(default="", max_length=_LONG)
    hypothesis: str = Field(default="", max_length=_LONG)
    test: str = Field(default="", max_length=_LONG)
    pass_criteria: str = Field(default="", max_length=_LONG)
    kill_criteria: str = Field(default="", max_length=_LONG)
    sort_order: int = 0


class ExperimentPatch(BaseModel):
    model_config = ConfigDict(extra="ignore")
    track: Track | None = None
    gate: int | None = Field(default=None, ge=1, le=3)
    risk: Risk | None = None
    status: ExperimentStatus | None = None
    test_type: TestType | None = None
    start_week: int | None = Field(default=None, ge=1, le=24)
    weeks: int | None = Field(default=None, ge=1, le=24)
    assumption: str | None = Field(default=None, max_length=_LONG)
    hypothesis: str | None = Field(default=None, max_length=_LONG)
    test: str | None = Field(default=None, max_length=_LONG)
    pass_criteria: str | None = Field(default=None, max_length=_LONG)
    kill_criteria: str | None = Field(default=None, max_length=_LONG)
    sort_order: int | None = None


class TaskIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    task: str = Field(default="", max_length=_TEXT)
    exp_id: str | None = None
    owner: str = Field(default="", max_length=_TEXT)
    effort: int = Field(default=1, ge=1, le=12)
    status: TaskStatus = "todo"
    sort_order: int = 0


class TaskPatch(BaseModel):
    model_config = ConfigDict(extra="ignore")
    task: str | None = Field(default=None, max_length=_TEXT)
    exp_id: str | None = None
    owner: str | None = Field(default=None, max_length=_TEXT)
    effort: int | None = Field(default=None, ge=1, le=12)
    status: TaskStatus | None = None
    sort_order: int | None = None


class ReviewSubmitIn(BaseModel):
    """Empty body — POST /founder/review/submit takes no fields."""
    model_config = ConfigDict(extra="ignore")
