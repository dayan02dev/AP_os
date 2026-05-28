"""Leadership dashboard — write endpoints.

Mounted under `/leadership/applications/{application_id}/...`:

    DELETE /reviewers/{reviewer_user_id}        unassign a reviewer

The status-change (`PATCH /status`, `GET /legal-next-statuses`) and
reviewer-assignment (`POST /reviewers`) endpoints were removed from the
leadership surface. Only reviewer un-assignment remains — it's still used by
the review page's Reviewers tab. The canonical status state machine lives in
`services/state_machine.py` and is still used by the reviewer flow.

Track is server-inferred via `applications_query.find_application_with_track`
to match the read side; the frontend never needs to pass it.

The write best-effort calls `write_audit(...)` so audit failures can't roll
back the primary mutation.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from ..deps import get_current_user
from ..rbac import require_capability
from ..services import applications_query
from ..services.audit import write_audit
from ..supabase_client import get_admin_client

log = logging.getLogger(__name__)

router = APIRouter(prefix="/leadership/applications", tags=["leadership-actions"])


# ─── Helpers ────────────────────────────────────────────────────────────


def _resolve_app(application_id: str) -> tuple[str, dict[str, Any]]:
    """Resolve `(track, row)` for ``application_id`` or raise 404.

    Re-uses the read-side helper so both sides see the same "track" answer
    for any given id. The probe is cheap (PK lookup on each track table).
    """
    found = applications_query.find_application_with_track(application_id)
    if found is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "application_not_found", "application_id": application_id},
        )
    return found


# ─── Reviewer un-assignment ────────────────────────────────────────────


@router.delete(
    "/{application_id}/reviewers/{reviewer_user_id}",
    dependencies=[Depends(require_capability("assign_reviewers"))],
)
async def unassign_reviewer(
    application_id: str,
    reviewer_user_id: str,
    current_user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Hard-delete a reviewer's assignment row.

    Hard-delete (not soft) so the UNIQUE(application_id, application_track,
    reviewer_user_id) constraint lets the same reviewer be re-assigned
    later without history surgery.

    Phase 1 guard: if a corresponding row in `reviews` is already submitted,
    refuse (409 ``review_already_submitted``). The reviewer's scored work
    stays intact; surfacing this lets the leader course-correct gracefully.
    """
    track, _row = _resolve_app(application_id)

    # Block if the reviewer has already submitted a review for this app —
    # we don't want to orphan a submitted score by deleting the assignment.
    try:
        rev = (
            get_admin_client()
            .table("reviews")
            .select("id,status")
            .eq("application_id", application_id)
            .eq("application_track", track)
            .eq("reviewer_user_id", reviewer_user_id)
            .eq("status", "submitted")
            .limit(1)
            .execute()
        )
        if rev.data:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "review_already_submitted",
                    "message": "This reviewer has already submitted a review; their assignment can't be revoked.",
                },
            )
    except HTTPException:
        raise
    except Exception:
        # Reads on `reviews` failing here is non-fatal — log and let the
        # delete proceed. (We've made our best effort to guard.)
        log.warning(
            "unassign_reviewer: pre-check on reviews failed; continuing",
            extra={
                "application_id": application_id,
                "track": track,
                "reviewer_user_id": reviewer_user_id,
            },
            exc_info=True,
        )

    try:
        res = (
            get_admin_client()
            .table("reviewer_assignments")
            .delete()
            .eq("application_id", application_id)
            .eq("application_track", track)
            .eq("reviewer_user_id", reviewer_user_id)
            .execute()
        )
        deleted_rows = res.data or []
    except Exception as exc:
        log.exception(
            "unassign_reviewer delete failed",
            extra={
                "application_id": application_id,
                "track": track,
                "reviewer_user_id": reviewer_user_id,
            },
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": "unassign_failed", "message": str(exc)[:200]},
        ) from exc

    write_audit(
        actor_user_id=current_user["user_id"],
        actor_role="leadership",
        action_type="reviewer.unassigned",
        target_table="reviewer_assignments",
        target_id=application_id,
        before={"track": track, "reviewer_user_id": reviewer_user_id},
    )

    return {
        "ok": True,
        "application_id": application_id,
        "track": track,
        "reviewer_user_id": reviewer_user_id,
        "deleted": bool(deleted_rows),
    }


__all__ = ["router"]
