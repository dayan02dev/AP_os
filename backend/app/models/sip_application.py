"""Pydantic models for the /sip-applications router (SIP track).

Mirrors application.py but for the SIP track:
  - Drops TIR-only fields (basic_has_team, basic_teammates, problem_defined,
    solution_stage, evidence_files, evidence_video_url, evidence_deck,
    legacy solution_* columns, execution_will_break/budget).
  - Adds SIP-specific fields (sip_incorporated, sip_trl, sip_founders,
    sip_traction, sip_traction_details, sip_traction_files, sip_pitch_deck,
    sip_cap_table_file, sip_demo_video_url, sip_patents_files).
  - Column names match backend/migrations/011_sip_track.sql exactly.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# ─── Upper bounds ────────────────────────────────────────────────────
_MAX_NAME = 200
_MAX_PHONE = 30
_MAX_EMAIL = 320
_MAX_ORG = 300
_MAX_URL = 1000
_MAX_LONG_TEXT = 5000
_MAX_SECTION = 50
_MAX_FOUNDERS = 12
_MAX_FILES = 5

# ─── Enum values — mirror CHECK constraints in 011_sip_track.sql ────

DegreeValue = str
HearAboutValue = str
IncubatorAssociationValue = Literal["Yes", "No"]

SipIncorporatedValue = Literal[
    "Yes — Pvt Ltd, registered in India",
    "Not yet — we're still pre-incorporation",
]

SipTrlValue = Literal[
    "TRL 3 or earlier — research stage",
    "TRL 4 — lab-validated prototype",
    "TRL 5 — pilot-tested in a relevant environment",
    "TRL 6+ — demonstrated in operational setting",
]

SipTractionValue = Literal[
    "Pre-revenue — building toward our first pilot",
    "Active pilots (paid or unpaid) with design partners",
    "Paying pilots — customers have paid for early access",
    "Live paying customers — repeat revenue",
]

ApplicationStatusValue = Literal[
    "draft", "submitted", "under_review", "shortlisted",
    "rejected", "accepted", "withdrawn",
]


# ─── Update model (PATCH body) ───────────────────────────────────────

class SipApplicationUpdate(BaseModel):
    """Partial update for SIP applications. All fields optional."""

    model_config = ConfigDict(extra="forbid")

    current_section: str | None = Field(default=None, max_length=_MAX_SECTION)

    # ── Section 02 · Basic Information (shared with TIR) ──
    basic_full_name: str | None = Field(default=None, max_length=_MAX_NAME)
    basic_phone: str | None = Field(default=None, max_length=_MAX_PHONE)
    basic_email: str | None = Field(default=None, max_length=_MAX_EMAIL)
    basic_org: str | None = Field(default=None, max_length=_MAX_ORG)
    basic_degree: DegreeValue | None = None
    basic_incubator_association: IncubatorAssociationValue | None = None
    basic_incubator_details: str | None = Field(default=None, max_length=_MAX_LONG_TEXT)
    basic_hear_about: HearAboutValue | None = None

    # ── Section 02 · SIP-specific gates ──
    sip_incorporated: SipIncorporatedValue | None = None
    sip_trl: SipTrlValue | None = None
    # Cap table list of {name, role, percent}
    sip_founders: list[dict[str, Any]] | None = Field(
        default=None, max_length=_MAX_FOUNDERS,
    )

    # ── Section 03 · Problem & Importance (shared) ──
    problem_describe: str | None = Field(default=None, max_length=_MAX_LONG_TEXT)

    # ── Section 04 · Your Solution (shared with TIR) ──
    solution_describe: str | None = Field(default=None, max_length=_MAX_LONG_TEXT)
    solution_core_tech: str | None = Field(default=None, max_length=_MAX_LONG_TEXT)
    solution_contrarian_insight: str | None = Field(default=None, max_length=_MAX_LONG_TEXT)

    # ── Section 04 · SIP-specific traction ──
    sip_traction: SipTractionValue | None = None
    sip_traction_details: str | None = Field(default=None, max_length=_MAX_LONG_TEXT)
    sip_traction_files: list[dict[str, Any]] | None = Field(
        default=None, max_length=_MAX_FILES,
    )

    # ── Section 05 · Execution Plan (shared) ──
    execution_milestone: str | None = Field(default=None, max_length=_MAX_LONG_TEXT)
    execution_infrastructure: str | None = Field(default=None, max_length=_MAX_LONG_TEXT)
    execution_failure: str | None = Field(default=None, max_length=_MAX_LONG_TEXT)
    execution_hwsw_integration: str | None = Field(default=None, max_length=_MAX_LONG_TEXT)
    execution_milestone_files: list[dict[str, Any]] | None = Field(default=None, max_length=3)

    # ── Section 06 · Evidence (SIP-specific) ──
    sip_pitch_deck: dict[str, Any] | None = None
    sip_cap_table_file: dict[str, Any] | None = None
    sip_demo_video_url: str | None = Field(default=None, max_length=_MAX_URL)
    sip_patents_files: list[dict[str, Any]] | None = Field(
        default=None, max_length=_MAX_FILES,
    )

    # ── Section 07 · Declaration ──
    declaration_truthful: bool | None = None
    declaration_ref_checks: bool | None = None
    declaration_terms: bool | None = None
    declaration_newsletter: bool | None = None


# ─── Read model (GET responses) ──────────────────────────────────────

class SipApplicationRead(SipApplicationUpdate):
    """Full SIP application row as returned from Supabase."""

    model_config = ConfigDict(extra="ignore")

    id: str
    user_id: str
    status: ApplicationStatusValue
    completion_pct: int = Field(default=0, ge=0, le=100)
    submitted_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


# ─── Submission / completion helpers ─────────────────────────────────

class SipSubmissionResult(BaseModel):
    ok: bool
    application_id: str
    submitted_at: datetime


class SipCompletionStatus(BaseModel):
    completion_pct: int
    missing_required_fields: list[str]
    current_section: str | None = None
