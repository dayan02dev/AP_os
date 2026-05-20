"""Extract the JSON payload from an LLM response.

Some providers (Gemini via OpenRouter, for one) wrap structured output
in ```json … ``` fences or prepend reasoning prose, even when the prompt
says 'JSON only'. This helper strips fences and finds the outermost
{...} so json.loads succeeds.
"""
from __future__ import annotations

import re

_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL | re.IGNORECASE)


def extract_json_text(raw: str) -> str:
    s = (raw or "").strip()
    m = _FENCE_RE.search(s)
    if m:
        s = m.group(1).strip()
    # Trim to outermost { … } if there's prose around it
    start = s.find("{")
    end = s.rfind("}")
    if start != -1 and end != -1 and end > start:
        return s[start : end + 1]
    return s
