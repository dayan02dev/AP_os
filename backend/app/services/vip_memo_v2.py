"""VIP memo v2 ("Navigator") - read access to generated (or bundled) memos.

Serving order for any VIP application: the current ready row in ``vip_memos``
(``memo_json``, written by the generator), then a bundled
``app/data/vip_memo_v2/<application_id>.json`` (the two hand-built pilot memos;
confidential and gitignored, so they only exist on the deploying machine).
Every memo is validated with ``schema.parse_memo`` before it is served.
Nothing here generates content. The IC recommendation never leaves the server:
callers return ``public_view(memo)``.
"""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

from ..supabase_client import get_admin_client
from . import vip_memo_v2_export
from .vip_memo_gen import store
from .vip_memo_gen.schema import MemoValidationError, memo_to_dict, parse_memo
from .vip_memo_gen.tags import retag

log = logging.getLogger(__name__)

BUNDLED_DIR = Path(__file__).resolve().parent.parent / "data" / "vip_memo_v2"


def app_lookup(app_id: str) -> tuple[str, str, str | None] | None:
    """(native, effective, status) for an application id, or None if unknown.

    Effective is ``moved_to_track or native``. A TIR application moved to VIP
    lives in ``tir_applications``, so both tables are checked (sip first).
    Never raises."""
    try:
        sb = get_admin_client()
        for native in ("sip", "tir"):
            rows = (
                sb.table(f"{native}_applications").select("id,moved_to_track,status")
                .eq("id", app_id).limit(1).execute().data
            ) or []
            if rows:
                return native, rows[0].get("moved_to_track") or native, rows[0].get("status")
    except Exception:
        log.exception("vip memo v2 track lookup failed", extra={"application_id": app_id})
    return None


def track_info(app_id: str) -> tuple[str, str] | None:
    """(native, effective) track for an application id, or None if unknown."""
    info = app_lookup(app_id)
    return (info[0], info[1]) if info else None


def effective_track(app_id: str) -> str | None:
    info = track_info(app_id)
    return info[1] if info else None


def is_vip_app(app_id: str) -> bool:
    return effective_track(app_id) == "sip"


def _stored_memo(app_id: str) -> tuple[dict[str, Any], str | None] | None:
    try:
        row = store.current_ready(get_admin_client(), app_id)
    except Exception:
        log.exception("vip memo v2 read failed", extra={"application_id": app_id})
        return None
    memo = row.get("memo_json") if row else None
    return (memo, row.get("id")) if isinstance(memo, dict) else None


def _bundled_memo(app_id: str) -> dict[str, Any] | None:
    path = BUNDLED_DIR / f"{app_id}.json"
    try:
        if not path.is_file():
            return None
        memo = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        log.exception("vip memo v2 bundled file unreadable", extra={"application_id": app_id})
        return None
    return memo if isinstance(memo, dict) else None


def load_memo_v2(app_id: str) -> tuple[dict[str, Any], str | None] | None:
    """(validated memo incl. recommendation, id of the vip_memos row it came
    from, or None when it came from the bundled file). Order: current ready DB
    memo, then the bundled file. Never raises."""
    bundled = _bundled_memo(app_id)
    for found in (_stored_memo(app_id), (bundled, None) if bundled is not None else None):
        if found is None:
            continue
        memo, memo_id = found
        try:
            return retag(memo_to_dict(parse_memo(memo)))[0], memo_id
        except MemoValidationError as exc:
            log.warning("vip memo v2 has an invalid shape",
                        extra={"application_id": app_id, "errors": exc.messages[:5]})
    return None


def get_memo_v2(app_id: str) -> dict[str, Any] | None:
    loaded = load_memo_v2(app_id)
    return loaded[0] if loaded else None


def public_view(memo: dict[str, Any]) -> dict[str, Any]:
    """A copy of ``memo`` without the IC recommendation (never served)."""
    return {k: v for k, v in memo.items() if k != "recommendation"}


def stored_export(memo_id: str | None, fmt: str) -> bytes | None:
    """The pre-rendered export of the served ``vip_memos`` row from the
    ``vip-memos`` bucket, or None (always None for a bundled-file memo)."""
    if not memo_id:
        return None
    try:
        sb = get_admin_client()
        exports = (
            sb.table("vip_memo_exports").select("bucket,path")
            .eq("memo_id", memo_id).eq("format", fmt)
            .order("created_at", desc=True).limit(1).execute().data
        ) or []
        if not exports:
            return None
        data = sb.storage.from_(exports[0].get("bucket") or store.BUCKET).download(exports[0]["path"])
        return bytes(data) if data else None
    except Exception:
        log.exception("vip memo v2 stored export unavailable", extra={"memo_id": memo_id})
        return None


def export_for(memo_id: str | None, memo: dict[str, Any], fmt: str) -> tuple[bytes, str]:
    """(body, media type): the stored export if there is one, else rendered now."""
    stored = stored_export(memo_id, fmt)
    if stored is not None:
        media = vip_memo_v2_export.DOCX_MEDIA if fmt == "docx" else "application/pdf"
        return stored, media
    return vip_memo_v2_export.render(memo, fmt)


def download_filename(memo: dict[str, Any], ext: str) -> str:
    """``<Name>_IC_Memo.<ext>`` with the name reduced to filename-safe characters."""
    name = re.sub(r"[^A-Za-z0-9]+", "_", str(memo.get("name") or "")).strip("_") or "VIP"
    return f"{name}_IC_Memo.{ext}"
