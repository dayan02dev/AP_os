"""SummaryAgent: 300-400 word clinical executive summary (word-count self-correct)."""
from __future__ import annotations

from pathlib import Path

from .base_agent import BaseAgent

_PROMPTS = Path(__file__).parent / "prompts"

WORD_MIN = 300
WORD_MAX = 400


class SummaryAgent(BaseAgent):
    name = "summary"
    _json_mode = False

    def __init__(self, **kw):
        super().__init__(**kw)
        self._prompt_text = (_PROMPTS / "summary.txt").read_text(encoding="utf-8").strip()
        self._temp = max(self._temp, 0.3)  # slightly higher for prose quality

    @property
    def system_prompt(self) -> str:
        return self._prompt_text

    def _build_user_message(
        self,
        *,
        app_text: str = "",
        project_name: str = "",
        scoring_result: dict | None = None,
        **_ignored,
    ) -> str:
        parts: list[str] = []
        if project_name:
            parts.append(f"Project name to start with: {project_name}")
        if scoring_result:
            def _s(k: str) -> str:
                entry = scoring_result.get(k) or {}
                return str(entry.get("score", "N/A"))
            parts.append(
                "SCORING CONTEXT (align the summary with these assessments):\n"
                f"  problem_impact={_s('problem_impact')}/10  "
                f"completeness={_s('completeness')}/10  "
                f"technical_depth={_s('technical_depth')}/10  "
                f"behavioural={_s('behavioural')}/10  "
                f"commitment={_s('commitment')}/10"
            )
        parts.append(f"APPLICATION TEXT:\n{app_text}")
        return "\n\n".join(parts)

    def parse(self, raw: str) -> str:
        text = raw.strip().strip("`").strip()
        lines = text.splitlines()
        if lines and lines[0].strip().lower() in ("text", "markdown", "md", ""):
            text = "\n".join(lines[1:]).strip()
        return text

    def validate(self, result) -> list[str]:
        if not isinstance(result, str):
            return ["result is not a string"]
        wc = len(result.split())
        if wc < WORD_MIN:
            return [f"summary is {wc} words — below the {WORD_MIN}-word minimum; expand it"]
        if wc > WORD_MAX:
            return [f"summary is {wc} words — above the {WORD_MAX}-word maximum; trim it"]
        return []

    def _correction_message(self, failures: list[str]) -> str:
        issue = failures[0] if failures else "word count out of range"
        return (
            f"{issue}. Rewrite as a single paragraph of {WORD_MIN}–{WORD_MAX} words, "
            "same clinical tone and content. Output only the paragraph, no preamble."
        )

    def mock_result(self) -> str:
        return " ".join(["word"] * 320)
