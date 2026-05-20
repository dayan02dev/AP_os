"""Unit tests for the 10 deterministic quality-gate checks (Pass 4)."""
from __future__ import annotations

from app.services.ai_scoring.nodes.quality_gate import (
    check_word_count, check_score_numbers_in_prose, check_weasel_words,
    check_recommendation_verb, check_accept_has_deadline,
    check_artpark_reference, check_passive_voice_density,
    check_specific_entity_per_section, evaluate_summary,
)
from app.services.ai_scoring.state import Round1Summary


def _summary(**overrides):
    base = dict(
        verdict="This is a STRONG application for the TIR Track with exceptional technical promise and commercial market viability.",
        top_strength="Technical depth and Patent Granted IP both anchor the case at IIT Madras with 10x faster inspection compared to manual baseline requiring eight hours per component. The applicant demonstrates exceptional technical command and IP protection through multiple patents in compliant robotics and vision domains. The team brings relevant prior experience building specialized hardware systems. Their ability to integrate software and mechanical design at micro-scale provides clear competitive advantage in precision manufacturing.",
        top_concern="Q15 hurdles are framed as research questions rather than engineering challenges which risks timeline drift and scope expansion. The team should clarify whether these represent known engineering problems with clear mitigations or fundamental research unknowns requiring external partnerships and extended investigation timelines. Specifically the sensor calibration drift problem needs a detailed mitigation strategy with acceptance criteria.",
        program_fit="Q17 asks for 6-DOF arena directly matching ARTPARK's motion-capture rig and pilot-customer network in aerospace manufacturing. The structured-light sensing approach aligns with ARTPARK's sensor characterization laboratory capabilities and pilot-customer relationships in precision inspection. Access to field deployment sites through ARTPARK's manufacturing network accelerates commercialization timelines significantly.",
        recommendation="ACCEPT within 14 days pending Patent Office confirmation and documentation.",
    )
    base.update(overrides)
    return Round1Summary(**base)


def test_word_count_in_range_passes():
    s = _summary()
    assert check_word_count(s, lo=20, hi=300) == []


def test_word_count_too_low_fails():
    fails = check_word_count(_summary(), lo=10000, hi=20000)
    assert any("word count" in f.lower() for f in fails)


def test_no_score_numbers_in_prose_passes():
    s = _summary()
    assert check_score_numbers_in_prose(s) == []


def test_score_numbers_in_prose_caught():
    s = _summary(top_strength="Scored 9/10 on technical depth and 10 out of 10 on commitment.")
    fails = check_score_numbers_in_prose(s)
    assert len(fails) >= 1


def test_weasel_words_passes_clean():
    s = _summary()
    assert check_weasel_words(s) == []


def test_weasel_words_caught():
    s = _summary(top_strength="Very promising approach with somewhat strong evidence.")
    fails = check_weasel_words(s)
    assert any("very" in f.lower() or "somewhat" in f.lower() for f in fails)


def test_recommendation_verb_accept_passes():
    assert check_recommendation_verb(_summary()) == []


def test_recommendation_verb_lowercase_caught():
    s = _summary(recommendation="accept within 14 days pending confirmation.")
    fails = check_recommendation_verb(s)
    assert any("uppercase" in f.lower() or "all caps" in f.lower() for f in fails)


def test_recommendation_verb_unknown_caught():
    s = _summary(recommendation="MAYBE we should think about it.")
    fails = check_recommendation_verb(s)
    assert len(fails) >= 1


def test_accept_has_deadline_passes():
    assert check_accept_has_deadline(_summary()) == []


def test_accept_without_deadline_fails():
    s = _summary(recommendation="ACCEPT this strong applicant for the TIR cohort.")
    fails = check_accept_has_deadline(s)
    assert any("deadline" in f.lower() or "within" in f.lower() for f in fails)


def test_artpark_reference_passes():
    assert check_artpark_reference(_summary()) == []


def test_artpark_reference_missing_caught():
    s = _summary(program_fit="The applicant is a good fit and has strong ambitions for India.")
    fails = check_artpark_reference(s)
    assert any("artpark" in f.lower() for f in fails)


def test_specific_entity_per_section_passes():
    """Each section must have at least one number or named entity."""
    assert check_specific_entity_per_section(_summary()) == []


def test_specific_entity_missing_section_caught():
    s = _summary(top_strength="The approach is good and the team appears capable.")
    fails = check_specific_entity_per_section(s)
    assert any("specific" in f.lower() or "entity" in f.lower() for f in fails)


def test_passive_voice_density_passes_active():
    assert check_passive_voice_density(_summary(), threshold=0.20) == []


def test_evaluate_summary_returns_dict():
    """End-to-end: runs every check, returns a structured pass/fail report."""
    result = evaluate_summary(_summary())
    assert "passed" in result
    assert "failures" in result
    assert isinstance(result["failures"], list)
    assert result["passed"] is True
