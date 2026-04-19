"""GET /health — liveness + Supabase connectivity probe.

Returns {"status": "ok", "db": "ok"} when we can reach Supabase, else
{"status": "ok", "db": "error"}. The app layer is always "ok" if the request
reaches here; only the db dependency can downgrade.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter

from ..supabase_client import get_admin_client

log = logging.getLogger(__name__)

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    db = "ok"
    try:
        # `profiles` table exists from the Phase 1 migration. Limit 1 keeps
        # the payload tiny; we only care that the call succeeds.
        get_admin_client().table("profiles").select("id").limit(1).execute()
    except Exception as exc:
        log.warning("health: db probe failed", extra={"err": str(exc)})
        db = "error"
    return {"status": "ok", "db": db}
