"""Unit tests for the ai_pipeline module. All offline — no network, no Supabase."""
from __future__ import annotations

from app.services.ai_pipeline.base_agent import BaseAgent


class _EchoAgent(BaseAgent):
    name = "echo"

    @property
    def system_prompt(self) -> str:
        return "system"

    def _build_user_message(self, *, text: str = "") -> str:
        return text

    def validate(self, result):
        # valid only when the parsed text contains "GOOD"
        return [] if isinstance(result, str) and "GOOD" in result else ["missing GOOD token"]


def test_base_agent_self_corrects_until_valid():
    agent = _EchoAgent()
    # First reply invalid, second reply valid — loop must return the valid one.
    replies = iter(["BAD reply", "now GOOD reply"])
    agent._call_api = lambda messages: next(replies)  # type: ignore[method-assign]
    result, flags = agent.run("app-1", text="hello")
    assert result == "now GOOD reply"
    assert flags == ""


def test_base_agent_keeps_best_effort_when_all_rounds_fail():
    agent = _EchoAgent()
    agent.MAX_CORRECT_ROUNDS = 1
    agent._call_api = lambda messages: "always BAD"  # type: ignore[method-assign]
    result, flags = agent.run("app-2", text="hello")
    assert result == "always BAD"
    assert "missing GOOD token" in flags


import json as _json
from app.services.ai_pipeline.scoring_agent import ScoringAgent, SCORE_KEYS

_GOOD_SCORES = {
    "problem_impact":  {"score": 9.0, "rationale": "x"},
    "completeness":    {"score": 8.5, "rationale": "x"},
    "technical_depth": {"score": 8.0, "rationale": "x"},
    "behavioural":     {"score": 8.5, "rationale": "x"},
    "commitment":      {"score": 9.0, "rationale": "x"},
}


def test_scoring_agent_parses_and_validates_good_json():
    agent = ScoringAgent()
    agent._call_api = lambda messages: _json.dumps(_GOOD_SCORES)  # type: ignore[method-assign]
    result, flags = agent.run("app-3", app_text="some application")
    assert flags == ""
    assert set(result.keys()) == set(SCORE_KEYS)
    assert result["problem_impact"]["score"] == 9.0


def test_scoring_agent_flags_out_of_range_then_corrects():
    agent = ScoringAgent()
    bad = {**_GOOD_SCORES, "commitment": {"score": 99.0, "rationale": "x"}}
    replies = iter([_json.dumps(bad), _json.dumps(_GOOD_SCORES)])
    agent._call_api = lambda messages: next(replies)  # type: ignore[method-assign]
    result, flags = agent.run("app-4", app_text="x")
    assert flags == ""
    assert result["commitment"]["score"] == 9.0


def test_scoring_agent_flags_missing_key():
    agent = ScoringAgent()
    agent.MAX_CORRECT_ROUNDS = 0
    incomplete = {k: _GOOD_SCORES[k] for k in list(SCORE_KEYS)[:4]}
    agent._call_api = lambda messages: _json.dumps(incomplete)  # type: ignore[method-assign]
    _result, flags = agent.run("app-5", app_text="x")
    assert "commitment" in flags


from app.services.ai_pipeline.summary_agent import SummaryAgent, WORD_MIN, WORD_MAX


def _para(n_words: int) -> str:
    return " ".join(["word"] * n_words)


def test_summary_agent_accepts_in_range():
    agent = SummaryAgent()
    agent._call_api = lambda messages: _para(350)  # type: ignore[method-assign]
    result, flags = agent.run("app-6", app_text="x", project_name="Acme")
    assert flags == ""
    assert WORD_MIN <= len(result.split()) <= WORD_MAX


def test_summary_agent_self_corrects_short_then_ok():
    agent = SummaryAgent()
    replies = iter([_para(120), _para(320)])
    agent._call_api = lambda messages: next(replies)  # type: ignore[method-assign]
    result, flags = agent.run("app-7", app_text="x", project_name="Acme")
    assert flags == ""
    assert len(result.split()) == 320


def test_summary_agent_reports_flag_when_never_in_range():
    agent = SummaryAgent()
    agent.MAX_CORRECT_ROUNDS = 1
    agent._call_api = lambda messages: _para(50)  # type: ignore[method-assign]
    _result, flags = agent.run("app-8", app_text="x", project_name="Acme")
    assert "words" in flags


from app.services.ai_pipeline.classifier_agent import ClassifierAgent


def test_classifier_parses_existing_category():
    agent = ClassifierAgent()
    payload = _json.dumps({
        "project_name": "AI dengue diagnostics",
        "industry": {"category_id": "health", "industry_confidence": 0.9},
    })
    agent._call_api = lambda messages: payload  # type: ignore[method-assign]
    result, flags = agent.run(
        "app-9", app_text="x",
        categories=[{"id": "health", "label": "Health"}], slots_remaining=5,
    )
    assert flags == ""
    assert result["project_name"] == "AI dengue diagnostics"
    assert result["industry_category_id"] == "health"
    assert result["new_industry_proposal"] is None


def test_classifier_parses_new_category_proposal():
    agent = ClassifierAgent()
    payload = _json.dumps({
        "project_name": "Grid fault robots",
        "industry": {"new_category": {"id": "grid", "label": "Grid"},
                     "industry_confidence": 0.8},
    })
    agent._call_api = lambda messages: payload  # type: ignore[method-assign]
    result, _flags = agent.run("app-10", app_text="x", categories=[], slots_remaining=3)
    assert result["industry_category_id"] is None
    assert result["new_industry_proposal"] == {"id": "grid", "label": "Grid"}


from app.services.ai_pipeline.serialize import build_app_text


def test_serialize_tir_includes_core_fields_and_redacts_pii():
    row = {
        "basic_full_name": "Jane Doe", "basic_email": "j@x.com", "basic_phone": "123",
        "basic_org": "Acme Labs",
        "problem_describe": "Grids fail silently.",
        "solution_describe": "Edge anomaly detection.",
        "solution_core_tech": "INT4 model on QCS8550.",
        "execution_milestone": "Pilot on 110kV corridor.",
    }
    text = build_app_text(row, "tir")
    assert "Grids fail silently." in text
    assert "Edge anomaly detection." in text
    assert "Acme Labs" in text
    assert "Jane Doe" not in text and "j@x.com" not in text and "123" not in text


def test_serialize_vip_includes_sip_fields():
    row = {
        "basic_org": "Acme",
        "problem_describe": "P", "solution_describe": "S",
        "sip_incorporated": "Yes", "sip_trl": "TRL 6",
        "sip_traction": "Revenue", "sip_traction_details": "₹40L ARR",
    }
    text = build_app_text(row, "sip")
    assert "TRL 6" in text and "₹40L ARR" in text


from types import SimpleNamespace
from unittest.mock import MagicMock

from app.services.ai_pipeline import pipeline


def _fake_client_with_row(row: dict) -> MagicMock:
    client = MagicMock()
    chain = MagicMock()
    chain.select.return_value = chain
    chain.eq.return_value = chain
    chain.maybe_single.return_value = chain
    chain.execute.return_value = SimpleNamespace(data=row)
    client.table.return_value = chain
    return client


def test_run_for_application_assembles_scoreresult(monkeypatch):
    row = {"id": "a1", "status": "submitted", "basic_org": "Acme",
           "problem_describe": "P", "solution_describe": "S"}
    client = _fake_client_with_row(row)

    monkeypatch.setattr(pipeline, "_classify", lambda *a, **k: {
        "project_name": "Acme robots", "industry_category_id": "robotics",
        "industry_confidence": 0.9, "new_industry_proposal": None})
    monkeypatch.setattr(pipeline, "_score", lambda *a, **k: ({
        "problem_impact": {"score": 9.0}, "completeness": {"score": 8.5},
        "technical_depth": {"score": 8.0}, "behavioural": {"score": 8.5},
        "commitment": {"score": 9.0}}, ""))
    monkeypatch.setattr(pipeline, "_summarize", lambda *a, **k: ("A summary.", ""))

    result = pipeline.run_for_application("a1", "tir", client=client, no_cache=True)
    assert result.score_problem == 9.0
    assert result.score_solution == 8.5          # completeness -> score_solution field
    assert result.score_founders == 8.5          # behavioural -> score_founders field
    assert result.summary == "A summary."
    assert result.project_name == "Acme robots"
    assert result.score_overall == 8.6           # weighted, rounded (0.22/0.30/0.22/0.14/0.12)


def test_ai_screening_router_uses_new_pipeline():
    import app.routers.ai_screening as r
    src = __import__("inspect").getsource(r)
    assert "ai_scoring.runner" not in src
    assert "AI_SCORING_ENABLED" not in src
    assert "ai_pipeline" in src
