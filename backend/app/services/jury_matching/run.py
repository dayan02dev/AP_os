"""One LLM pass per juror: rank all jury_review apps by expertise fit."""
import json
import logging
from datetime import UTC, datetime

from app.services.jury_enrichment.client import _post
from app.services.jury_enrichment.graph import _parse_json
from app.services.jury_enrichment.prompts import MATCH_SYSTEM
from app.supabase_client import get_admin_client

log = logging.getLogger(__name__)
_MODEL = "google/gemini-2.5-flash"


def _call_llm(profile: dict, app_lines: list[str]) -> str:
    user = json.dumps({"juror_profile": profile}) + "\n\nApplications:\n" + "\n".join(app_lines)
    return _post([{"role": "system", "content": MATCH_SYSTEM},
                  {"role": "user", "content": user}], json_mode=True)


def _jury_review_apps(client) -> list[dict]:
    """[{id, track, name, industry, summary}] for every jury_review app."""
    out = []
    for track in ("tir", "sip"):
        rows = (client.table(f"{track}_applications").select("*")
                .eq("status", "jury_review").execute().data or [])
        rows = [r for r in rows if r.get("status") == "jury_review"]  # fake .eq no-op safety
        for r in rows:
            out.append({"id": r["id"], "track": track})
    if not out:
        return out
    ai_rows = client.table("ai_screening").select("*").execute().data or []
    ai_by = {(a.get("application_id"), a.get("application_track")): a for a in ai_rows}
    cats = {c["id"]: c.get("label") for c in
            (client.table("industry_categories").select("*").execute().data or [])}
    for item in out:
        ai = ai_by.get((item["id"], item["track"]), {})
        item["name"] = ai.get("project_name") or item["id"]
        item["industry"] = cats.get(ai.get("industry_category_id")) or "—"
        item["summary"] = (ai.get("summary") or "")[:200]
    return out


def run_for_juror(client, juror_user_id: str) -> int:
    client = client or get_admin_client()
    prof_rows = (client.table("jury_profiles").select("*")
                 .eq("juror_user_id", juror_user_id).limit(1).execute().data or [])
    if not prof_rows:
        return 0
    prof = prof_rows[0]
    apps = _jury_review_apps(client)
    client.table("jury_recommendations").delete() \
        .eq("juror_user_id", juror_user_id).execute()
    if not apps:
        return 0
    enr = prof.get("enrichment") or {}
    profile_ctx = {"expertise_domains": prof.get("expertise_domains") or [],
                   "sub_expertise": enr.get("sub_expertise") or "",
                   "enrichment": {k: enr.get(k) for k in ("summary", "sub_expertise")}}
    lines = [f"{a['id']} | {a['name']} | {a['industry']} | {a['summary']}" for a in apps]
    parsed = _parse_json(_call_llm(profile_ctx, lines))
    valid = {a["id"]: a for a in apps}
    rows = []
    now = datetime.now(UTC).isoformat()
    for rec in parsed.get("recommendations") or []:
        app = valid.get(str(rec.get("application_id")))
        if not app:
            continue
        try:
            score = max(0.0, min(100.0, float(rec.get("score"))))
        except (TypeError, ValueError):
            continue
        rows.append({"juror_user_id": juror_user_id, "application_id": app["id"],
                     "application_track": app["track"], "score": score,
                     "reason": (rec.get("reason") or "")[:500],
                     "model": _MODEL, "computed_at": now})
    if rows:
        client.table("jury_recommendations").insert(rows).execute()
    client.table("jury_profiles").update({"matched_at": now}) \
        .eq("juror_user_id", juror_user_id).execute()
    return len(rows)


def run_for_all(client=None) -> dict:
    client = client or get_admin_client()
    ids = [r["user_id"] for r in
           (client.table("user_roles").select("user_id,role").eq("role", "jury")
            .execute().data or []) if r.get("role") == "jury"]
    return {jid: run_for_juror(client, jid) for jid in sorted(set(ids))}
