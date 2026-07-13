"""Admin track-move: reversible TIR<->VIP reclassification FLAG.

This is a flag, not a data migration — the application row stays in its own
table with its original answers; we only stamp moved_to_track / moved_at /
moved_by so the admin UI can highlight a reclassified application. Calling it
again on an already-moved app clears the flag (move back)."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import HTTPException, status

from ..supabase_client import get_admin_client
from .audit import write_audit

_OTHER = {"tir": "sip", "sip": "tir"}


def move_track(*, track: str, application_id: str, actor_user_id: str,
               actor_role: str | None = None) -> dict:
    """Toggle the track-move flag on one application. 422 on bad track, 404 if
    the app is missing. Returns the new `moved_to_track` (None == moved back)."""
    if track not in _OTHER:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                            detail={"code": "invalid_track"})
    sb = get_admin_client()
    table = f"{track}_applications"
    rows = (
        sb.table(table).select("id,moved_to_track").eq("id", application_id).limit(1).execute().data
        or []
    )
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                            detail={"code": "application_not_found"})

    if rows[0].get("moved_to_track"):
        patch = {"moved_to_track": None, "moved_at": None, "moved_by": None}
    else:
        patch = {
            "moved_to_track": _OTHER[track],
            "moved_at": datetime.now(UTC).isoformat(),
            "moved_by": actor_user_id,
        }
    sb.table(table).update(patch).eq("id", application_id).execute()

    write_audit(
        actor_user_id=actor_user_id, actor_role=actor_role or "admin",
        action_type="track_move", target_table=table, target_id=application_id,
        after={"moved_to_track": patch["moved_to_track"]},
    )
    return {"application_id": application_id, "track": track,
            "moved_to_track": patch["moved_to_track"]}
