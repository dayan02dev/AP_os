"""Pydantic models for the /applications router (Phase 4).

Column names mirror backend/migrations/001_initial_schema.sql exactly. Every
form field is section-prefixed (basic_*, problem_*, solution_*, execution_*,
evidence_*, declaration_*).

Two user-facing models:

  ApplicationUpdate   Partial-update body for PATCH /applications/me.
                      All fields Optional, unknown fields rejected (`extra=forbid`).
                      Enum columns use Literal for pre-submit type checks; enum
                      violations bubble as 422 before we hit the DB.

  ApplicationRead     Full row returned by GET /applications/me (and friends).
                      Includes system columns (id, user_id, status, timestamps).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

# ─── Enum values — mirror CHECK constraints in the migration ────────

HasTeamValue = Literal[
    "Yes — I have co-founders",
    "No — going solo for now",
]

DegreeValue = Literal[
    "Bachelor's Degree",
    "Master's Degree",
    "PhD",
    "Self-taught / Other",
]

HearAboutValue = Literal[
    "Referral from friend/colleague",
    "IISc faculty or staff",
    "Social media (LinkedIn, Twitter, etc.)",
    "Event or conference",
    "Search engine",
    "Partner organization",
    "News article or press",
    "Other",
]

ProblemDefinedValue = Literal[
    "Yes, clearly defined",
    "Partially defined",
    "Still exploring the problem space",
]

SolutionStageValue = Literal[
    "Still exploring problem area",
    "Literature / research stage",
    "Simulations completed",
    "Lab demos / proof-of-concept",
    "Prototype built",
    "Pilot-ready product",
    "Deployed in real setting with real users",
]

ApplicationStatusValue = Literal[
    "draft", "submitted", "under_review", "shortlisted",
    "rejected", "accepted", "withdrawn",
]


# ─── Update model (PATCH body) ───────────────────────────────────────

class ApplicationUpdate(BaseModel):
    """Partial update. All fields optional. Unknown fields rejected."""

    model_config = ConfigDict(extra="forbid")

    # Progress tracking — clients send current_section as they navigate.
    current_section: str | None = None

    # ── Section 02 · Basic Information ──
    basic_has_team: HasTeamValue | None = None
    basic_teammates: list[dict[str, Any]] | None = None
    basic_full_name: str | None = None
    basic_phone: str | None = None
    basic_email: str | None = None
    basic_org: str | None = None
    basic_degree: DegreeValue | None = None
    basic_incubators: str | None = None
    basic_hear_about: HearAboutValue | None = None

    # ── Section 03 · Problem & Importance ──
    problem_defined: ProblemDefinedValue | None = None
    problem_describe: str | None = None
    problem_importance: str | None = None

    # ── Section 04 · Your Solution ──
    solution_stage: SolutionStageValue | None = None
    solution_describe: str | None = None
    solution_core_tech: str | None = None
    solution_ten_x: str | None = None
    solution_hurdles: str | None = None
    solution_moat: str | None = None
    solution_national_scale: str | None = None
    solution_customers: str | None = None

    # ── Section 05 · Execution Plan ──
    execution_will_break: str | None = None
    execution_milestone: str | None = None
    execution_budget: str | None = None
    execution_failure: str | None = None

    # ── Section 06 · Evidence ──
    evidence_files: list[dict[str, Any]] | None = None
    evidence_video_url: str | None = None
    evidence_deck: dict[str, Any] | None = None

    # ── Section 07 · Declaration ──
    declaration_truthful: bool | None = None
    declaration_ref_checks: bool | None = None
    declaration_terms: bool | None = None
    declaration_newsletter: bool | None = None


# ─── Read model (GET responses) ──────────────────────────────────────

class ApplicationRead(ApplicationUpdate):
    """Full row as returned from Supabase. Permissive: unknown columns ignored."""

    model_config = ConfigDict(extra="ignore")

    id: str
    user_id: str
    status: ApplicationStatusValue
    completion_pct: int = 0
    submitted_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


# ─── Submission / completion helpers ─────────────────────────────────

class SubmissionResult(BaseModel):
    ok: bool
    application_id: str
    submitted_at: datetime


class SubmissionErrors(BaseModel):
    """422 body when a submission fails strict validation."""
    missing_fields: list[str]
    invalid_fields: list[dict[str, str]]


class CompletionStatus(BaseModel):
    completion_pct: int
    missing_required_fields: list[str]
    current_section: str | None = None
