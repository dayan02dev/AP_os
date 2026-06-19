"""Edit-after-submit window: is a submitted application still editable?"""
from __future__ import annotations

from datetime import datetime, timezone

from ..config import settings

_DEADLINE_ATTR = {"tir": "edit_deadline_tir", "sip": "edit_deadline_sip"}


def edit_deadline_for(track: str) -> datetime:
    raw = getattr(settings, _DEADLINE_ATTR[track])
    return datetime.fromisoformat(raw)


def is_edit_open(track: str, now: datetime | None = None) -> bool:
    now = now or datetime.now(timezone.utc)
    return now < edit_deadline_for(track)
