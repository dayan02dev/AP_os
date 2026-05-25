"""Shared fixtures for the AI scoring test suite.

The fake LLM uses langchain_core.language_models.fake_chat_models.
FakeListChatModel which lets us script LLM responses per test.
"""
from __future__ import annotations

import json

import pytest
from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langchain_core.messages import AIMessage


def _ai_json(payload: dict) -> AIMessage:
    return AIMessage(content=json.dumps(payload))


@pytest.fixture
def fake_llm():
    """A factory: pass a list of dicts; each scripted call returns one."""
    def _make(responses: list[dict]) -> FakeListChatModel:
        return FakeListChatModel(responses=[json.dumps(r) for r in responses])
    return _make


@pytest.fixture
def sample_application_row():
    return {
        "id": "app-uuid-1",
        "basic_full_name": "Test User",
        "basic_phone": "+91 9000000000",
        "basic_email": "user@example.com",
        "basic_org": "IIT Madras",
        "basic_degree": "PhD",
        "basic_has_team": "Yes — I have co-founders",
        "basic_incubator_association": "No",
        "basic_incubator_details": None,
        "basic_hear_about": "Referral from friend/colleague",
        "problem_describe": "Tier-1 aerospace suppliers spend 8 hours of manual inspection per blade. Defect miss rate ~3% causing in-service failures. Tariff pressure means inspection cost must drop 50% by 2027.",
        "problem_defined": "Yes",
        "solution_describe": "Compliant 6-DOF arm with structured-light + deep-learning defect classifier. 10× faster inspection vs the current 8-hour-per-blade manual baseline.",
        "solution_core_tech": "Novel compliant-joint design with sub-millimeter repeatability under 8 kg payload — combination of patented compliant linkage and learned calibration.",
        "solution_contrarian_insight": None,
        "solution_stage": "Pilot-ready product",
        "execution_will_break": "Sensor calibration drift in dusty environments; latency between embedded controller and cloud inference; physical wear-and-tear on actuators.",
        "execution_milestone": "Q1: bench-validated prototype. Q2: closed-loop pilot with 3 partner sites. Q3: 100-unit field deployment. Q4: TRL-4 sign-off and commercial partner LOI.",
        "execution_infrastructure": "GPU cluster for training, 6-DOF motion-capture arena, CNC + 3D-printing for weekly hardware iterations, ARTPARK pilot-customer network.",
        "execution_failure": None,
        "execution_hwsw_integration": None,
        "evidence_files": [{"storage_path": "x/publication.pdf", "name": "publication.pdf"}],
        "evidence_video_url": "https://www.loom.com/share/abc",
        "declaration_truthful": True,
        "declaration_ref_checks": True,
        "declaration_terms": True,
        "declaration_newsletter": False,
    }
