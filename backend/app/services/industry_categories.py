"""Industry taxonomy service.

Single source of truth for the `industry_categories` table. Used by:
  - the AI screener worker (passes the list to the LLM prompt + inserts
    LLM-proposed new categories under the cap)
  - the `backfill_industry.py` script
  - the `GET /leadership/industry-categories` endpoint

Cap = 12 (spec §3a). Once 12 rows exist, `create_category_if_under_cap`
refuses to insert and returns False; callers must fall back to an existing
category (typically `other`).
"""

from __future__ import annotations

import logging
from typing import Any

from ..supabase_client import get_admin_client

log = logging.getLogger(__name__)

# Hard cap on the number of industry_categories rows (spec §3a).
CATEGORY_CAP = 12


def fetch_categories() -> list[dict[str, Any]]:
    """Return all rows from `industry_categories`.

    Ordered by `is_seed DESC` first (seeds appear first) then `created_at ASC`
    (oldest non-seed first). Returns an empty list on query error so callers
    can fall back without 500-ing the request.
    """
    try:
        res = (
            get_admin_client()
            .table("industry_categories")
            .select("id,label,is_seed,created_at,created_by_app_id")
            .order("is_seed", desc=True)
            .order("created_at", desc=False)
            .execute()
        )
        return res.data or []
    except Exception as exc:
        log.warning(
            "industry_categories.fetch_categories failed",
            extra={"err": str(exc)},
        )
        return []


def create_category_if_under_cap(
    *,
    category_id: str,
    label: str,
    created_by_app_id: str | None,
) -> bool:
    """Race-safe-ish insert.

    Returns True if the new row was inserted, False if the table is at or
    over the cap. The cap check is best-effort (read-then-write): under a
    high write rate two concurrent callers could both decide they're under
    cap and both insert, briefly producing 13 rows. Acceptable for Phase 1
    — the LLM is conservative about proposing new categories so the race
    window is small.
    """
    existing = fetch_categories()
    if len(existing) >= CATEGORY_CAP:
        log.info(
            "create_category_if_under_cap refused (cap=%d already met)",
            CATEGORY_CAP,
        )
        return False

    try:
        (
            get_admin_client()
            .table("industry_categories")
            .insert(
                {
                    "id": category_id,
                    "label": label,
                    "created_by_app_id": created_by_app_id,
                    "is_seed": False,
                },
            )
            .execute()
        )
        return True
    except Exception as exc:
        log.warning(
            "industry_categories.create_category_if_under_cap failed",
            extra={"id": category_id, "err": str(exc)},
        )
        return False


def categories_with_counts() -> dict[str, Any]:
    """Compose the payload used by `GET /leadership/industry-categories`.

    Returns:
        {
          "categories": [{"id", "label", "count"}, ...]
                        sorted by count desc, is_seed desc, id asc;
                        empty categories (count = 0) are hidden,
          "total":      sum of all counts,
          "cap":        CATEGORY_CAP,
          "remaining_slots": CATEGORY_CAP - len(all_categories)
        }
    """
    cats = fetch_categories()
    try:
        res = (
            get_admin_client()
            .table("ai_screening")
            .select("industry_category_id")
            .not_.is_("industry_category_id", "null")
            .limit(50_000)
            .execute()
        )
        rows = res.data or []
    except Exception as exc:
        log.warning(
            "industry_categories.categories_with_counts query failed",
            extra={"err": str(exc)},
        )
        rows = []

    counts: dict[str, int] = {}
    for r in rows:
        cid = r.get("industry_category_id")
        if cid:
            counts[cid] = counts.get(cid, 0) + 1

    by_id = {c["id"]: c for c in cats}
    visible: list[dict[str, Any]] = []
    for cid, n in counts.items():
        cat = by_id.get(cid)
        if not cat:
            continue
        visible.append(
            {
                "id": cid,
                "label": cat["label"],
                "count": n,
                "is_seed": bool(cat.get("is_seed", False)),
            }
        )

    visible.sort(key=lambda c: (-c["count"], not c["is_seed"], c["id"]))
    return {
        "categories": [
            {"id": c["id"], "label": c["label"], "count": c["count"]}
            for c in visible
        ],
        "total": sum(counts.values()),
        "cap": CATEGORY_CAP,
        "remaining_slots": max(0, CATEGORY_CAP - len(cats)),
    }
