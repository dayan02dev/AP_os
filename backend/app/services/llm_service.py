"""OpenRouter client — Gemini 2.0 Flash resume + template parser."""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import httpx
from json_repair import repair_json

from ..config import settings


def _loads_with_repair(content: str) -> Any:
    """json.loads with a json-repair fallback.

    Gemini 2.5 Flash occasionally emits *almost*-valid JSON under load:
    unescaped quotes inside long strings, dropped closing braces, or a
    stray trailing comma. We've seen this surface as a JSONDecodeError
    on field positions like char 3739 deep inside a 5KB payload — too
    far in to be a truncation, too small to be a model rebellion.
    json-repair is a small library that fixes the common cases without
    paying for another LLM round-trip.

    Raises json.JSONDecodeError if both passes fail.
    """
    try:
        return json.loads(content)
    except json.JSONDecodeError as first_err:
        repaired = repair_json(content, return_objects=True)
        if not repaired:
            raise first_err
        return repaired

# OpenRouter supports a `models` array on the request body — if the
# primary model returns a transient error (429, 503), OpenRouter
# automatically falls through to the next model on the list. The free
# Gemini tier was getting throttled in waves and within-Google fallbacks
# share that pool, so route fallbacks through different providers
# entirely — separate upstream quotas mean a Google outage doesn't
# take parsing down with it. Both fallbacks support strict JSON mode.
# OpenRouter caps `models` at 3 entries total, so primary + 2 fallbacks.
FALLBACK_MODELS = [
    "openai/gpt-4o-mini",
    "anthropic/claude-3-5-haiku",
]


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

# ── SIP template option lists ────────────────────────────────────────────
# Keep these in sync with the CHECK constraints on sip_applications
# (migration 011 + 013) AND with frontend/src/questions_sip.jsx.

SIP_TEMPLATE_Q5_OPTIONS = [
    "Yes — Pvt Ltd, registered in India",
    "Not yet — we're still pre-incorporation",
]
SIP_TEMPLATE_Q6_OPTIONS = [
    "TRL 3 or earlier — research stage",
    "TRL 4 — lab-validated prototype",
    "TRL 5 — pilot-tested in a relevant environment",
    "TRL 6+ — demonstrated in operational setting",
]
SIP_TEMPLATE_Q8_OPTIONS = ["Yes", "No"]
SIP_TEMPLATE_Q10_OPTIONS = [
    "Referral from friend/colleague",
    "IISc faculty or staff",
    "Social media (LinkedIn, Twitter, etc.)",
    "Event or conference",
    "Search engine",
    "Partner organization",
    "News article or press",
    "Other",
]
SIP_TEMPLATE_Q15_OPTIONS = [
    "Pre-revenue — building toward our first pilot",
    "Active pilots (paid or unpaid) with design partners",
    "Paying pilots — customers have paid for early access",
    "Live paying customers — repeat revenue",
]

# All 17 SIP template question IDs (Q5–Q24, minus Q7/Q22/Q23).
SIP_TEMPLATE_REQUIRED_KEYS: set[str] = {
    "Q5", "Q6", "Q8", "Q9", "Q10", "Q11", "Q12", "Q13", "Q14",
    "Q15", "Q16", "Q17", "Q18", "Q19", "Q20", "Q21", "Q24",
}

log = logging.getLogger(__name__)

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
# API Gateway HTTP API has a hard 30s integration timeout. Subtract
# upload + storage + Supabase calls (~3s) and we have ~25s for the LLM.
# CALL_DEADLINE bounds the *entire* OpenRouter round-trip including
# body download — httpx's per-stage timeout fires on chunk gaps, not
# total elapsed, so a slow trickle of body chunks would not trigger it.
# We wrap the whole thing in asyncio.wait_for to enforce a hard ceiling.
HTTP_TIMEOUT = 24.0          # connect/read/write/pool — used as fallback only
CALL_DEADLINE_SECONDS = 22.0  # asyncio.wait_for hard cap on POST + body read
MAX_ATTEMPTS = 1             # `models[]` array handles provider fallback in one call
RETRY_STATUS = {500, 502, 503, 504}

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


class _RetryableStatus(Exception):
    """Internal: OpenRouter returned a 5xx that's worth retrying."""

    def __init__(self, status: int) -> None:
        super().__init__(f"openrouter {status}")
        self.status = status


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
            # OpenRouter routes through `models[0]` first, transparently
            # retries with the next model on 429/503. Lets one prompt
            # absorb a free-tier rate-limit on Gemini-Flash-2 without
            # surfacing as a parse failure.
            "models": [self.model, *FALLBACK_MODELS],
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
                    body_dict = await asyncio.wait_for(
                        self._post_and_read(http, OPENROUTER_URL, headers, payload, user_id=user_id),
                        timeout=CALL_DEADLINE_SECONDS,
                    )
                except asyncio.TimeoutError as exc:
                    log.warning(
                        "openrouter total deadline exceeded",
                        extra={"attempt": attempt, "deadline_s": CALL_DEADLINE_SECONDS, "user_id": user_id},
                    )
                    if attempt < MAX_ATTEMPTS:
                        continue
                    raise LLMParseError(
                        f"openrouter exceeded {CALL_DEADLINE_SECONDS}s total deadline"
                    ) from exc
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
                except _RetryableStatus as exc:
                    last_err = exc
                    log.warning(
                        "openrouter retriable status",
                        extra={"attempt": attempt, "status": exc.status, "user_id": user_id},
                    )
                    if attempt < MAX_ATTEMPTS:
                        await asyncio.sleep(2 ** (attempt - 1))
                        continue
                    raise LLMParseError(f"openrouter {exc.status} after retries") from exc

                return self._parse_response(body_dict, user_id=user_id)

        raise LLMParseError(f"exhausted retries: {last_err}")

    async def _post_and_read(
        self,
        http: httpx.AsyncClient,
        url: str,
        headers: dict[str, str],
        payload: dict[str, Any],
        *,
        user_id: str | None,
    ) -> dict[str, Any]:
        """POST and fully consume the response body inside one bounded call.

        httpx logs `HTTP Request: ... 200 OK` as soon as response headers
        arrive — body download still happens lazily on `.content`/`.json()`.
        OpenRouter streams the body as the upstream LLM generates tokens,
        so the body read can take 10–20s after headers. Wrapping this
        helper in `asyncio.wait_for` enforces a total wall-clock deadline
        across header + body, which is what we actually need to fit the
        Lambda budget.
        """
        resp = await http.post(url, headers=headers, json=payload)

        if resp.status_code in RETRY_STATUS:
            raise _RetryableStatus(resp.status_code)
        if resp.status_code >= 400:
            await resp.aread()
            raise LLMParseError(
                f"openrouter returned {resp.status_code}: {resp.text[:500]}"
            )

        # Force the body to download NOW — under the wait_for deadline —
        # so a slow trickle from OpenRouter raises TimeoutError here, not
        # later when the caller invokes resp.json() outside the wrapper.
        body_bytes = await resp.aread()
        log.info(
            "openrouter.response_received",
            extra={"user_id": user_id, "body_bytes": len(body_bytes)},
        )
        body_dict = resp.json()
        log.info(
            "openrouter.body_parsed",
            extra={
                "user_id": user_id,
                "model_used": body_dict.get("model"),
                "has_choices": bool(body_dict.get("choices")),
            },
        )
        return body_dict

    def _parse_response(self, body: dict[str, Any], *, user_id: str | None) -> dict[str, Any]:
        try:
            content = body["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMParseError(f"unexpected openrouter response shape: {exc}") from exc

        log.info(
            "openrouter.content_extracted",
            extra={"user_id": user_id, "content_chars": len(content) if content else 0},
        )

        try:
            parsed = _loads_with_repair(content)
        except json.JSONDecodeError as exc:
            log.warning(
                "openrouter.json_repair_failed",
                extra={
                    "user_id": user_id,
                    "err": str(exc),
                    "content_preview": (content or "")[:500],
                },
            )
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
            "models": [self.model, *FALLBACK_MODELS],
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
                    body_dict = await asyncio.wait_for(
                        self._post_and_read(http, OPENROUTER_URL, headers, prompt_payload, user_id=user_id),
                        timeout=CALL_DEADLINE_SECONDS,
                    )
                except asyncio.TimeoutError as exc:
                    log.warning(
                        "openrouter (template) total deadline exceeded",
                        extra={"attempt": attempt, "deadline_s": CALL_DEADLINE_SECONDS, "user_id": user_id},
                    )
                    if attempt < MAX_ATTEMPTS:
                        continue
                    raise LLMParseError(
                        f"openrouter exceeded {CALL_DEADLINE_SECONDS}s total deadline"
                    ) from exc
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
                except _RetryableStatus as exc:
                    last_err = exc
                    log.warning(
                        "openrouter (template) retriable status",
                        extra={"attempt": attempt, "status": exc.status, "user_id": user_id},
                    )
                    if attempt < MAX_ATTEMPTS:
                        await asyncio.sleep(2 ** (attempt - 1))
                        continue
                    raise LLMParseError(f"openrouter {exc.status} after retries") from exc

                return self._parse_template_response(body_dict, user_id=user_id)

        raise LLMParseError(f"exhausted retries: {last_err}")

    _TEMPLATE_REQUIRED_KEYS = {f"Q{i}" for i in range(9, 20)}

    # Fallback when the deterministic anchor parser found no markers (or
    # too few) — happens when an applicant uploads a different .docx, a
    # Google Docs export that mangled the markers, or a hand-typed
    # response. We hand the whole document to Gemini with the question
    # text and ask it to extract answers from the surrounding prose.
    _TEMPLATE_FREEFORM_SYSTEM_PROMPT = """You receive the full plain text
of an application document and a list of 11 questions (Q9–Q19). Your job
is to find the applicant's answer to each question inside the document
and return it.

Document layout you should expect:
- The questions usually appear as headings (e.g. "Q9   ·   REQUIRED")
  followed by question prompts.
- Answers may be inline (right under each question) or grouped together
  at the end of the document in question order.
- Two questions are multiple-choice: Q10 (Yes / No) and Q14 (one of:
  Still exploring, Literature / research stage, Simulations completed,
  Lab demos / proof of concept, Prototype built, Pilot-ready product,
  Deployed in real setting with real users). For these, emit the exact
  canonical option string the applicant chose.

Return STRICT JSON — no prose, no markdown — with these keys exactly:
{"Q9":  string|null, "Q10": string|null, "Q11": string|null,
 "Q12": string|null, "Q13": string|null, "Q14": string|null,
 "Q15": string|null, "Q16": string|null, "Q17": string|null,
 "Q18": string|null, "Q19": string|null}

Rules:
- Q10 → "Yes" or "No" or null.
- Q14 → one of the 7 stage strings exactly, or null.
- Other Qs → the applicant's answer as-is (whitespace-trimmed). Strip
  any question prompt text or instruction lines that crept into the
  answer.
- If you cannot identify an answer with reasonable confidence, return
  null. Never guess. Never hallucinate.
- Never return the question prompt itself as an answer.
- Never paraphrase, summarise, translate, or shorten.
"""

    async def extract_template_answers_freeform(
        self,
        document_text: str,
        *,
        user_id: str | None = None,
    ) -> dict[str, Any]:
        """Whole-document fallback when anchor extraction yields nothing.

        `document_text` should be the full UTF-8 text of the .docx or PDF
        (already concatenated). We send it as the user message; Gemini
        does the heavy lifting of locating each answer.

        Output shape matches the anchor path: {Q9..Q19: str|None}.
        """
        if not self.api_key:
            raise LLMParseError("OPENROUTER_API_KEY is not configured")

        # Hard cap on input — Gemini Flash bills per token and a runaway
        # template (e.g. someone pasting their CV in) shouldn't blow the
        # latency budget. 30k chars ≈ 7-8k tokens; plenty for an honest
        # response while bounding worst-case behaviour.
        if len(document_text) > 30000:
            document_text = document_text[:30000].rstrip() + "\n[TRUNCATED]"

        prompt_payload = {
            "model": self.model,
            "models": [self.model, *FALLBACK_MODELS],
            "messages": [
                {"role": "system", "content": self._TEMPLATE_FREEFORM_SYSTEM_PROMPT},
                {"role": "user", "content": document_text},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.0,
        }
        headers = self._headers()
        last_err: Exception | None = None

        # Single attempt under the same total-deadline wrapper as the resume
        # path. The freeform prompt is bigger (full document) so the body
        # download is the slowest part — which is exactly what the wait_for
        # bound protects against. 5xx retries are still useful but capped
        # so the second attempt also fits inside Lambda's budget.
        FREEFORM_ATTEMPTS = 1

        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as http:
            for attempt in range(1, FREEFORM_ATTEMPTS + 1):
                try:
                    body_dict = await asyncio.wait_for(
                        self._post_and_read(http, OPENROUTER_URL, headers, prompt_payload, user_id=user_id),
                        timeout=CALL_DEADLINE_SECONDS,
                    )
                except asyncio.TimeoutError as exc:
                    log.warning(
                        "openrouter (freeform) total deadline exceeded",
                        extra={"attempt": attempt, "deadline_s": CALL_DEADLINE_SECONDS, "user_id": user_id},
                    )
                    if attempt < FREEFORM_ATTEMPTS:
                        continue
                    raise LLMParseError(
                        f"openrouter exceeded {CALL_DEADLINE_SECONDS}s total deadline"
                    ) from exc
                except httpx.HTTPError as exc:
                    last_err = exc
                    if attempt < FREEFORM_ATTEMPTS:
                        await asyncio.sleep(1.0)
                        continue
                    raise LLMParseError(
                        f"network error after {attempt} attempts: {exc}"
                    ) from exc
                except _RetryableStatus as exc:
                    last_err = exc
                    if attempt < FREEFORM_ATTEMPTS:
                        await asyncio.sleep(1.0)
                        continue
                    raise LLMParseError(f"openrouter {exc.status} after retries") from exc

                return self._parse_template_response(body_dict, user_id=user_id)

        raise LLMParseError(f"exhausted retries: {last_err}")

    # ── SIP template normalisation ────────────────────────────────────────

    _SIP_TEMPLATE_SYSTEM_PROMPT = """You normalise answers from a Word/PDF
SIP application template. The applicant filled 17 questions: Q5, Q6, Q8,
Q9, Q10, Q11, Q12, Q13, Q14, Q15, Q16, Q17, Q18, Q19, Q20, Q21, Q24.

For each question you receive either:
  - {"free_text": "..."}                          (essay / URL questions)
  - {"free_text": "...", "options": [...]}        (multiple-choice; Q5, Q6, Q8, Q10, Q15)

Each option entry has shape:
    {"letter": "A", "label": "Yes — Pvt Ltd, registered in India",
     "checked": true|false|null}

Return STRICT JSON — no prose, no code fences — with exactly these keys:
{"Q5":  string|null, "Q6":  string|null, "Q8":  string|null,
 "Q9":  string|null, "Q10": string|null, "Q11": string|null,
 "Q12": string|null, "Q13": string|null, "Q14": string|null,
 "Q15": string|null, "Q16": string|null, "Q17": string|null,
 "Q18": string|null, "Q19": string|null, "Q20": string|null,
 "Q21": string|null, "Q24": string|null}

Rules:
- Essay/URL questions (Q9, Q11, Q12, Q13, Q14, Q16, Q17, Q18, Q19, Q20,
  Q21, Q24): emit the applicant's text with leading/trailing whitespace
  stripped. If the cell is empty or contains only placeholder content
  (e.g. "TODO", "n/a"), emit null.
- Q24 is a URL. If it's not a valid http(s) URL, emit null. Do NOT try
  to fix or guess URLs.
- MCQ questions (Q5, Q6, Q8, Q10, Q15): if exactly one option has
  checked=true, emit that option's exact `label` string. If none are
  checked, fall back to free_text — match it against the option labels
  case-insensitively, or accept the option letter (A/B/C/...). If
  ambiguous (multiple checked, or text doesn't match a unique option)
  or empty, emit null.
- Q8 ("Yes"/"No"): also accept "yes"/"y"/"no"/"n" case-insensitively in
  free_text when no checkbox is ticked.
- Never invent content. Never paraphrase. Never reorder.
- Do not include keys other than the 17 listed above.
"""

    _SIP_TEMPLATE_FREEFORM_SYSTEM_PROMPT = """You receive the full plain
text of a SIP application document and a list of 17 questions: Q5, Q6,
Q8, Q9, Q10, Q11, Q12, Q13, Q14, Q15, Q16, Q17, Q18, Q19, Q20, Q21, Q24.

Document layout you should expect:
- Questions appear as headings like "Q5 · REQUIRED" or "Q9 · OPTIONAL"
  followed by question prompts.
- Answers may be inline (right under each question) or grouped at the
  end of the document.
- Five questions are multiple-choice:
    Q5  → ["Yes — Pvt Ltd, registered in India",
           "Not yet — we're still pre-incorporation"]
    Q6  → ["TRL 3 or earlier — research stage",
           "TRL 4 — lab-validated prototype",
           "TRL 5 — pilot-tested in a relevant environment",
           "TRL 6+ — demonstrated in operational setting"]
    Q8  → ["Yes", "No"]
    Q10 → ["Referral from friend/colleague",
           "IISc faculty or staff",
           "Social media (LinkedIn, Twitter, etc.)",
           "Event or conference",
           "Search engine",
           "Partner organization",
           "News article or press",
           "Other"]
    Q15 → ["Pre-revenue — building toward our first pilot",
           "Active pilots (paid or unpaid) with design partners",
           "Paying pilots — customers have paid for early access",
           "Live paying customers — repeat revenue"]

Return STRICT JSON — no prose, no markdown — with these keys exactly:
{"Q5":  string|null, "Q6":  string|null, "Q8":  string|null,
 "Q9":  string|null, "Q10": string|null, "Q11": string|null,
 "Q12": string|null, "Q13": string|null, "Q14": string|null,
 "Q15": string|null, "Q16": string|null, "Q17": string|null,
 "Q18": string|null, "Q19": string|null, "Q20": string|null,
 "Q21": string|null, "Q24": string|null}

Rules:
- MCQ questions → the exact canonical option string the applicant chose,
  or null if unclear.
- Q24 → a valid http(s) URL or null.
- Other Qs → applicant's answer as-is (whitespace-trimmed).
- If you cannot identify an answer with reasonable confidence, return
  null. Never guess. Never hallucinate.
- Never paraphrase, summarise, translate, or shorten.
"""

    async def normalize_sip_template_answers(
        self,
        payload: dict[str, Any],
        *,
        user_id: str | None = None,
    ) -> dict[str, Any]:
        """SIP equivalent of normalize_template_answers — Q5..Q24 minus Q7/Q22/Q23."""
        if not self.api_key:
            raise LLMParseError("OPENROUTER_API_KEY is not configured")

        prompt_payload = {
            "model": self.model,
            "models": [self.model, *FALLBACK_MODELS],
            "messages": [
                {"role": "system", "content": self._SIP_TEMPLATE_SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.0,
        }
        return await self._run_template_call(
            prompt_payload,
            required_keys=SIP_TEMPLATE_REQUIRED_KEYS,
            user_id=user_id,
            log_label="sip-template",
        )

    async def extract_sip_template_answers_freeform(
        self,
        document_text: str,
        *,
        user_id: str | None = None,
    ) -> dict[str, Any]:
        """SIP equivalent of extract_template_answers_freeform."""
        if not self.api_key:
            raise LLMParseError("OPENROUTER_API_KEY is not configured")

        if len(document_text) > 30000:
            document_text = document_text[:30000].rstrip() + "\n[TRUNCATED]"

        prompt_payload = {
            "model": self.model,
            "models": [self.model, *FALLBACK_MODELS],
            "messages": [
                {"role": "system", "content": self._SIP_TEMPLATE_FREEFORM_SYSTEM_PROMPT},
                {"role": "user", "content": document_text},
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.0,
        }
        return await self._run_template_call(
            prompt_payload,
            required_keys=SIP_TEMPLATE_REQUIRED_KEYS,
            user_id=user_id,
            log_label="sip-template-freeform",
        )

    async def _run_template_call(
        self,
        prompt_payload: dict[str, Any],
        *,
        required_keys: set[str],
        user_id: str | None,
        log_label: str,
    ) -> dict[str, Any]:
        """Shared retry + parse loop for template-style calls.

        Factored out of normalize_template_answers /
        extract_template_answers_freeform — same retry/deadline shape,
        parameterised by the required-keys set for output validation.
        """
        headers = self._headers()
        last_err: Exception | None = None

        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as http:
            for attempt in range(1, MAX_ATTEMPTS + 1):
                try:
                    body_dict = await asyncio.wait_for(
                        self._post_and_read(http, OPENROUTER_URL, headers, prompt_payload, user_id=user_id),
                        timeout=CALL_DEADLINE_SECONDS,
                    )
                except asyncio.TimeoutError as exc:
                    log.warning(
                        f"openrouter ({log_label}) total deadline exceeded",
                        extra={"attempt": attempt, "deadline_s": CALL_DEADLINE_SECONDS, "user_id": user_id},
                    )
                    if attempt < MAX_ATTEMPTS:
                        continue
                    raise LLMParseError(
                        f"openrouter exceeded {CALL_DEADLINE_SECONDS}s total deadline"
                    ) from exc
                except httpx.HTTPError as exc:
                    last_err = exc
                    if attempt < MAX_ATTEMPTS:
                        await asyncio.sleep(2 ** (attempt - 1))
                        continue
                    raise LLMParseError(f"network error after {attempt} attempts: {exc}") from exc
                except _RetryableStatus as exc:
                    last_err = exc
                    if attempt < MAX_ATTEMPTS:
                        await asyncio.sleep(2 ** (attempt - 1))
                        continue
                    raise LLMParseError(f"openrouter {exc.status} after retries") from exc

                return self._parse_template_response_strict(
                    body_dict, required_keys=required_keys, user_id=user_id,
                )

        raise LLMParseError(f"exhausted retries: {last_err}")

    def _parse_template_response_strict(
        self,
        body: dict[str, Any],
        *,
        required_keys: set[str],
        user_id: str | None,
    ) -> dict[str, Any]:
        """Parameterised version of _parse_template_response."""
        try:
            content = body["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMParseError(f"unexpected openrouter response shape: {exc}") from exc

        try:
            parsed = _loads_with_repair(content)
        except json.JSONDecodeError as exc:
            raise LLMParseError(f"LLM returned non-JSON content: {exc}") from exc

        if not isinstance(parsed, dict):
            raise LLMParseError("LLM returned JSON that isn't an object")

        missing = required_keys - parsed.keys()
        if missing:
            raise LLMParseError(f"LLM output missing required keys: {sorted(missing)}")

        cleaned: dict[str, Any] = {}
        for k in required_keys:
            v = parsed.get(k)
            if v is None:
                cleaned[k] = None
            elif isinstance(v, str):
                t = v.strip()
                cleaned[k] = t or None
            else:
                cleaned[k] = str(v).strip() or None
        return cleaned

    def _parse_template_response(
        self, body: dict[str, Any], *, user_id: str | None,
    ) -> dict[str, Any]:
        try:
            content = body["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise LLMParseError(f"unexpected openrouter response shape: {exc}") from exc

        try:
            parsed = _loads_with_repair(content)
        except json.JSONDecodeError as exc:
            log.warning(
                "openrouter.template_json_repair_failed",
                extra={
                    "user_id": user_id,
                    "err": str(exc),
                    "content_preview": (content or "")[:500],
                },
            )
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
