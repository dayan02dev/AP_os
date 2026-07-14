"""Load juror → run enrichment graph → persist → chain matching."""
import logging
from datetime import UTC, datetime

from app.supabase_client import get_admin_client

log = logging.getLogger(__name__)
_MODEL = "google/gemini-2.5-flash:online"


def _invoke_graph(state: dict) -> dict:
    from .graph import build_graph  # lazy: keep langgraph out of worker cold path
    return build_graph().invoke(state)


def _run_matching(client, juror_user_id: str) -> None:
    from app.services.jury_matching import run as match_run
    match_run.run_for_juror(client, juror_user_id)


def run_and_persist(juror_user_id: str, client=None) -> bool:
    client = client or get_admin_client()
    prof_rows = (client.table("jury_profiles").select("*")
                 .eq("juror_user_id", juror_user_id).limit(1).execute().data or [])
    if not prof_rows:
        log.warning("jury enrich: no profile for %s", juror_user_id)
        return False
    prof = prof_rows[0]
    person = (client.table("profiles").select("full_name,email")
              .eq("id", juror_user_id).limit(1).execute().data or [{}])[0]
    taxonomy = sorted({(c.get("label") or "").strip()
                       for c in (client.table("industry_categories").select("*").execute().data or [])
                       if c.get("label")})
    client.table("jury_profiles").update({"enrichment_status": "running"}) \
        .eq("juror_user_id", juror_user_id).execute()
    try:
        out = _invoke_graph({
            "name": person.get("full_name") or person.get("email") or "Unknown",
            "self_domains": prof.get("expertise_domains") or [],
            "linkedin_url": prof.get("linkedin_url"),
            "taxonomy": taxonomy,
        })
        enrichment = dict(out.get("profile") or {})
        enrichment["model"] = _MODEL
        enrichment["generated_at"] = datetime.now(UTC).isoformat()
        if out.get("error"):
            enrichment["error"] = out["error"]
        client.table("jury_profiles").update({
            "enrichment": enrichment,
            "expertise_domains": out.get("domains") or prof.get("expertise_domains") or [],
            "enrichment_status": "done",
            "updated_at": datetime.now(UTC).isoformat(),
        }).eq("juror_user_id", juror_user_id).execute()
    except Exception as exc:  # noqa: BLE001
        log.error("jury enrich failed for %s: %s", juror_user_id, exc)
        client.table("jury_profiles").update({
            "enrichment_status": "failed",
            "enrichment": {"error": str(exc)},
        }).eq("juror_user_id", juror_user_id).execute()
        return False
    try:
        _run_matching(client, juror_user_id)
    except Exception as exc:  # noqa: BLE001
        log.warning("jury matching after enrich failed (best-effort): %s", exc)
    return True
