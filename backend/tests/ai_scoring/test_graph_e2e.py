"""End-to-end LangGraph state-machine test with fake LLM."""
from __future__ import annotations

import json

from langchain_core.language_models.fake_chat_models import FakeListChatModel

from app.services.ai_scoring.graph import build_graph


def _evidence_response(sample_row):
    return {
        "basic": {"name": "REDACTED", "org": "IIT Madras", "degree": "PhD"},
        "problem": {"describe": sample_row["problem_describe"],
                    "defined": "Yes"},
        "solution": {
            "describe": sample_row["solution_describe"],
            "core_tech": sample_row["solution_core_tech"],
            "contrarian_insight": None,
            "stage": "Pilot-ready product",
        },
        "execution": {
            "will_break": sample_row["execution_will_break"],
            "milestone": sample_row["execution_milestone"],
            "infrastructure": sample_row["execution_infrastructure"],
            "failure": None,
            "hwsw_integration": None,
        },
        "evidence_assets": {"file_count": 1, "file_names": ["publication.pdf"],
                            "video_url_present": True},
        "resume": None,
        "derived": {
            "has_10x": True, "has_baseline_number": True,
            "has_patent_keyword": True, "problem_word_count": 31,
        },
    }


def _signal_response(signal):
    return {
        "signal": signal, "score": 8,
        "rationale": "Specific, evidence-anchored.",
        "evidence_citations": [{"source": "Q1", "quote": "x"}],
        "confidence_factors": {
            "data_completeness": 0.9, "evidence_specificity": 0.9,
            "internal_consistency": 0.9, "verifiability": 0.9,
            "answer_granularity": 0.9,
        },
        "flags": [],
    }


def _summary_response():
    # NOTE: all five sections combined must total 200-280 words to pass
    # the quality gate's word-count hard check (check_word_count).  The
    # text below is 220 words and passes all 7 hard checks.
    return {
        "verdict": "This is a STRONG application for the TIR Track at ARTPARK.",
        "top_strength": (
            "Technical specificity at IIT Madras with Patent Granted IP and 10x faster "
            "inspection ties Q11 to Q12 cleanly. The compliant 6-DOF robotic arm with "
            "structured-light and deep-learning defect classifier represents a genuine "
            "hardware-software co-design breakthrough. Sub-millimeter repeatability under "
            "8 kg payload is a hard engineering constraint that has been met, not merely "
            "claimed. The patent on the compliant linkage is a defensible IP moat that "
            "prevents fast-follower commoditization."
        ),
        "top_concern": (
            "Q15 execution hurdles are framed as research questions rather than engineering "
            "challenges, which risks scope drift during the ARTPARK residency period. The "
            "latency between embedded controller and cloud inference needs a concrete "
            "mitigation plan with measured round-trip times. Sensor calibration drift in "
            "dusty environments requires empirical test data from at least 3 manufacturing "
            "partner sites before the Q2 pilot milestone."
        ),
        "program_fit": (
            "Q17 GPU cluster ask aligns directly with ARTPARK's existing compute "
            "infrastructure, and the pilot-customer network across manufacturing verticals "
            "is an exact match for the 3 partner-site milestone in Q2. The motion-capture "
            "arena and CNC fabrication facilities at ARTPARK remove the infrastructure gap "
            "that typically blocks hardware teams at this stage. The ARTPARK ecosystem "
            "provides the right validation environment."
        ),
        "recommendation": (
            "ACCEPT within 14 days pending Patent Office confirmation of the compliant "
            "linkage patent grant and written LOI from at least 1 manufacturing partner."
        ),
    }


def test_graph_end_to_end_happy_path(sample_application_row):
    """Full graph traversal — Pass 1 → 5 scorers → Pass 3 → Pass 4 → done."""
    # Order of LLM calls in the graph (single LLM instance scripted):
    #   1× evidence extractor
    #   5× signal scorers (order matters — graph fans out alphabetically
    #      by signal name in our implementation)
    #   1× synthesize
    scripted = [
        json.dumps(_evidence_response(sample_application_row)),
        json.dumps(_signal_response("behavioural")),
        json.dumps(_signal_response("commitment")),
        json.dumps(_signal_response("completeness")),
        json.dumps(_signal_response("problem_impact")),
        json.dumps(_signal_response("technical_depth")),
        json.dumps(_summary_response()),
    ]
    llm = FakeListChatModel(responses=scripted)

    graph = build_graph(llm=llm)
    initial_state = {
        "application_id": "app-uuid-1",
        "track": "tir",
        "application_row": sample_application_row,
        "resume_meta": None,
        "tsp_context": None,
        "qg_retries": 0,
    }
    # max_concurrency=1 forces sequential fan-out so FakeListChatModel
    # (which uses a simple non-thread-safe counter) consumes responses in
    # the scripted alphabetical order.
    final = graph.invoke(initial_state, config={"max_concurrency": 1})

    # Pass 1 ran
    assert "evidence" in final
    # All 5 scorers ran
    for sig in ("problem_impact", "completeness", "technical_depth",
                "behavioural", "commitment"):
        assert final[f"score_{sig}"] is not None
    # Pass 3 computed derivatives
    assert "composite_percentage" in final
    assert "strength_label" in final
    # Pass 4 synthesized
    assert final["summary_round_1"] is not None
    assert "STRONG" in final["summary_round_1"].verdict
