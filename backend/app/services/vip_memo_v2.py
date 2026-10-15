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

log = logging.getLogger(__name__)

BUNDLED_DIR = Path(__file__).resolve().parent.parent / "data" / "vip_memo_v2"


def effective_track(app_id: str) -> str | None:
    """``moved_to_track or track`` for an application id, or None if unknown.

    A TIR application moved to VIP lives in ``tir_applications``, so both tables
    are checked (sip first). Never raises."""
    try:
        sb = get_admin_client()
        for native in ("sip", "tir"):
            rows = (
                sb.table(f"{native}_applications").select("id,moved_to_track")
                .eq("id", app_id).limit(1).execute().data
            ) or []
            if rows:
                return rows[0].get("moved_to_track") or native
    except Exception:
        log.exception("vip memo v2 track lookup failed", extra={"application_id": app_id})
    return None


def is_vip_app(app_id: str) -> bool:
    return effective_track(app_id) == "sip"


def _stored_memo(app_id: str) -> dict[str, Any] | None:
    try:
        row = store.current_ready(get_admin_client(), app_id)
    except Exception:
        log.exception("vip memo v2 read failed", extra={"application_id": app_id})
        return None
    memo = row.get("memo_json") if row else None
    return memo if isinstance(memo, dict) else None


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


def get_memo_v2(app_id: str) -> dict[str, Any] | None:
    """The validated v2 memo (full, including the recommendation) or None.
    Order: current ready DB memo, then the bundled file. Never raises."""
    for memo in (_stored_memo(app_id), _bundled_memo(app_id)):
        if memo is None:
            continue
        try:
            return memo_to_dict(parse_memo(memo))
        except MemoValidationError as exc:
            log.warning("vip memo v2 has an invalid shape",
                        extra={"application_id": app_id, "errors": exc.messages[:5]})
    return None


def public_view(memo: dict[str, Any]) -> dict[str, Any]:
    """A copy of ``memo`` without the IC recommendation (never served)."""
    return {k: v for k, v in memo.items() if k != "recommendation"}


def stored_export(app_id: str, fmt: str) -> bytes | None:
    """The current memo's pre-rendered export from the ``vip-memos`` bucket, or None."""
    try:
        sb = get_admin_client()
        row = store.current_ready(sb, app_id)
        if not row:
            return None
        exports = (
            sb.table("vip_memo_exports").select("bucket,path")
            .eq("memo_id", row["id"]).eq("format", fmt).limit(1).execute().data
        ) or []
        if not exports:
            return None
        data = sb.storage.from_(exports[0].get("bucket") or store.BUCKET).download(exports[0]["path"])
        return bytes(data) if data else None
    except Exception:
        log.exception("vip memo v2 stored export unavailable", extra={"application_id": app_id})
        return None


def export_for(app_id: str, memo: dict[str, Any], fmt: str) -> tuple[bytes, str]:
    """(body, media type): the stored export if there is one, else rendered now."""
    stored = stored_export(app_id, fmt)
    if stored is not None:
        media = vip_memo_v2_export.DOCX_MEDIA if fmt == "docx" else "application/pdf"
        return stored, media
    return vip_memo_v2_export.render(memo, fmt)


def download_filename(memo: dict[str, Any], ext: str) -> str:
    """``<Name>_IC_Memo.<ext>`` with the name reduced to filename-safe characters."""
    name = re.sub(r"[^A-Za-z0-9]+", "_", str(memo.get("name") or "")).strip("_") or "VIP"
    return f"{name}_IC_Memo.{ext}"
