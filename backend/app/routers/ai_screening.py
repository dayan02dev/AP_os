"""Admin endpoint to run AI scoring against one or more applications.

POST /admin/ai-screening/run
  Body (any one of):
    {"application_id": "<uuid>", "track": "tir"}   — single app
    {"limit": 50, "track": "tir"}                  — first N apps
    {"all": true, "track": "tir"}                  — every app

Requires capability `manage_users` (admin role; conservative gate while
we evaluate the pipeline's behaviour. Loosen to `view_app_detail` once
we trust it for general leadership re-runs.)
"""
from __future__ import annotations

import logging
import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..rbac import require_capability
from ..services.ai_scoring.runner import score_application
from ..supabase_client import get_admin_client

log = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/ai-screening", tags=["ai-screening"])


class RunRequest(BaseModel):
    application_id: str | None = None
    limit: int | None = Field(default=None, ge=1, le=500)
    all: bool = False
    track: str = Field(default="tir", pattern="^(tir|sip)$")


@router.post(
    "/run",
    dependencies=[Depends(require_capability("manage_users"))],
)
async def run_ai_screening(body: RunRequest) -> dict[str, Any]:
    if os.environ.get("AI_SCORING_ENABLED", "false").lower() != "true":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "ai_scoring_disabled",
                    "message": "AI_SCORING_ENABLED env var is not set to 'true'."},
        )
    if body.track != "tir":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "track_unsupported",
                    "message": "v1 only supports the TIR track."},
        )

    sb = get_admin_client()

    # Resolve target ID list
    if body.application_id:
        target_ids = [body.application_id]
    elif body.all or body.limit:
        q = sb.table(f"{body.track}_applications").select("id")
        if body.limit:
            q = q.limit(body.limit)
        res = q.execute()
        target_ids = [r["id"] for r in (res.data or [])]
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "missing_target",
                    "message": "Provide one of: application_id, limit, or all=true."},
        )

    results: list[dict] = []
    for app_id in target_ids:
        try:
            final = score_application(
                application_id=app_id, track=body.track, supabase=sb,
            )
            results.append({
                "application_id": app_id,
                "ok": True,
                "composite_percentage": final.get("composite_percentage"),
                "strength_label": final.get("strength_label"),
                "needs_human_review": bool(final.get("qg_needs_human_review", False)),
            })
        except Exception as exc:
            log.exception("Scoring failed for %s", app_id)
            results.append({
                "application_id": app_id, "ok": False,
                "error": str(exc)[:200],
            })

    return {"track": body.track, "count": len(results), "results": results}
