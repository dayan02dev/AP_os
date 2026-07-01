"""Admin endpoint to (re)run AI scoring for one or more applications.

POST /admin/ai-screening/run
  {"application_id": "<uuid>", "track": "tir"}   — single app
  {"limit": 50, "track": "tir"}                  — first N apps
  {"all": true, "track": "tir"}                  — every app of the track

Requires capability `manage_users`.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..rbac import require_capability
from ..services.ai_pipeline import pipeline
from ..supabase_client import get_admin_client

log = logging.getLogger(__name__)
router = APIRouter(prefix="/admin/ai-screening", tags=["ai-screening"])


class RunRequest(BaseModel):
    application_id: str | None = None
    limit: int | None = Field(default=None, ge=1, le=500)
    all: bool = False
    track: str = Field(default="tir", pattern="^(tir|sip)$")


@router.post("/run", dependencies=[Depends(require_capability("manage_users"))])
async def run_ai_screening(body: RunRequest) -> dict[str, Any]:
    sb = get_admin_client()
    if body.application_id:
        target_ids = [body.application_id]
    elif body.all or body.limit:
        q = sb.table(f"{body.track}_applications").select("id")
        if body.limit:
            q = q.limit(body.limit)
        target_ids = [r["id"] for r in (q.execute().data or [])]
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "missing_target",
                    "message": "Provide one of: application_id, limit, or all=true."},
        )

    results: list[dict] = []
    for app_id in target_ids:
        try:
            result = pipeline.run_for_application(app_id, body.track, client=sb, no_cache=True)
            pipeline.persist(sb, app_id, body.track, result, advance_status=False)
            results.append({"application_id": app_id, "ok": True,
                            "score_overall": result.score_overall})
        except Exception as exc:
            log.exception("Scoring failed for %s", app_id)
            results.append({"application_id": app_id, "ok": False, "error": str(exc)[:200]})

    return {"track": body.track, "count": len(results), "results": results}
