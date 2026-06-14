"""Pydantic models + ScoringState TypedDict for the AI scoring graph.

The ScoringState is what LangGraph passes between nodes. The Pydantic
models are what LangChain enforces as structured outputs from each LLM
call so the graph never has to defensively parse loose JSON.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal, TypedDict, Union

from pydantic import BaseModel, Field


# ─── Sub-objects shared across nodes ────────────────────────────────


class Citation(BaseModel):
    """A verbatim quote from a specific wizard question."""
    source: str       # e.g. "Q9", "Q12", "Q18"
    quote: str        # the verbatim text snippet


class ConfidenceFactors(BaseModel):
    """Five 0.0–1.0 factors. Aggregated to overall confidence via mean."""
    data_completeness: float    = Field(ge=0, le=1)
    evidence_specificity: float = Field(ge=0, le=1)
    internal_consistency: float = Field(ge=0, le=1)
    verifiability: float        = Field(ge=0, le=1)
    answer_granularity: float   = Field(ge=0, le=1)


SignalName = Literal[
    "problem_impact", "completeness", "technical_depth",
    "behavioural", "commitment",
]


class SignalScore(BaseModel):
    """One Pass 2 scorer's output."""
    signal: SignalName
    score: int = Field(ge=1, le=10)
    rationale: str
    evidence_citations: list[Citation]
    confidence_factors: ConfidenceFactors
    flags: list[str] = Field(default_factory=list)


# ─── Pass 3 audit trail ─────────────────────────────────────────────


# "SIP1" is PROVISIONAL_V0 — the SIP maturity cap (caps.rule_sip_preincorp).
CapRuleId = Literal["C1", "C2", "C3", "C5", "C6", "C7", "C9", "SIP1"]


class CapEvent(BaseModel):
    rule_id: CapRuleId
    triggered_at: datetime
    signal_capped: list[str]   # signal names that got capped
    cap_value: int             # the new ceiling
    evidence_snippet: str
    flag: str                  # short flag code stored in ai_screening.flags


# ─── Pass 4 outputs (round 1 + reserved round 2) ────────────────────


class Round1Summary(BaseModel):
    """The 5-section round-1 jury summary."""
    verdict: str        # 1 sentence
    top_strength: str   # 2-3 sentences
    top_concern: str    # 2-3 sentences
    program_fit: str    # 2-3 sentences
    recommendation: str # 1 sentence, ALL CAPS verb


class Round2SignalIntegration(BaseModel):
    """Round 2 only — the 6th section. RESERVED, not used in v1."""
    state: Literal[
        "agree", "rescues_grit", "rescues_trd",
        "catches", "catches_coachability", "neutral",
    ]
    archetype: Literal[
        "Architect", "Builder", "Catalyst", "Visionary",
        "Specialist", "Pioneer", "Explorer",
    ]
    prose: str
    interviewer_probe: str | None = None
    construct_rescued: Literal["grit", "tr_and_d"] | None = None


class Round2Summary(BaseModel):
    """RESERVED for round 2 (TSP integration). Not emitted in v1."""
    verdict: str
    top_strength: str
    top_concern: str
    signal_integration: Round2SignalIntegration
    program_fit: str
    recommendation: str


SummaryUnion = Union[Round1Summary, Round2Summary]


# ─── The LangGraph state ────────────────────────────────────────────


class ScoringState(TypedDict, total=False):
    """State passed between LangGraph nodes. Total=False because nodes
    populate fields incrementally; not every field exists at every node."""

    # Inputs
    application_id: str
    track: Literal["tir", "sip"]
    application_row: dict          # raw {track}_applications row (TIR or SIP)
    resume_meta: dict | None       # tir_resume_uploads.parsed_data if available

    # Pass 1 output
    evidence: dict                 # structured evidence (free-form; LLM-shaped)

    # Pass 2 outputs (one per signal)
    score_problem_impact: SignalScore | None
    score_completeness: SignalScore | None
    score_technical_depth: SignalScore | None
    score_behavioural: SignalScore | None
    score_commitment: SignalScore | None

    # Pass 3 outputs
    caps_applied: list[CapEvent]
    # PROVISIONAL_V0 — set by apply_caps when the SIP maturity cap fires; ORed
    # into needs_human_review at persistence. Absent on the TIR path.
    caps_needs_human_review: bool
    composite_percentage: float
    strength_label: str
    confidence_overall: float

    # Pass 4 output
    summary_round_1: Round1Summary | None
    # Reserved for round 2 (always None in v1)
    summary_round_2: Round2Summary | None
    tsp_context: dict | None       # always None in v1

    # Quality gate bookkeeping
    qg_retries: int
    qg_last_failures: list[str]
    qg_needs_human_review: bool

    # Metadata
    model: str
    started_at: datetime
