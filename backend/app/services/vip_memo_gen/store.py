"""Supabase persistence for generated VIP memos (migration 047).

Every function takes the admin ``client`` first so tests can pass a fake. The
memo dict given to ``persist_memo`` is the one already normalised by
``schema.memo_to_dict``. ``Usage`` / ``InputRecord`` are duck-typed.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any

from app.services.vip_memo_gen.schema import SECTION_KEYS

BUCKET = "vip-memos"
STATUSES = ("queued", "running", "ready", "failed", "failed_budget")
_SNAP_FIELDS = ("ask", "instrument", "sector", "stage", "location", "team")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _rows(res: Any) -> list[dict]:
    return list(getattr(res, "data", None) or [])


def create_memo_version(client, application_id: str, native_track: str,
                        triggered_by: str | None) -> dict:
    existing = _rows(
        client.table("vip_memos").select("version")
        .eq("application_id", application_id).eq("native_track", native_track).execute()
    )
    version = max((r["version"] for r in existing), default=0) + 1
    res = client.table("vip_memos").insert({
        "application_id": application_id,
        "native_track": native_track,
        "version": version,
        "status": "queued",
        "is_current": False,
        "triggered_by": triggered_by,
    }).execute()
    return _rows(res)[0]


def set_status(client, memo_id: str, status: str, error: str | None = None) -> None:
    if status not in STATUSES:
        raise ValueError(f"invalid memo status: {status!r}")
    client.table("vip_memos").update(
        {"status": status, "error": error, "updated_at": _now()}
    ).eq("id", memo_id).execute()


def persist_memo(client, memo_id: str, memo: dict) -> None:
    snap = memo["snapshot"]
    rec = memo.get("recommendation") or {}
    header: dict[str, Any] = {
        "schema_version": 2,
        "name": memo.get("name"),
        "headline": memo.get("headline"),
        "in_short": memo.get("in_short"),
        "plain": memo.get("plain"),
        "prepared_by": memo.get("prepared_by"),
        "generated_at": memo.get("generated_at"),
        "ic_date": snap.get("ic_date"),
        "rec_verdict": rec.get("verdict"),
        "rec_summary": rec.get("summary"),
        "rec_conditions": rec.get("conditions"),
        "figures": memo.get("figures"),
        "know": memo.get("know"),
        "check": memo.get("check"),
        "memo_json": memo,
        "updated_at": _now(),
    }
    for f in _SNAP_FIELDS:
        item = snap.get(f) or {}
        header[f"{f}_value"] = item.get("value")
        header[f"{f}_note"] = item.get("note")

    # Re-persisting the same memo replaces its child rows rather than doubling them.
    client.table("vip_memo_sections").delete().eq("memo_id", memo_id).execute()
    client.table("vip_memo_questions").delete().eq("memo_id", memo_id).execute()

    client.table("vip_memos").update(header).eq("id", memo_id).execute()

    takeaways = memo.get("takeaways") or {}
    sources = memo.get("sources") or {}
    client.table("vip_memo_sections").insert([
        {
            "memo_id": memo_id,
            "section_key": key,
            "position": i,
            "takeaway": takeaways.get(key),
            "source_note": sources.get(key),
            "body": memo["sections"][key],
        }
        for i, key in enumerate(SECTION_KEYS)
    ]).execute()

    questions = memo.get("questions") or []
    if questions:
        client.table("vip_memo_questions").insert([
            {"memo_id": memo_id, "position": i, "question": q}
            for i, q in enumerate(questions)
        ]).execute()

    set_status(client, memo_id, "ready")
    client.rpc("vip_memo_make_current", {"p_memo_id": memo_id}).execute()


def record_run(client, memo_id: str, step: str, model: str, usage: Any,
               duration_ms: int, ok: bool, error: str | None) -> None:
    client.table("vip_memo_runs").insert({
        "memo_id": memo_id,
        "step": step,
        "model": model,
        "input_tokens": getattr(usage, "input_tokens", 0) or 0,
        "output_tokens": getattr(usage, "output_tokens", 0) or 0,
        "reasoning_tokens": getattr(usage, "reasoning_tokens", 0) or 0,
        "web_searches": getattr(usage, "web_searches", 0) or 0,
        "cost_usd": float(getattr(usage, "cost_usd", 0) or 0),
        "duration_ms": duration_ms,
        "ok": ok,
        "error": error,
    }).execute()


def spent_usd(client, memo_id: str) -> float:
    rows = _rows(client.table("vip_memo_runs").select("cost_usd").eq("memo_id", memo_id).execute())
    return float(sum(float(r.get("cost_usd") or 0) for r in rows))


def record_inputs(client, memo_id: str, inputs: list) -> None:
    if not inputs:
        return
    client.table("vip_memo_inputs").insert([
        {
            "memo_id": memo_id,
            "kind": i.kind,
            "bucket": i.bucket,
            "path": i.path,
            "mime": i.mime,
            "method": i.method,
            "chars_used": i.chars_used,
            "truncated": bool(i.truncated),
            "skipped_reason": i.skipped_reason,
        }
        for i in inputs
    ]).execute()


def record_sources(client, memo_id: str, sources: list[dict]) -> None:
    if not sources:
        return
    client.table("vip_memo_sources").insert([
        {
            "memo_id": memo_id,
            "section_key": s.get("section_key"),
            "title": s.get("title"),
            "publisher": s.get("publisher"),
            "url": s.get("url"),
            "year": None if s.get("year") is None else str(s["year"]),
            "claim": s.get("claim"),
        }
        for s in sources
    ]).execute()


def record_export(client, memo_id: str, fmt: str, bucket: str, path: str, data: bytes) -> None:
    client.table("vip_memo_exports").insert({
        "memo_id": memo_id,
        "format": fmt,
        "bucket": bucket,
        "path": path,
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
    }).execute()


def get_memo(client, memo_id: str) -> dict | None:
    rows = _rows(client.table("vip_memos").select("*").eq("id", memo_id).limit(1).execute())
    return rows[0] if rows else None


def current_ready(client, application_id: str) -> dict | None:
    rows = _rows(
        client.table("vip_memos").select("*")
        .eq("application_id", application_id).eq("is_current", True).eq("status", "ready")
        .limit(1).execute()
    )
    return rows[0] if rows else None


def latest_for_app(client, application_id: str) -> list[dict]:
    rows = _rows(
        client.table("vip_memos").select("*").eq("application_id", application_id)
        .order("version", desc=True).execute()
    )
    return sorted(rows, key=lambda r: r["version"], reverse=True)
