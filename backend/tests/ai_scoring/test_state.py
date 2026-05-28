"""Unit tests for ai_scoring/state.py — Pydantic models + ScoringState shape."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.services.ai_scoring.state import (
    Citation,
    ConfidenceFactors,
    SignalScore,
    CapEvent,
    Round1Summary,
)


def test_citation_minimal():
    c = Citation(source="Q9", quote="Tier-1 aerospace suppliers spend 8 hours per blade.")
    assert c.source == "Q9"
    assert c.quote.startswith("Tier-1")


def test_confidence_factors_clamped_0_to_1():
    cf = ConfidenceFactors(
        data_completeness=0.9, evidence_specificity=0.7,
        internal_consistency=0.8, verifiability=0.6, answer_granularity=0.5,
    )
    assert cf.data_completeness == 0.9
    with pytest.raises(ValidationError):
        ConfidenceFactors(
            data_completeness=1.5, evidence_specificity=0.7,
            internal_consistency=0.8, verifiability=0.6, answer_granularity=0.5,
        )


def test_signal_score_score_in_1_10():
    s = SignalScore(
        signal="problem_impact", score=8,
        rationale="Specific population + quantified pain + clear urgency.",
        evidence_citations=[Citation(source="Q9", quote="Defect miss rate ~3%.")],
        confidence_factors=ConfidenceFactors(
            data_completeness=1.0, evidence_specificity=0.9,
            internal_consistency=0.9, verifiability=0.7, answer_granularity=0.8,
        ),
        flags=[],
    )
    assert s.score == 8
    with pytest.raises(ValidationError):
        SignalScore(
            signal="problem_impact", score=11,
            rationale="x", evidence_citations=[],
            confidence_factors=ConfidenceFactors(
                data_completeness=0, evidence_specificity=0,
                internal_consistency=0, verifiability=0, answer_granularity=0,
            ),
            flags=[],
        )


def test_signal_score_signal_enum():
    with pytest.raises(ValidationError):
        SignalScore(
            signal="something_else", score=5,
            rationale="x", evidence_citations=[],
            confidence_factors=ConfidenceFactors(
                data_completeness=0, evidence_specificity=0,
                internal_consistency=0, verifiability=0, answer_granularity=0,
            ),
            flags=[],
        )


def test_cap_event_shape():
    from datetime import datetime, timezone
    e = CapEvent(
        rule_id="C2", triggered_at=datetime.now(timezone.utc),
        signal_capped=["technical_depth"], cap_value=4,
        evidence_snippet="Deployed in real setting with real users",
        flag="c2_deployed_no_evidence",
    )
    assert e.rule_id == "C2"
    assert "technical_depth" in e.signal_capped


def test_round1_summary_has_5_fields():
    s = Round1Summary(
        verdict="This is a STRONG application for the TIR Track.",
        top_strength="Tech specificity backed by Patent Granted IP.",
        top_concern="Q15 hurdles framed as research questions, not engineering.",
        program_fit="Q17 ask for 6-DOF rig matches ARTPARK motion-capture arena.",
        recommendation="ACCEPT within 14 days pending Patent Office confirmation.",
    )
    assert s.verdict.startswith("This is a")
    assert "ACCEPT" in s.recommendation or "WAITLIST" in s.recommendation or "REJECT" in s.recommendation or "HOLD" in s.recommendation
