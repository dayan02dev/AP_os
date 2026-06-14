"""Admin-portal pipeline + detail router (Task 6).

Two read endpoints that back the admin Pipeline view:

    GET /admin/platform/applications
        Cross-track pipeline list with admin-portal joins (latest decision,
        hide/archive meta, batch). Hidden/archived excluded by default.

    GET /admin/platform/applications/{track}/{application_id}
        Full application detail + admin decision/meta/batch.

Both wrap `services.admin_query`, which reuses the leadership/applications_query
helpers so the query logic lives in one place. Guarded by the same leadership
capabilities (`view_all_apps` / `view_app_detail`) that admins also hold — see
`rbac.ROLE_CAPABILITIES`.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from pydantic import BaseModel, ConfigDict, Field

from ..deps import get_current_user
from ..rbac import require_capability
from ..services import admin_query, decisions
from ..supabase_client import get_admin_client  # noqa: F401  (test monkeypatch hook)

router = APIRouter(prefix="/admin/platform", tags=["admin-platform"])


@router.get(
    "/applications",
    dependencies=[Depends(require_capability("view_all_apps"))],
)
async def list_pipeline(
    track: str | None = None,
    status: str | None = None,
    industry: str | None = None,
    decision: str | None = None,
    batch_id: str | None = None,
    search: str | None = None,
    include_hidden: bool = False,
    include_archived: bool = False,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Admin pipeline list with decision / meta / batch joins."""
    return admin_query.fetch_pipeline({
        "track":            track,
        "status":           status,
        "industry":         industry,
        "decision":         decision,
        "batch_id":         batch_id,
        "search":           search,
        "include_hidden":   include_hidden,
        "include_archived": include_archived,
    })


@router.get(
    "/applications/{track}/{application_id}",
    dependencies=[Depends(require_capability("view_app_detail"))],
)
async def get_detail(
    track: Literal["tir", "sip"],
    application_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Full admin detail for one application; 404 if not found."""
    payload = admin_query.fetch_detail(track, application_id)
    if payload is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail={"code": "application_not_found"},
        )
    return payload


class DecisionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: Literal["shortlisted", "on_hold", "rejected", "waitlisted"]
    rationale: str | None = None


@router.post(
    "/applications/{track}/{application_id}/decision",
    dependencies=[Depends(require_capability("decide_application"))],
)
async def decide(
    track: Literal["tir", "sip"],
    application_id: str,
    body: DecisionBody,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Gate-1 admin decision: guarded status change + admin_decisions + audit.

    Reject / waitlist / hold require a rationale; shortlist may omit one.
    """
    if body.decision in ("rejected", "waitlisted", "on_hold") and not (body.rationale or "").strip():
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "rationale_required",
                "message": "A rationale is required for reject / waitlist / hold.",
            },
        )
    return decisions.record_decision(
        track=track, application_id=application_id,
        decision=body.decision, rationale=body.rationale,
        decided_by=user["user_id"],
    )


class BulkDecisionItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    track: Literal["tir", "sip"]
    application_id: str
    decision: Literal["shortlisted", "on_hold", "rejected", "waitlisted"]
    rationale: str | None = None


class BulkDecisionBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    items: list[BulkDecisionItem] = Field(..., min_length=1, max_length=200)


@router.post("/decisions/bulk", dependencies=[Depends(require_capability("decide_application"))])
async def bulk_decide(body: BulkDecisionBody, user: dict = Depends(get_current_user)) -> dict:
    """Bulk gate-1 decisions: per-id result dict instead of raising on individual failures."""
    results = [
        decisions.record_decision_safe(
            track=i.track, application_id=i.application_id,
            decision=i.decision, rationale=i.rationale,
            decided_by=user["user_id"],
        )
        for i in body.items
    ]
    return {"results": results}
