"""Pilot-only VIP investment memo generation.

The memo is deliberately separate from the legacy five-dimension AI screen. It
accepts the complete application payload, preserves source fields, and asks the
model for a structured, neutral memo. This module does not run for TIR.
"""
from __future__ import annotations

import json
import os
from typing import Any

import httpx

PILOT_APPLICATION_IDS = frozenset({
    "0117bc80-98c1-4172-bccd-af61327ac580",
    "c8e45451-b9eb-4bed-8293-7a6782237168",
})

MEMO_SECTIONS = (
    "title_block", "deal_snapshot", "company_explanation", "why_solution_matters",
    "product_business_model", "technology_edge", "competitive_landscape",
    "addressable_market", "founding_team", "milestones", "use_of_funds",
    "risks_mitigants", "ic_recommendation", "ic_reviewer_notes", "attribution",
)

_PROMPT = """You are preparing a professional ARTPARK Venture Innovation Programme (VIP)
Investment Committee memo for a non-technical committee. Use ONLY the supplied
application packet and explicitly provided evidence. Never invent metrics,
customers, funding, competitors, market sizes, patents, dates, or team facts.
Use [To be confirmed] when evidence is absent. Keep language neutral because the
memo may be shared with the founding team.

Return exactly one JSON object with keys: title_block, deal_snapshot,
company_explanation, why_solution_matters, product_business_model,
technology_edge, competitive_landscape, addressable_market, founding_team,
milestones, use_of_funds, risks_mitigants, ic_recommendation,
ic_reviewer_notes, attribution, memo_scores.

Required content:
- Explain the company to a smart ten-year-old with one analogy and no jargon.
- why_solution_matters must contain exactly five labeled points: status quo,
  competitor limitations, barriers to entry, traction/capital efficiency, and
  future pivot potential.
- competitive_landscape must be grouped by target industry, each with honest
  named competitors where supported and [To be confirmed] otherwise.
- addressable_market must be grouped by industry and every number must include
  a source and publication year; otherwise mark it [To be confirmed].
- Include founding team, milestones, use of funds, at least four concrete risks
  with mitigants, and one recommendation from APPROVE, CONDITIONAL APPROVAL,
  REQUEST MORE INFORMATION.
- memo_scores must contain six independent 0-10 scores with short evidence:
  problem_urgency, technical_differentiation, commercial_validation,
  team_execution, market_position, risk_adjusted_confidence.
- Include source_field references for material claims. Do not copy facts from
  another company or the reference memo.

APPLICATION PACKET:
"""


def _packet(row: dict[str, Any], ai: dict[str, Any] | None, reviews: list[dict[str, Any]]) -> str:
    evidence = {
        "application": row,
        "ai_screening": ai or {},
        "reviewer_reviews": reviews,
    }
    return json.dumps(evidence, ensure_ascii=False, default=str)


def build_prompt(row: dict[str, Any], ai: dict[str, Any] | None = None,
                 reviews: list[dict[str, Any]] | None = None) -> str:
    return _PROMPT + _packet(row, ai, reviews or [])


def generate_memo(row: dict[str, Any], ai: dict[str, Any] | None = None,
                  reviews: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Generate one memo for an explicitly allow-listed SIP application."""
    app_id = str(row.get("id") or "")
    if app_id not in PILOT_APPLICATION_IDS:
        raise ValueError("VIP memo pilot is limited to the two approved applications")
    if row.get("track", "sip") != "sip":
        raise ValueError("VIP memo generation requires the sip track")

    key = os.getenv("VIP_MEMO_MODEL") or os.getenv("OPENROUTER_MODEL") or "openai/gpt-5.6"
    response = httpx.post(
        "https://openrouter.ai/api/v1/chat/completions",
        headers={"Authorization": f"Bearer {os.getenv('OPENROUTER_API_KEY', '')}",
                 "Content-Type": "application/json"},
        json={"model": key, "temperature": 0.1,
              "response_format": {"type": "json_object"},
              "messages": [{"role": "user", "content": build_prompt(row, ai, reviews)}]},
        timeout=120.0,
    )
    response.raise_for_status()
    data = response.json()
    content = data["choices"][0]["message"]["content"]
    memo = json.loads(content)
    missing = [section for section in MEMO_SECTIONS if section not in memo]
    if missing:
        raise ValueError(f"Memo response missing sections: {', '.join(missing)}")
    memo["meta"] = {"application_id": app_id, "track": "sip", "model": key, "pilot": True}
    return memo
