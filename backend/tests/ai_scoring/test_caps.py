"""Unit tests for the 7 cap rules in ai_scoring/caps.py.

Each rule has its own trigger test + non-trigger test so we know the
cap fires only when the spec says it should.
"""
from __future__ import annotations

from datetime import datetime, timezone

from app.services.ai_scoring.caps import apply_all_caps


def _row(**overrides):
    """Build a minimal-but-valid tir_applications row, then override."""
    base = {
        "id": "app-1",
        "basic_full_name": "X",
        "basic_email": "x@example.com",
        "basic_incubator_association": "No",
        "basic_incubator_details": None,
        "problem_describe": "Tier-1 aerospace suppliers spend 8 hours of manual inspection per blade. Defect miss rate ~3% causing in-service failures. Tariff pressure means inspection cost must drop 50% by 2027." * 1,
        "problem_defined": "Yes",
        "solution_describe": "Compliant 6-DOF arm with structured-light + deep-learning defect classifier. 10x faster inspection.",
        "solution_core_tech": "Patent-pending compliant-joint design + adaptive calibration.",
        "solution_stage": "Pilot-ready product",
        "execution_will_break": "Sensor drift in dusty environments; latency between embedded controller and cloud inference; physical wear.",
        "execution_milestone": "Q1 bench-validated prototype; Q2 closed-loop pilot 3 sites; Q3 100-unit field deployment.",
        "execution_failure": "First sensor architecture failed monsoon humidity; we pivoted to sealed module.",
        "evidence_files": [{"storage_path": "x/y.pdf", "name": "publication.pdf"}],
        "evidence_video_url": "https://www.loom.com/share/abc",
    }
    base.update(overrides)
    return base


def _scores(**overrides):
    """Default scores all 10/10 so we can see which cap fires."""
    from app.services.ai_scoring.state import (
        SignalScore, Citation, ConfidenceFactors,
    )
    cf = ConfidenceFactors(
        data_completeness=1, evidence_specificity=1,
        internal_consistency=1, verifiability=1, answer_granularity=1,
    )

    def s(signal):
        return SignalScore(
            signal=signal, score=10, rationale="x",
            evidence_citations=[Citation(source="Q1", quote="x")],
            confidence_factors=cf, flags=[],
        )

    base = {
        "problem_impact": s("problem_impact"),
        "completeness": s("completeness"),
        "technical_depth": s("technical_depth"),
        "behavioural": s("behavioural"),
        "commitment": s("commitment"),
    }
    base.update(overrides)
    return base


# ─── C1: active incubator unresolved ────────────────────────────────

def test_c1_active_incubator_unresolved_caps_commitment_to_3():
    row = _row(basic_incubator_association="Yes",
               basic_incubator_details="We are currently incubated at XYZ.")
    capped, events = apply_all_caps(row, _scores(), resume_meta=None)
    assert capped["commitment"].score == 3
    assert any(e.rule_id == "C1" for e in events)


def test_c1_resolved_incubator_does_not_trigger():
    row = _row(basic_incubator_association="Yes",
               basic_incubator_details="We completed XYZ programme in 2023 — no ongoing commitments.")
    capped, events = apply_all_caps(row, _scores(), resume_meta=None)
    assert capped["commitment"].score == 10
    assert not any(e.rule_id == "C1" for e in events)


# ─── C2: deployed claim with no evidence ────────────────────────────

def test_c2_deployed_no_evidence_caps_tech_to_4():
    row = _row(
        solution_stage="Deployed in real setting with real users",
        evidence_files=[], evidence_video_url=None,
    )
    capped, events = apply_all_caps(row, _scores(), resume_meta=None)
    assert capped["technical_depth"].score == 4
    assert any(e.rule_id == "C2" for e in events)


def test_c2_deployed_with_evidence_does_not_trigger():
    row = _row(solution_stage="Deployed in real setting with real users")
    capped, events = apply_all_caps(row, _scores(), resume_meta=None)
    assert not any(e.rule_id == "C2" for e in events)


# ─── C3: patent claim, no evidence file ─────────────────────────────

def test_c3_patent_claim_no_file_caps_tech_to_6():
    row = _row(
        solution_core_tech="We have a patent on the compliant joint.",
        evidence_files=[],
    )
    capped, events = apply_all_caps(row, _scores(), resume_meta=None)
    assert capped["technical_depth"].score == 6
    assert any(e.rule_id == "C3" for e in events)


def test_c3_patent_claim_with_file_does_not_trigger():
    row = _row(solution_core_tech="We have a patent on the compliant joint.")
    capped, events = apply_all_caps(row, _scores(), resume_meta=None)
    assert not any(e.rule_id == "C3" for e in events)


# ─── C5: all-texts <200 chars ───────────────────────────────────────

def test_c5_minimal_texts_caps_completeness_to_2():
    row = _row(
        problem_describe="a",
        solution_describe="b",
        solution_core_tech="c",
        execution_will_break="d",
        execution_milestone="e",
    )
    capped, events = apply_all_caps(row, _scores(), resume_meta=None)
    assert capped["completeness"].score == 2
    assert any(e.rule_id == "C5" for e in events)


# ─── C6: prototype-or-beyond, no artefact ───────────────────────────

def test_c6_prototype_no_artefact_caps_tech_and_behavioural_to_4():
    row = _row(
        solution_stage="Prototype built",
        evidence_files=[], evidence_video_url=None,
    )
    capped, events = apply_all_caps(row, _scores(), resume_meta=None)
    assert capped["technical_depth"].score == 4
    assert capped["behavioural"].score == 4
    assert any(e.rule_id == "C6" for e in events)


def test_c6_prototype_with_resume_does_not_trigger():
    row = _row(
        solution_stage="Prototype built",
        evidence_files=[], evidence_video_url=None,
    )
    capped, events = apply_all_caps(
        row, _scores(),
        resume_meta={"parsed_data": {"name": "X", "completed_projects": 3}},
    )
    assert not any(e.rule_id == "C6" for e in events)


# ─── C7: 10× claim with no baseline ─────────────────────────────────

def test_c7_10x_no_baseline_caps_tech_to_7():
    row = _row(solution_describe="We deliver a 10× improvement.")
    capped, events = apply_all_caps(row, _scores(), resume_meta=None)
    assert capped["technical_depth"].score == 7
    assert any(e.rule_id == "C7" for e in events)


def test_c7_10x_with_baseline_does_not_trigger():
    row = _row(
        solution_describe="We deliver a 10× improvement vs the current 5-second per-blade inspection.",
    )
    capped, events = apply_all_caps(row, _scores(), resume_meta=None)
    assert not any(e.rule_id == "C7" for e in events)


# ─── C9: claimed clarity but short problem ──────────────────────────

def test_c9_yes_but_short_problem_caps_behavioural_to_5():
    row = _row(
        problem_defined="Yes",
        problem_describe="Inspection is hard.",  # well under 80 words
    )
    capped, events = apply_all_caps(row, _scores(), resume_meta=None)
    assert capped["behavioural"].score == 5
    assert any(e.rule_id == "C9" for e in events)


# ─── Caps stack (lower wins) ────────────────────────────────────────

def test_caps_stack_lower_value_wins():
    """When two rules cap the same signal, min() wins."""
    row = _row(
        solution_stage="Deployed in real setting with real users",  # C2 → 4
        evidence_files=[], evidence_video_url=None,
        solution_describe="10× faster.",                            # C7 → 7
    )
    capped, events = apply_all_caps(row, _scores(), resume_meta=None)
    assert capped["technical_depth"].score == 4   # min(4, 7)
