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

from pydantic import BaseModel, ConfigDict, Field

# ─── Upper bounds — sized to be generous but kill pathological input ──
# String caps match the UI's textarea/ input limits + slack. Integers and
# list lengths are sized for the worst legitimate applicant we can imagine.
# If you raise a cap, also raise the matching HTML `maxLength` in the UI.

_MAX_NAME = 200
_MAX_PHONE = 30
_MAX_EMAIL = 320         # RFC 5321 practical ceiling
_MAX_ORG = 300
_MAX_URL = 1000          # arbitrary long-URL ceiling; format checked at submit
_MAX_SHORT_TEXT = 500
_MAX_LONG_TEXT = 5000
_MAX_XLONG_TEXT = 10000  # execution_budget and other essay-style fields
_MAX_SECTION = 50
_MAX_TEAMMATES = 10
_MAX_FILES = 20

# ─── Enum values — mirror CHECK constraints in the migration ────────

HasTeamValue = Literal[
    "Yes — I have co-founders",
    "No — going solo for now",
]

IncubatorAssociationValue = Literal["Yes", "No"]

# Degree + hearAbout used to be strict Literals; post-launch feedback asked
# for an "Other — please specify" text capture on both. The frontend now
# encodes those as `"Other: <free text>"` (or `"Self-taught / Other: …"`),
# so the backend accepts any string. A matching migration (001_initial_schema.sql)
# drops the CHECK constraints on these two columns. Pre-defined options
# kept as hints below for reference / future UI use.
DegreeValue = str
_DEGREE_OPTIONS = ("Bachelor's Degree", "Master's Degree", "PhD", "Self-taught / Other")

HearAboutValue = str
_HEAR_ABOUT_OPTIONS = (
    "Referral from friend/colleague",
    "IISc faculty or staff",
    "Social media (LinkedIn, Twitter, etc.)",
    "Event or conference",
    "Search engine",
    "Partner organization",
    "News article or press",
    "Other",
)

ProblemDefinedValue = Literal[
    # Current wizard options
    "Yes",
    "No",
    # Legacy values preserved so already-submitted rows still validate
    # when read back by GET /applications/me. Without this, Pydantic
    # rejects the row at deserialisation and the wizard fails to load.
    "Yes, clearly defined",
    "Partially defined",
    "Still exploring the problem space",
]

SolutionStageValue = Literal[
    # Current wizard options
    "Still exploring",
    "Literature / research stage",
    "Simulations completed",
    "Lab demos / proof of concept",
    "Prototype built",
    "Pilot-ready product",
    "Deployed in real setting with real users",
    # Legacy spellings preserved for older drafts (mirrors the DB
    # constraint relaxation in 009_fix_legacy_check_constraints.sql).
    "Still exploring problem area",
    "Lab demos / proof-of-concept",
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
    current_section: str | None = Field(default=None, max_length=_MAX_SECTION)

    # ── Section 02 · Basic Information ──
    basic_has_team: HasTeamValue | None = None
    basic_teammates: list[dict[str, Any]] | None = Field(default=None, max_length=_MAX_TEAMMATES)
    basic_full_name: str | None = Field(default=None, max_length=_MAX_NAME)
    basic_phone: str | None = Field(default=None, max_length=_MAX_PHONE)
    basic_email: str | None = Field(default=None, max_length=_MAX_EMAIL)
    basic_org: str | None = Field(default=None, max_length=_MAX_ORG)
    basic_degree: DegreeValue | None = None
    basic_incubators: str | None = Field(default=None, max_length=_MAX_LONG_TEXT)
    # Bucket 3 (manager spec): two-step incubator capture replaces the single
    # `basic_incubators` field. Old column kept so already-submitted apps stay
    # readable; new wizard writes to the new pair.
    basic_incubator_association: IncubatorAssociationValue | None = None
    basic_incubator_details: str | None = Field(default=None, max_length=_MAX_LONG_TEXT)
    basic_hear_about: HearAboutValue | None = None

    # ── Section 03 · Problem & Importance ──
    problem_defined: ProblemDefinedValue | None = None
    problem_describe: str | None = Field(default=None, max_length=_MAX_LONG_TEXT)
    problem_importance: str | None = Field(default=None, max_length=_MAX_LONG_TEXT)

    # ── Section 04 · Your Solution ──
    solution_stage: SolutionStageValue | None = None
    solution_describe: str | None = Field(default=None, max_length=_MAX_LONG_TEXT)
    solution_core_tech: str | None = Field(default=None, max_length=_MAX_LONG_TEXT)
    solution_ten_x: str | None = Field(default=None, max_length=_MAX_LONG_TEXT)
    solution_hurdles: str | None = Field(default=None, max_length=_MAX_LONG_TEXT)
    solution_moat: str | None = Field(default=None, max_length=_MAX_LONG_TEXT)
    solution_national_scale: str | None = Field(default=None, max_length=_MAX_LONG_TEXT)
    solution_customers: str | None = Field(default=None, max_length=_MAX_LONG_TEXT)
    # Bucket 3: contrarian-insight question, optional.
    solution_contrarian_insight: str | None = Field(default=None, max_length=_MAX_LONG_TEXT)

    # ── Section 05 · Execution Plan ──
    execution_will_break: str | None = Field(default=None, max_length=_MAX_LONG_TEXT)
    execution_milestone: str | None = Field(default=None, max_length=_MAX_LONG_TEXT)
    execution_budget: str | None = Field(default=None, max_length=_MAX_XLONG_TEXT)
    execution_failure: str | None = Field(default=None, max_length=_MAX_LONG_TEXT)
    # Bucket 3: infrastructure replaces budget in the new spec; hwsw_integration
    # is a new optional question. milestone_files is the JSONB array of
    # {file_uuid, path, name, size, mime, uploaded_at} entries written by
    # /applications/me/milestone-files. The 3-file cap is enforced at DB level
    # (CHECK constraint in 004_milestone_files_storage.sql).
    execution_infrastructure: str | None = Field(default=None, max_length=_MAX_LONG_TEXT)
    execution_hwsw_integration: str | None = Field(default=None, max_length=_MAX_LONG_TEXT)
    execution_milestone_files: list[dict[str, Any]] | None = Field(default=None, max_length=3)

    # ── Section 06 · Evidence ──
    evidence_files: list[dict[str, Any]] | None = Field(default=None, max_length=_MAX_FILES)
    evidence_video_url: str | None = Field(default=None, max_length=_MAX_URL)
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
    completion_pct: int = Field(default=0, ge=0, le=100)
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
