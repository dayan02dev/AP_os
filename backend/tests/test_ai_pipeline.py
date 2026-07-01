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
