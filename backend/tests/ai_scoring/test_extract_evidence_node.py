"""Unit tests for the Pass 1 Evidence Extractor node."""
from __future__ import annotations

from app.services.ai_scoring.nodes.extract_evidence import run as extract_evidence


def test_extract_returns_dict_with_required_keys(fake_llm, sample_application_row):
    expected_evidence = {
        "basic": {"name": "REDACTED", "org": "IIT Madras", "degree": "PhD"},
        "problem": {"describe": sample_application_row["problem_describe"],
                    "defined": "Yes"},
        "solution": {
            "describe": sample_application_row["solution_describe"],
            "core_tech": sample_application_row["solution_core_tech"],
            "contrarian_insight": None,
            "stage": "Pilot-ready product",
        },
        "execution": {
            "will_break": sample_application_row["execution_will_break"],
            "milestone": sample_application_row["execution_milestone"],
            "infrastructure": sample_application_row["execution_infrastructure"],
            "failure": None,
            "hwsw_integration": None,
        },
        "evidence_assets": {
            "file_count": 1,
            "file_names": ["publication.pdf"],
            "video_url_present": True,
        },
        "resume": None,
        "derived": {
            "char_counts": {"problem_describe": 200, "solution_describe": 130,
                            "solution_core_tech": 150, "execution_will_break": 130,
                            "execution_milestone": 200, "execution_infrastructure": 130},
            "word_counts": {"problem_describe": 31, "solution_describe": 22,
                            "solution_core_tech": 25, "execution_will_break": 20,
                            "execution_milestone": 30, "execution_infrastructure": 20},
            "has_10x": True,
            "has_baseline_number": True,
            "has_patent_keyword": True,
            "problem_word_count": 31,
        },
    }
    llm = fake_llm([expected_evidence])
    state = {
        "application_id": "app-uuid-1",
        "application_row": sample_application_row,
        "resume_meta": None,
    }
    result = extract_evidence(state, llm=llm)
    assert "evidence" in result
    ev = result["evidence"]
    for key in ("basic", "problem", "solution", "execution",
                "evidence_assets", "resume", "derived"):
        assert key in ev


def test_extract_redacts_pii(fake_llm, sample_application_row):
    # The fake LLM returns whatever we tell it; here we trust that the
    # prompt instructed it to redact. This test just confirms the node
    # passes the row through and doesn't accidentally leak PII into
    # state's evidence key via post-processing.
    llm = fake_llm([{"basic": {"name": "REDACTED", "org": "IIT Madras", "degree": "PhD"},
                     "problem": {}, "solution": {}, "execution": {},
                     "evidence_assets": {"file_count": 1, "file_names": [], "video_url_present": True},
                     "resume": None, "derived": {}}])
    state = {
        "application_id": "app-uuid-1",
        "application_row": sample_application_row,
        "resume_meta": None,
    }
    result = extract_evidence(state, llm=llm)
    assert result["evidence"]["basic"]["name"] == "REDACTED"
