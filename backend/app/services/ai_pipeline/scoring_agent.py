"""ScoringAgent: score 5 dimensions (0-10) from flat application text."""
from __future__ import annotations

import json
from pathlib import Path

from .base_agent import BaseAgent

_PROMPTS = Path(__file__).parent / "prompts"

SCORE_KEYS = (
    "problem_impact",
    "completeness",
    "technical_depth",
    "behavioural",
    "commitment",
)


class ScoringAgent(BaseAgent):
    name = "scoring"
    _json_mode = True

    def __init__(self, **kw):
        super().__init__(**kw)
        self._prompt_text = (_PROMPTS / "scoring.txt").read_text(encoding="utf-8").strip()

    @property
    def system_prompt(self) -> str:
        return self._prompt_text

    def _build_user_message(self, *, app_text: str = "", **_ignored) -> str:
        return f"APPLICATION TEXT:\n{app_text}"

    def parse(self, raw: str) -> dict:
        text = raw.strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text.lower().startswith("json"):
                text = text[4:]
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return {}

    def validate(self, result) -> list[str]:
        if not isinstance(result, dict):
            return ["result is not a JSON object"]
        failures: list[str] = []
        for key in SCORE_KEYS:
            entry = result.get(key)
            if not isinstance(entry, dict) or "score" not in entry:
                failures.append(f"missing or malformed dimension: {key}")
                continue
            try:
                score = float(entry["score"])
            except (TypeError, ValueError):
                failures.append(f"{key}.score is not a number")
                continue
            if not (0.0 <= score <= 10.0):
                failures.append(f"{key}.score {score} out of range [0,10]")
        return failures

    def mock_result(self) -> dict:
        return {k: {"score": 6.5, "rationale": "mock"} for k in SCORE_KEYS}
