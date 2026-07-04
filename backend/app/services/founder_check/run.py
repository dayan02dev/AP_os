"""Resolve a TIR applicant's résumé, run the founder-check graph, and persist
the verdict into ai_screening.founder_check. `graph` is imported lazily so that
importing this module (e.g. from the SQS worker) does not pull in langgraph
until a check actually runs.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from app.supabase_client import get_admin_client

log = logging.getLogger(__name__)
_BUCKET = "tir-resumes"
_MODEL = "google/gemini-2.5-flash"


def _resolve_resume(client, app_id: str) -> dict | None:
    """Return {'storage_path', 'mime_type'} for the app's résumé, or None."""
    app = (client.table("tir_applications")
           .select("resume_file_id,user_id").eq("id", app_id)
           .maybe_single().execute().data)
    if not app:
        return None
    rid = app.get("resume_file_id")
    up = None
    if rid:
        up = (client.table("tir_resume_uploads")
              .select("storage_path,mime_type").eq("id", rid)
              .maybe_single().execute().data)
    if up is None and app.get("user_id"):
        rows = (client.table("tir_resume_uploads")
                .select("storage_path,mime_type").eq("user_id", app["user_id"])
                .order("created_at", desc=True).limit(1).execute().data) or []
        up = rows[0] if rows else None
    return up if (up and up.get("storage_path")) else None


def compute_founder_check(client, app_id: str) -> dict | None:
    """Download the résumé and run the graph. Returns a verdict dict (with model
    + ran_at) or None if there is no résumé. Does NOT write to the DB."""
    up = _resolve_resume(client, app_id)
    if up is None:
        return None
    resume_bytes = client.storage.from_(_BUCKET).download(up["storage_path"])
    from .graph import build_graph
    state = build_graph().invoke(
        {"resume_bytes": resume_bytes, "mime": up.get("mime_type") or ""})
    verdict = dict(state.get("verdict") or {})
    verdict["model"] = _MODEL
    verdict["ran_at"] = datetime.now(timezone.utc).isoformat()
    return verdict


def persist_founder_check(client, app_id: str, track: str, verdict: dict) -> None:
    (client.table("ai_screening").update({"founder_check": verdict})
     .eq("application_id", app_id).eq("application_track", track).execute())


def run_and_persist(client, app_id: str, track: str) -> dict | None:
    """TIR-only, best-effort. Returns the stored verdict or None (no résumé /
    non-TIR)."""
    if track != "tir":
        return None
    client = client or get_admin_client()
    verdict = compute_founder_check(client, app_id)
    if verdict is None:
        return None
    persist_founder_check(client, app_id, track, verdict)
    return verdict
