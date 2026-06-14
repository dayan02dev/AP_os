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

from ..deps import get_current_user
from ..rbac import require_capability
from ..services import admin_query
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
