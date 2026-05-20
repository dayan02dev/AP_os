"""Top-level entry point — score one application end-to-end.

Wires the LangGraph from .graph with the prod LangChain model + Supabase
client. Called from the admin endpoint in routers/ai_screening.py.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

from .graph import build_graph
from .persistence import persist_score

log = logging.getLogger(__name__)


def _load_application_row(supabase, application_id: str, track: str) -> dict:
    table = f"{track}_applications"
    res = (
        supabase.table(table)
        .select("*")
        .eq("id", application_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    if not rows:
        raise ValueError(
            f"Application {application_id!r} not found in {table}"
        )
    return rows[0]


def _load_resume_meta(supabase, user_id: str | None, track: str) -> dict | None:
    if not user_id:
        return None
    table = f"{track}_resume_uploads"
    try:
        res = (
            supabase.table(table)
            .select("parsed_data, parse_status")
            .eq("user_id", user_id)
            .eq("parse_status", "completed")
            .limit(1)
            .execute()
        )
    except Exception:
        return None
    rows = res.data or []
    return rows[0] if rows else None


def _build_llm():
    """Real production LLM — only called when no fake is injected.

    Imported lazily so the test path that injects a fake doesn't need
    GOOGLE_API_KEY in the environment.
    """
    from langchain.chat_models import init_chat_model
    provider = os.environ.get("AI_SCORING_PROVIDER", "google_genai")
    model = os.environ.get("AI_SCORING_MODEL", "gemini-2.5-flash")
    return init_chat_model(model, model_provider=provider, temperature=0)


def score_application(
    *,
    application_id: str,
    track: str = "tir",
    supabase,
    llm=None,
    graph_config: dict | None = None,
) -> dict:
    """Run the full scoring graph + persist result.

    If `llm` is None, builds a real LangChain model from env vars.

    The optional `graph_config` is passed to graph.invoke(). In tests,
    you may need to pass config={"max_concurrency": 1} to force sequential
    execution when using a non-thread-safe FakeListChatModel.
    """
    if track != "tir":
        raise ValueError(f"v1 only supports TIR; got {track!r}")

    application_row = _load_application_row(supabase, application_id, track)
    resume_meta = _load_resume_meta(supabase, application_row.get("user_id"), track)

    if llm is None:
        llm = _build_llm()

    graph = build_graph(llm=llm)
    initial_state = {
        "application_id": application_id,
        "track": track,
        "application_row": application_row,
        "resume_meta": resume_meta,
        "tsp_context": None,
        "qg_retries": 0,
        "model": os.environ.get("AI_SCORING_MODEL", "gemini-2.5-flash"),
        "started_at": datetime.now(timezone.utc),
    }

    if graph_config is None:
        graph_config = {}
    final_state = graph.invoke(initial_state, config=graph_config)

    persist_score(supabase, final_state)
    log.info(
        "Scored application_id=%s composite=%s strength=%s caps=%d retries=%d",
        application_id, final_state.get("composite_percentage"),
        final_state.get("strength_label"),
        len(final_state.get("caps_applied", [])),
        final_state.get("qg_retries", 0),
    )
    return final_state
