"""OpenRouter client for AI application screening.

Calls ``google/gemini-2.5-flash`` via the OpenRouter API and parses the
JSON response into a ScoreResult. Uses synchronous ``httpx.Client`` with a
30-second timeout (Phase 1 acceptable).

The single LLM call returns BOTH the 5-dimension score AND an industry
classification chosen from the caller-supplied category list (capped at
12 by the industry_categories service). See spec §3b.

Public surface:
    score_application(app_row, categories=None, slots_remaining=0) -> ScoreResult

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
_MODEL = "google/gemini-2.5-flash"
_TIMEOUT = 30.0

_SYSTEM_PROMPT = (
    "You are an evaluator for ARTPARK's startup incubation programme. "
    "Score the applicant on 5 dimensions (each 0.0–10.0) AND classify the "
    "venture into an industry category from a closed list provided in the "
    "user message. "
    "Reply ONLY with valid JSON of the shape: "
    '{"problem": float, "solution": float, "tech": float, '
    '"founders": float, "commitment": float, '
    '"summary": string of up to 200 words, '
    '"industry": {"category_id": "<existing id from the list>" '
    'OR "new_category": {"id": "<slug>", "label": "<display>"}, '
    '"industry_confidence": 0.0-1.0}}. '
    "Use `category_id` for existing matches, `new_category` for proposals. "
    "Prefer reusing existing categories. Only propose a new one if NONE of "
    "the existing categories describes the venture's primary domain AND "
    "slots_remaining > 0 AND the new category would clearly fit >= 3 "
    "plausible future ventures (no hyper-specific labels). For multi-domain "
    "ventures (e.g. a medical robot), prefer the bucket matching the primary "
    "differentiator described in solution_core_tech. Fall back to 'other' "
    "only when no bucket dominates."
)


class OpenRouterParseError(Exception):
    """Raised when the model response cannot be parsed into a ScoreResult."""


def _build_user_message(
    app_row: dict,
    categories: list[dict],
    slots_remaining: int,
) -> str:
    """Compose the user message: applicant text + current category list +
    slots_remaining hint."""
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

    if categories:
        cat_lines = "\n".join(f"  - {c['id']}: {c['label']}" for c in categories)
        parts.append(
            "Existing industry categories:\n"
            f"{cat_lines}\n"
            f"slots_remaining for new categories: {slots_remaining}"
        )

    return "\n\n".join(parts) if parts else "No application details provided."


def _parse_industry(parsed: dict) -> tuple[str | None, float | None, dict | None]:
    """Extract industry fields from the parsed LLM JSON.

    Returns (category_id, confidence, new_proposal). Missing or malformed
    industry block returns all None — the caller treats that as "no
    classification" and writes NULL to ai_screening.
    """
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


def _strip_json_fence(content: str) -> str:
    """Tolerate ```json ... ``` code fences (some providers wrap)."""
    stripped = content.strip()
    if stripped.startswith("```"):
        stripped = stripped.strip("`")
        if stripped.lower().startswith("json"):
            stripped = stripped[4:].lstrip("\n")
    return stripped


def score_application(
    app_row: dict,
    categories: list[dict] | None = None,
    slots_remaining: int = 0,
) -> ScoreResult:
    """Call OpenRouter and return a ScoreResult.

    Args:
        app_row: A dict containing the application's database columns.
        categories: Current rows from ``industry_categories``. Each dict
            must have at least ``id`` and ``label``. Passed to the LLM so
            it can choose an existing match. If None/empty, the industry
            section of the prompt is omitted and the result's industry
            fields stay None.
        slots_remaining: Unused slots before the 12-cap. Passed to the LLM
            so it knows whether to propose new categories.

    Raises:
        OpenRouterParseError: malformed response.
        httpx.HTTPError: network failures (retryable).
    """
    api_key = os.getenv("OPENROUTER_API_KEY", "")
    user_message = _build_user_message(app_row, categories or [], slots_remaining)

    payload = {
        "model": _MODEL,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.2,
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
        parsed = json.loads(_strip_json_fence(content))
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
    industry_id, industry_conf, new_proposal = _parse_industry(parsed)

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
        industry_category_id=industry_id,
        industry_confidence=industry_conf,
        new_industry_proposal=new_proposal,
    )
