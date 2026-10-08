"""VIP memo v2 ("Navigator") — read-only access to the pre-built memo JSON.

The memo is prepared offline and stored at ``ai_screening.sections.vip_memo_v2``
on the ``application_track = 'sip'`` row. Only the pilot applications in
``vip_memo.PILOT_APPLICATION_IDS`` are served. Nothing here generates content.
"""
from __future__ import annotations

import logging
import re
from typing import Any

from ..supabase_client import get_admin_client
from .vip_memo import PILOT_APPLICATION_IDS

log = logging.getLogger(__name__)

SECTION_KEYS = (
    "what", "why", "product", "tech", "competitors",
    "market", "team", "milestones", "funds", "risks",
)


def _valid(memo: Any) -> bool:
    if not isinstance(memo, dict) or memo.get("version") != 2:
        return False
    if not isinstance(memo.get("name"), str) or not memo["name"].strip():
        return False
    sections = memo.get("sections")
    if not isinstance(sections, dict):
        return False
    return all(isinstance(sections.get(k), dict) for k in SECTION_KEYS)


def get_memo_v2(app_id: str) -> dict[str, Any] | None:
    """Return the stored v2 memo for a pilot VIP app, or None. Never raises."""
    if app_id not in PILOT_APPLICATION_IDS:
        return None
    try:
        rows = (
            get_admin_client()
            .table("ai_screening")
            .select("sections")
            .eq("application_id", app_id)
            .eq("application_track", "sip")
            .limit(1)
            .execute()
            .data
        ) or []
        sections = rows[0].get("sections") if rows else None
        memo = sections.get("vip_memo_v2") if isinstance(sections, dict) else None
        if memo is None:
            return None
        if not _valid(memo):
            log.warning("vip memo v2 has an invalid shape", extra={"application_id": app_id})
            return None
        return memo
    except Exception:
        log.exception("vip memo v2 read failed", extra={"application_id": app_id})
        return None


def download_filename(memo: dict[str, Any], ext: str) -> str:
    """``<Name>_IC_Memo.<ext>`` with the name reduced to filename-safe characters."""
    name = re.sub(r"[^A-Za-z0-9]+", "_", str(memo.get("name") or "")).strip("_") or "VIP"
    return f"{name}_IC_Memo.{ext}"
