"""ClassifierAgent: project_name + industry category from application text.

Preserves the project_name/industry outputs the leadership/admin lists and the
industry filter rely on (the score/summary agents do not produce them).
"""
from __future__ import annotations

import json
from pathlib import Path

from .base_agent import BaseAgent

_PROMPTS = Path(__file__).parent / "prompts"
_PROJECT_NAME_MAX_WORDS = 4


class ClassifierAgent(BaseAgent):
    name = "classify"
    _json_mode = True

    def __init__(self, **kw):
        super().__init__(**kw)
        self._prompt_text = (_PROMPTS / "classify.txt").read_text(encoding="utf-8").strip()

    @property
    def system_prompt(self) -> str:
        return self._prompt_text

    def _build_user_message(
        self, *, app_text: str = "", categories=None, slots_remaining: int = 0, **_ignored
    ) -> str:
        parts = [f"APPLICATION TEXT:\n{app_text}"]
        cats = categories or []
        if cats:
            cat_lines = "\n".join(f"  - {c['id']}: {c['label']}" for c in cats)
            parts.append(
                "Existing industry categories:\n"
                f"{cat_lines}\nslots_remaining for new categories: {slots_remaining}"
            )
        return "\n\n".join(parts)

    def parse(self, raw: str) -> dict:
        text = raw.strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text.lower().startswith("json"):
                text = text[4:]
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return {"project_name": None, "industry_category_id": None,
                    "industry_confidence": None, "new_industry_proposal": None}
        cid, conf, proposal = _parse_industry(parsed)
        return {
            "project_name": _parse_project_name(parsed),
            "industry_category_id": cid,
            "industry_confidence": conf,
            "new_industry_proposal": proposal,
        }

    def validate(self, result) -> list[str]:
        # Classification is best-effort — never block on it. Missing fields just
        # mean the leadership router falls back to its heuristic project name.
        return []

    def mock_result(self) -> dict:
        return {"project_name": "Mock venture", "industry_category_id": None,
                "industry_confidence": None, "new_industry_proposal": None}


def _parse_industry(parsed: dict) -> tuple[str | None, float | None, dict | None]:
    ind = parsed.get("industry")
    if not isinstance(ind, dict):
        return None, None, None
    conf_raw = ind.get("industry_confidence")
    try:
        conf = float(conf_raw) if conf_raw is not None else None
    except (TypeError, ValueError):
        conf = None
    new_cat = ind.get("new_category")
    if isinstance(new_cat, dict) and new_cat.get("id") and new_cat.get("label"):
        return None, conf, {"id": str(new_cat["id"]), "label": str(new_cat["label"])}
    cid = ind.get("category_id")
    if isinstance(cid, str) and cid:
        return cid, conf, None
    return None, conf, None


def _parse_project_name(parsed: dict) -> str | None:
    raw = parsed.get("project_name")
    if not isinstance(raw, str):
        return None
    name = " ".join(raw.split()).strip().strip("\"'").rstrip(".?!,;:")
    if not name or not any(c.isalpha() for c in name):
        return None
    words = name.split()
    if len(words) > _PROJECT_NAME_MAX_WORDS:
        name = " ".join(words[:_PROJECT_NAME_MAX_WORDS])
    return name[0].upper() + name[1:]
