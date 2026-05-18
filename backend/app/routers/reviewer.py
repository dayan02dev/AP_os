"""Reviewer endpoints (Phase 1.5).

Every endpoint guarded by `require_capability(...)`. Mutations append to
`audit_log_v2`. Privacy boundary: GET /reviewer/applications/{track}/{id}
returns ai_screening: null unless the caller has a submitted review.

Routes (built up across Tasks 1-7 of the implementation plan):

    GET    /reviewer/assignments                       inbox
    GET    /reviewer/applications/{track}/{id}         app detail (AI stripped)
    GET    /reviewer/reviews/mine?application_id=...   probe
    GET    /reviewer/reviews?mine=true&locked=true     completed list
    POST   /reviewer/reviews                           submit (or draft)
    PATCH  /reviewer/reviews/{review_id}               edit (423 after lock)
    POST   /reviewer/assignments/{id}/decline          decline with reason
"""

from __future__ import annotations

import logging
from fastapi import APIRouter, Depends, HTTPException, status as http_status

from ..deps import get_current_user
from ..rbac import require_capability
from ..services import reviewer_query
from ..supabase_client import get_admin_client

log = logging.getLogger(__name__)

router = APIRouter(prefix="/reviewer", tags=["reviewer"])


@router.get(
    "/assignments",
    dependencies=[Depends(require_capability("view_assigned_apps"))],
)
async def list_assignments(user: dict = Depends(get_current_user)) -> dict:
    return {
        "assignments": reviewer_query.fetch_inbox(user["user_id"]),
    }


@router.get(
    "/applications/{track}/{application_id}",
    dependencies=[Depends(require_capability("view_assigned_apps"))],
)
async def get_application_for_reviewer(
    track: str,
    application_id: str,
    user: dict = Depends(get_current_user),
) -> dict:
    if track not in ("tir", "sip"):
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail={"code": "invalid_track", "message": "Track must be 'tir' or 'sip'."},
        )

    payload = reviewer_query.fetch_application_for_reviewer(
        user["user_id"], track, application_id,
    )
    if payload is None:
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail={"code": "not_assigned",
                    "message": "You have no active assignment for this application."},
        )
    return payload
