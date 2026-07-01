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
