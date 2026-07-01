"""SectionAgent: four analyst sections (problem/solution/moats/watchouts),
each 3-5 bullet "pointers". Runs an independent validate->self-correct loop per
section over the same OpenRouter/gemini-2.5-flash path as the other agents.
Caches the whole 4-section dict per app via BaseAgent's disk cache (name="sections").
"""
from __future__ import annotations

import re
from pathlib import Path

from .base_agent import BaseAgent

_PROMPTS = Path(__file__).parent / "section_prompts"
SECTIONS = ("problem", "solution", "moats", "watchouts")

_MIN_BULLETS = 3
_MAX_BULLETS = 5
_MAX_WORDS_PER_BULLET = 40

_MARKER = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s*")


class SectionAgent(BaseAgent):
    name = "sections"

    def __init__(self, **kw):
        super().__init__(**kw)
        self._prompts: dict[str, str] = {
            sec: (_PROMPTS / f"{sec}.txt").read_text(encoding="utf-8").strip()
            for sec in SECTIONS
        }

    # BaseAgent abstract stubs (run() is fully overridden; these are unused).
    @property
    def system_prompt(self) -> str:
        return self._prompts["problem"]

    def parse(self, raw: str) -> list[str]:
        text = (raw or "").strip()
        if text.startswith("```"):
            text = text.strip("`").strip()
        bullets: list[str] = []
        for line in text.splitlines():
            s = _MARKER.sub("", line.strip()).strip()
            if not s or s.lower() in ("text", "markdown", "md", "json"):
                continue
            bullets.append(s)
        return bullets

    def mock_result(self) -> dict:
        canned = [
            "Mock bullet on the core engineering bottleneck.",
            "Mock bullet on economic severity.",
            "Mock bullet on why it is unsolved.",
        ]
        return {sec: list(canned) for sec in SECTIONS}

    @staticmethod
    def _validate_section(bullets: list[str]) -> list[str]:
        n = len(bullets)
        if n < _MIN_BULLETS:
            return [f"{n} bullets — need at least {_MIN_BULLETS} one-line bullets"]
        if n > _MAX_BULLETS:
            return [f"{n} bullets — at most {_MAX_BULLETS}; merge to {_MIN_BULLETS}-{_MAX_BULLETS}"]
        for b in bullets:
            if len(b.split()) > _MAX_WORDS_PER_BULLET:
                return [f"a bullet exceeds {_MAX_WORDS_PER_BULLET} words; keep each to one line"]
        return []

    def _run_one_section(self, app_text: str, section: str) -> tuple[list[str], list[str]]:
        messages = [
            {"role": "system", "content": self._prompts[section]},
            {"role": "user", "content": f"APPLICATION TEXT:\n{app_text}"},
        ]
        best: list[str] | None = None
        best_fail: list[str] | None = None
        for rnd in range(self.MAX_CORRECT_ROUNDS + 1):
            raw = self._call_api(messages)
            bullets = self.parse(raw)
            failures = self._validate_section(bullets)
            if best_fail is None or len(failures) < len(best_fail):
                best, best_fail = bullets, failures
            if not failures:
                break
            if rnd < self.MAX_CORRECT_ROUNDS:
                messages = messages + [
                    {"role": "assistant", "content": raw},
                    {"role": "user", "content":
                        f"{failures[0]}. Return only {_MIN_BULLETS}-{_MAX_BULLETS} one-line "
                        f"bullets, each starting with '- ', same analytical content."},
                ]
        return best or [], best_fail or []

    def run(self, app_id: str, app_text: str = "", *,
            mock: bool = False, no_cache: bool = False, **_ignored):
        """Return (result_dict, flags_str). result_dict maps each of the four
        SECTIONS to a list of bullet strings."""
        if mock:
            result = self.mock_result()
            fails: list[str] = []
            for sec in SECTIONS:
                fails += self._validate_section(result[sec])
            return result, "; ".join(fails)

        if not no_cache:
            cached = self._cache_read(app_id)
            if cached is not None:
                return cached, ""

        result: dict[str, list[str]] = {}
        all_fail: list[str] = []
        for sec in SECTIONS:
            bullets, failures = self._run_one_section(app_text, sec)
            result[sec] = bullets
            all_fail += [f"{sec}: {f}" for f in failures]

        if not no_cache:
            self._cache_write(app_id, result)
        return result, "; ".join(all_fail)
