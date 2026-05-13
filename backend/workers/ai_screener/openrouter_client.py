"""OpenRouter client for AI application screening.

Calls ``google/gemini-flash-latest`` via the OpenRouter API and parses the
JSON response into a ScoreResult. Uses synchronous ``httpx.Client`` with a
30-second timeout (Phase 1 acceptable).

Public surface:
    score_application(app_row: dict) -> ScoreResult

Raises:
    OpenRouterParseError: if the model response is not valid JSON or is
        missing required keys. The caller (handler.py) treats this as a
        retryable failure and adds the message to batchItemFailures.
"""

from __future__ import annotations

import json
import logging
import os

import httpx

from .scoring import ScoreResult, compute_overall

log = logging.getLogger(__name__)

_OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
_MODEL = "google/gemini-flash-latest"
_TIMEOUT = 30.0

_SYSTEM_PROMPT = (
    "You are an evaluator for ARTPARK's startup incubation programme. "
    "Score the applicant on 5 dimensions, each 0.0–10.0, and reply ONLY "
    "with valid JSON of the shape: "
    '{"problem": float, "solution": float, "tech": float, '
    '"founders": float, "commitment": float, '
    '"summary": string of up to 200 words}.'
)


class OpenRouterParseError(Exception):
    """Raised when the model response cannot be parsed into a ScoreResult."""


def _build_user_message(app_row: dict) -> str:
    """Compose a user message from the application row's key fields.

    Missing fields are silently replaced with empty strings so the call
    never fails due to absent columns.
    """
    parts: list[str] = []

    name = app_row.get("basic_full_name") or ""
    org = app_row.get("basic_org_name") or app_row.get("basic_org") or ""
    problem = app_row.get("problem_describe") or ""
    solution = app_row.get("solution_describe") or ""
    tech = app_row.get("solution_core_tech") or ""

    if name:
        parts.append(f"Applicant: {name}")
    if org:
        parts.append(f"Organisation: {org}")
    if problem:
        parts.append(f"Problem: {problem}")
    if solution:
        parts.append(f"Solution: {solution}")
    if tech:
        parts.append(f"Core technology: {tech}")

    return "\n\n".join(parts) if parts else "No application details provided."


def score_application(app_row: dict) -> ScoreResult:
    """Call OpenRouter and return a ScoreResult for the given application row.

    Args:
        app_row: A dict containing the application's database columns. Only
            a subset of fields are used for the prompt; extras are ignored.

    Returns:
        A ScoreResult populated from the model's JSON response.

    Raises:
        OpenRouterParseError: if the response JSON is malformed or missing
            required keys.
        httpx.HTTPError: on network or HTTP-level failures (let the worker
            handle retries / DLQ).
    """
    api_key = os.getenv("OPENROUTER_API_KEY", "")
    user_message = _build_user_message(app_row)

    payload = {
        "model": _MODEL,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
    }

    with httpx.Client(timeout=_TIMEOUT) as client:
        response = client.post(
            _OPENROUTER_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        response.raise_for_status()

    raw_text = response.text
    log.debug("OpenRouter raw response: %s", raw_text[:500])

    try:
        outer = response.json()
        content = outer["choices"][0]["message"]["content"]
    except (KeyError, IndexError, json.JSONDecodeError) as exc:
        raise OpenRouterParseError(
            f"Unexpected OpenRouter response structure: {exc}"
        ) from exc

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError as exc:
        raise OpenRouterParseError(
            f"Model did not return valid JSON: {exc}\nContent: {content[:200]}"
        ) from exc

    required_keys = {"problem", "solution", "tech", "founders", "commitment", "summary"}
    missing = required_keys - parsed.keys()
    if missing:
        raise OpenRouterParseError(
            f"Model response missing keys: {missing}\nContent: {content[:200]}"
        )

    try:
        p = float(parsed["problem"])
        sol = float(parsed["solution"])
        t = float(parsed["tech"])
        f = float(parsed["founders"])
        c = float(parsed["commitment"])
        summary = str(parsed["summary"])
    except (TypeError, ValueError) as exc:
        raise OpenRouterParseError(
            f"Could not convert model scores to float: {exc}"
        ) from exc

    overall = compute_overall(p, sol, t, f, c)

    return ScoreResult(
        score_problem=p,
        score_solution=sol,
        score_tech=t,
        score_founders=f,
        score_commitment=c,
        score_overall=overall,
        summary=summary,
        model=_MODEL,
        raw_response=raw_text,
    )
