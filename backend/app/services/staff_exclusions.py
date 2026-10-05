"""Applications hidden from every staff-facing view.

Internal Founder Portal test ventures live in the real application tables so
the founder side works end to end, but they must not show up in any admin /
leadership / reviewer / jury count, list or queue. Staff read paths drop them
with ``visible()``; founder / applicant code never imports this module.

Ids come from ``STAFF_EXCLUDED_APPLICATION_IDS`` (see ``config.Settings``).
"""

from __future__ import annotations

from typing import Any, Iterable

from ..config import settings

STAFF_EXCLUDED_APPLICATION_IDS: frozenset[str] = frozenset(
    i.strip() for i in settings.staff_excluded_application_ids.split(",") if i.strip()
)


def is_excluded(application_id: Any) -> bool:
    return application_id in STAFF_EXCLUDED_APPLICATION_IDS


def visible(rows: Iterable[dict] | None, key: str = "id") -> list[dict]:
    """``rows`` minus those whose ``row[key]`` is a staff-excluded app id."""
    return [r for r in rows or [] if r.get(key) not in STAFF_EXCLUDED_APPLICATION_IDS]
