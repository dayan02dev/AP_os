"""Orchestrator: application row -> classify -> score -> summarize -> ScoreResult,
plus persistence into ai_screening. Used by the SQS worker and the backfill.
"""
from __future__ import annotations

import json
import logging
from dataclasses import replace as _dc_replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.services import industry_categories
from app.supabase_client import get_admin_client
from workers.ai_screener.scoring import ScoreResult, compute_overall

from .classifier_agent import ClassifierAgent
from .scoring_agent import ScoringAgent
from .serialize import build_app_text
from .summary_agent import SummaryAgent

log = logging.getLogger(__name__)

_STATUS_SUBMITTED = "submitted"
_STATUS_UNDER_REVIEW = "under_review"


# ── stage wrappers (patch points for tests) ───────────────────────────────
def _classify(app_text: str, *, cache_dir: Path | None, no_cache: bool) -> dict:
    cats = industry_categories.fetch_categories()
    slots = max(0, industry_categories.CATEGORY_CAP - len(cats))
    agent = ClassifierAgent(cache_dir=cache_dir)
    result, _flags = agent.run(
        _APP_ID.get("id", "x"), app_text=app_text, categories=cats,
        slots_remaining=slots, no_cache=no_cache,
    )
    # Guard against a hallucinated category id: the LLM occasionally returns an
    # invented `category_id` (e.g. "robotic") that is not a real row. Writing it
    # would violate the ai_screening → industry_categories FK. Drop it to None;
    # genuine new categories still flow through `new_industry_proposal` +
    # create_category_if_under_cap in persist().
    valid_ids = {c["id"] for c in cats}
    cid = result.get("industry_category_id")
    if cid is not None and cid not in valid_ids:
        result["industry_category_id"] = None
    return result


def _score(app_id: str, app_text: str, *, cache_dir: Path | None, no_cache: bool):
    return ScoringAgent(cache_dir=cache_dir).run(app_id, app_text=app_text, no_cache=no_cache)


def _summarize(app_id, app_text, project_name, scoring_result, *, cache_dir, no_cache):
    return SummaryAgent(cache_dir=cache_dir).run(
        app_id, app_text=app_text, project_name=project_name or "",
        scoring_result=scoring_result, no_cache=no_cache,
    )


# module-level scratch so _classify can log an id without threading it through
_APP_ID: dict[str, str] = {}


def run_for_application(
    app_id: str,
    track: str,
    *,
    client: Any = None,
    cache_dir: Path | None = None,
    no_cache: bool = False,
) -> ScoreResult:
    """Read the row, run the 3 agents, and assemble a ScoreResult (no DB write)."""
    client = client or get_admin_client()
    table = f"{track}_applications"
    res = client.table(table).select("*").eq("id", app_id).maybe_single().execute()
    app_row: dict | None = res.data
    if app_row is None:
        raise ValueError(f"application_id={app_id} not found in {table}")

    _APP_ID["id"] = app_id
    app_text = build_app_text(app_row, track)

    classification = _classify(app_text, cache_dir=cache_dir, no_cache=no_cache)
    scores, _sflags = _score(app_id, app_text, cache_dir=cache_dir, no_cache=no_cache)
    summary, summary_flags = _summarize(
        app_id, app_text, classification.get("project_name"), scores,
        cache_dir=cache_dir, no_cache=no_cache,
    )

    def _sc(key: str) -> float:
        return float((scores.get(key) or {}).get("score", 0.0))

    problem = _sc("problem_impact")
    completeness = _sc("completeness")
    tech = _sc("technical_depth")
    behavioural = _sc("behavioural")
    commitment = _sc("commitment")

    return ScoreResult(
        score_problem=problem,
        score_solution=completeness,     # DB column score_completeness
        score_tech=tech,
        score_founders=behavioural,      # DB column score_founders
        score_commitment=commitment,
        score_overall=compute_overall(problem, completeness, tech, behavioural, commitment),
        summary=summary,
        model="google/gemini-2.5-flash",
        raw_response=json.dumps({"scores": scores, "summary_flags": summary_flags}),
        industry_category_id=classification.get("industry_category_id"),
        industry_confidence=classification.get("industry_confidence"),
        new_industry_proposal=classification.get("new_industry_proposal"),
        project_name=classification.get("project_name"),
    )


def persist(
    client: Any,
    app_id: str,
    track: str,
    result: ScoreResult,
    *,
    advance_status: bool,
) -> None:
    """Create any proposed industry category, upsert ai_screening, and (if
    advance_status) log + advance submitted -> under_review."""
    # New-category creation (same policy as the old worker).
    if (
        result.new_industry_proposal
        and result.industry_confidence is not None
        and result.industry_confidence >= 0.7
    ):
        proposal = result.new_industry_proposal
        if industry_categories.create_category_if_under_cap(
            category_id=proposal["id"], label=proposal["label"],
            created_by_app_id=app_id,
        ):
            result = _dc_replace(result, industry_category_id=proposal["id"])

    flags = [] if not _summary_flagged(result) else ["needs_human_review"]
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "application_id": app_id,
        "application_track": track,
        "score_problem": result.score_problem,
        "score_completeness": result.score_solution,
        "score_tech": result.score_tech,
        "score_founders": result.score_founders,
        "score_commitment": result.score_commitment,
        "score_integrity": None,
        "score_overall": result.score_overall,
        "confidence": None,
        "summary": result.summary,
        "flags": flags,
        "raw_response": result.raw_response,
        "model": result.model,
        "ran_at": now,
        "error": None,
        "industry_category_id": result.industry_category_id,
        "industry_confidence": result.industry_confidence,
        "project_name": result.project_name,
    }
    client.table("ai_screening").upsert(
        row, on_conflict="application_id,application_track"
    ).execute()

    if advance_status:
        client.table("application_status_log").insert({
            "application_id": app_id, "application_track": track,
            "from_status": _STATUS_SUBMITTED, "to_status": _STATUS_UNDER_REVIEW,
            "changed_by": None, "reason": "ai_screening_complete",
        }).execute()
        client.table(f"{track}_applications").update(
            {"status": _STATUS_UNDER_REVIEW}
        ).eq("id", app_id).execute()


def _summary_flagged(result: ScoreResult) -> bool:
    try:
        return bool(json.loads(result.raw_response).get("summary_flags"))
    except (json.JSONDecodeError, AttributeError):
        return False
