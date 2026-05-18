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
from fastapi import APIRouter, Depends

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
