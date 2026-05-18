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

from ..rbac import require_capability

log = logging.getLogger(__name__)

router = APIRouter(prefix="/reviewer", tags=["reviewer"])


@router.get(
    "/assignments",
    dependencies=[Depends(require_capability("view_assigned_apps"))],
)
async def list_assignments() -> dict:
    """Placeholder — fully implemented in Task 2."""
    return {"assignments": []}
