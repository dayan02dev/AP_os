"""OpenRouter client — Gemini 2.0 Flash resume + template parser."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import httpx

from ..config import settings

# Q14 is the "how far along are you?" stage selector. Its options are
# duplicated here because the LLM normaliser needs them, AND apply-to-
# application validates Q14 before writing into solution_stage. Keep
# this list in sync with frontend/src/questions.jsx → stage.options.
TEMPLATE_Q14_STAGE_OPTIONS = [
    "Still exploring",
    "Literature / research stage",
    "Simulations completed",
    "Lab demos / proof of concept",
    "Prototype built",
    "Pilot-ready product",
    "Deployed in real setting with real users",
]
# Q10 is the "is the problem well-defined?" Yes/No selector.
TEMPLATE_Q10_OPTIONS = ["Yes", "No"]

log = logging.getLogger(__name__)

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
HTTP_TIMEOUT = 30.0
MAX_ATTEMPTS = 3
RETRY_STATUS = {429, 500, 502, 503, 504}

REQUIRED_KEYS = {
    "full_name", "email", "phone", "linkedin_url", "location",
    "education", "work_experience", "skills", "ventures", "summary",
}

SYSTEM_PROMPT = """You are a resume parser. Extract structured data from the resume text below.

Return STRICT JSON matching this exact schema — no prose, no markdown, no code fences:

{
  "full_name": string or null,
  "email": string or null,
  "phone": string or null,
  "linkedin_url": string or null,
  "location": string or null,
  "education": [
    {"institution": string, "degree": string, "field": string,
     "start_year": string, "end_year": string}
  ],
  "work_experience": [
    {"company": string, "title": string, "start_date": string,
     "end_date": string, "description": string}
  ],
  "skills": [string],
  "ventures": [
    {"name": string, "role": string, "description": string, "year_started": string}
  ],
  "summary": string
}

Rules:
- Use null for missing scalar fields. Use [] for missing lists. Never omit a key.
- "ventures" = startups founded or co-founded.
- "summary" = 2-3 sentence objective snapshot.
- Dates: prefer ISO "YYYY-MM" or plain "YYYY". Use "Present" for ongoing.
- Do not invent fields. If unsure, return null.
- Education entries: capture EVERY degree the candidate lists, not just the
  most recent. The UI picks the highest rank (PhD > Master's > Bachelor's).
  Preserve the original wording in `degree` ("M.Tech", "Master of Science",
  "Ph.D.", "B.E.", etc.) rather than normalising — the frontend does the
  normalisation and relies on the literal tokens to rank correctly."""


class LLMParseError(RuntimeError):
    """Parsing failed after all retries, or response was unparseable."""


class OpenRouterClient:
    """Thin wrapper around OpenRouter's chat-completions API."""

    def __init__(self, api_key: str | None = None, model: str | None = None) -> None:
        self.api_key = api_key or settings.openrouter_api_key
        self.model = model or settings.openrouter_model

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://artpark.online",
            "X-Title": "ARTPARK TIR",
        }

    def _payload(self, raw_text: str) -> dict[str, Any]:
        return {
            "model": self.model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": raw_text},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.1,
        }

    async def parse_resume(
        self,
        raw_text: str,
        *,
        user_id: str | None = None,
    ) -> dict[str, Any]:
        if not self.api_key:
            raise LLMParseError("OPENROUTER_API_KEY is not configured")
        if not raw_text.strip():
            raise LLMParseError("raw_text is empty")

        payload = self._payload(raw_text)
        headers = self._headers()
        last_err: Exception | None = None

        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as http:
            for attempt in range(1, MAX_ATTEMPTS + 1):
                try:
                    resp = await http.post(OPENROUTER_URL, headers=headers, json=payload)
                except httpx.HTTPError as exc:
                    last_err = exc
                    log.warning(
                        "openrouter network error",
                        extra={"attempt": attempt, "err": str(exc), "user_id": user_id},
                    )
                    if attempt < MAX_ATTEMPTS:
                        await asyncio.sleep(2 ** (attempt - 1))
                        continue
                    raise LLMParseError(f"network error after {attempt} attempts: {exc}") from exc

                if resp.status_code in RETRY_STATUS and attempt < MAX_ATTEMPTS:
                    log.warning(
                        "openrouter retriable status",
                        extra={"attempt": attempt, "status": resp.status_code, "user_id": user_id},
                    )
                    await asyncio.sleep(2 ** (attempt - 1))
                    continue

                if resp.status_code >= 400:
                    raise LLMParseError(
                        f"openrouter returned {resp.status_code}: {resp.text[:500]}"
                    )

                return self._parse_response(resp.json(), user_id=user_id)

        raise LLMParseError(f"exhausted retries: {last_err}")

    def _parse_response(self, body: dict[str, Any], *, user_id: str | None) -> dict[str, Any]:
        try:
            content = body["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMParseError(f"unexpected openrouter response shape: {exc}") from exc

        try:
            parsed = json.loads(content)
        except json.JSONDecodeError as exc:
            raise LLMParseError(f"LLM returned non-JSON content: {exc}") from exc

        if not isinstance(parsed, dict):
            raise LLMParseError("LLM returned JSON that isn't an object")

        missing = REQUIRED_KEYS - parsed.keys()
        if missing:
            raise LLMParseError(f"LLM output missing required keys: {sorted(missing)}")

        usage = body.get("usage") or {}
        log.info(
            "openrouter parse ok",
            extra={
                "user_id": user_id,
                "model": self.model,
                "prompt_tokens": usage.get("prompt_tokens"),
                "completion_tokens": usage.get("completion_tokens"),
                "total_tokens": usage.get("total_tokens"),
            },
        )
        return parsed

    # ── Template normalisation ────────────────────────────────────────────
    # The offline-template parser hands us a per-question dict already split
    # into essay free-text and (for Q10/Q14) option grids with checkbox
    # state. Gemini's job here is small and bounded: trim whitespace, decide
    # whether each cell counts as "filled" or "blank", and resolve MCQs to
    # the canonical option string. We do NOT ask it to summarise, rewrite,
    # or translate — every answer is rendered verbatim in the wizard so the
    # applicant can edit before submit.

    _TEMPLATE_SYSTEM_PROMPT = """You normalise answers from a Word/PDF
application template. The applicant filled 11 questions (Q9–Q19). For
each question you receive either:

  - {"free_text": "..."}                          (essay questions)
  - {"free_text": "...", "options": [...]}        (multiple-choice; Q10, Q14)

Each option entry has shape
    {"letter": "A", "label": "Yes", "checked": true|false|null}

Return STRICT JSON — no prose, no code fences — with exactly these keys:
{"Q9":  string|null, "Q10": string|null, "Q11": string|null,
 "Q12": string|null, "Q13": string|null, "Q14": string|null,
 "Q15": string|null, "Q16": string|null, "Q17": string|null,
 "Q18": string|null, "Q19": string|null}

Rules:
- Essay questions (Q9, Q11, Q12, Q13, Q15, Q16, Q17, Q18, Q19): emit the
  applicant's text with leading/trailing whitespace stripped. If the
  cell is empty or contains only placeholder content (e.g. "TODO",
  "n/a"), emit null.
- Q10 (Yes/No): if exactly one option has checked=true, emit that
  option's `label` ("Yes" or "No"). If none are checked, fall back to
  the free_text — accept "yes"/"y"/"no"/"n" case-insensitively. If
  ambiguous or empty, emit null.
- Q14 (stage): seven options A–G. If exactly one option has
  checked=true, emit that option's exact `label` string. Otherwise scan
  free_text for the closest matching label or letter. If still ambiguous
  or empty, emit null.
- Never invent content. Never paraphrase. Never reorder.
- Do not include keys other than Q9..Q19.
"""

    async def normalize_template_answers(
        self,
        payload: dict[str, Any],
        *,
        user_id: str | None = None,
    ) -> dict[str, Any]:
        """Round-trip the template payload through Gemini and return Q9..Q19.

        Raises LLMParseError on any of: missing key in API key config,
        non-2xx (after retries), non-JSON body, missing required keys.
        """
        if not self.api_key:
            raise LLMParseError("OPENROUTER_API_KEY is not configured")

        prompt_payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": self._TEMPLATE_SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.0,
        }
        headers = self._headers()
        last_err: Exception | None = None

        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as http:
            for attempt in range(1, MAX_ATTEMPTS + 1):
                try:
                    resp = await http.post(OPENROUTER_URL, headers=headers, json=prompt_payload)
                except httpx.HTTPError as exc:
                    last_err = exc
                    log.warning(
                        "openrouter (template) network error",
                        extra={"attempt": attempt, "err": str(exc), "user_id": user_id},
                    )
                    if attempt < MAX_ATTEMPTS:
                        await asyncio.sleep(2 ** (attempt - 1))
                        continue
                    raise LLMParseError(
                        f"network error after {attempt} attempts: {exc}"
                    ) from exc

                if resp.status_code in RETRY_STATUS and attempt < MAX_ATTEMPTS:
                    log.warning(
                        "openrouter (template) retriable status",
                        extra={"attempt": attempt, "status": resp.status_code,
                               "user_id": user_id},
                    )
                    await asyncio.sleep(2 ** (attempt - 1))
                    continue

                if resp.status_code >= 400:
                    raise LLMParseError(
                        f"openrouter returned {resp.status_code}: {resp.text[:500]}"
                    )

                return self._parse_template_response(resp.json(), user_id=user_id)

        raise LLMParseError(f"exhausted retries: {last_err}")

    _TEMPLATE_REQUIRED_KEYS = {f"Q{i}" for i in range(9, 20)}

    def _parse_template_response(
        self, body: dict[str, Any], *, user_id: str | None,
    ) -> dict[str, Any]:
        try:
            content = body["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMParseError(f"unexpected openrouter response shape: {exc}") from exc

        try:
            parsed = json.loads(content)
        except json.JSONDecodeError as exc:
            raise LLMParseError(f"LLM returned non-JSON content: {exc}") from exc

        if not isinstance(parsed, dict):
            raise LLMParseError("LLM returned JSON that isn't an object")

        missing = self._TEMPLATE_REQUIRED_KEYS - parsed.keys()
        if missing:
            raise LLMParseError(f"LLM output missing required keys: {sorted(missing)}")

        # Defensive normalisation: cast everything to str|None so the
        # router doesn't have to second-guess the shape.
        cleaned: dict[str, Any] = {}
        for k in self._TEMPLATE_REQUIRED_KEYS:
            v = parsed.get(k)
            if v is None:
                cleaned[k] = None
            elif isinstance(v, str):
                t = v.strip()
                cleaned[k] = t or None
            else:
                cleaned[k] = str(v).strip() or None

        usage = body.get("usage") or {}
        log.info(
            "openrouter template normalize ok",
            extra={
                "user_id": user_id,
                "model": self.model,
                "filled_keys": sorted(k for k, v in cleaned.items() if v),
                "prompt_tokens": usage.get("prompt_tokens"),
                "completion_tokens": usage.get("completion_tokens"),
                "total_tokens": usage.get("total_tokens"),
            },
        )
        return cleaned
