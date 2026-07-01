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
