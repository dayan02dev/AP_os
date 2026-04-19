"""OpenRouter client — Gemini 2.0 Flash resume parser."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import httpx

from ..config import settings

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
- Do not invent fields. If unsure, return null."""


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
            "X-Title": "ARTPARK EIR",
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
