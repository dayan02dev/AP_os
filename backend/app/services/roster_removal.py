"""Remove a reviewer / juror from the roster (admin "Delete" action).

WHAT "DELETE" MEANS HERE — and why it is NOT an auth-user delete
---------------------------------------------------------------
`reviews.reviewer_user_id`, `jury_selections.juror_user_id` and
`jury_assignments.juror_user_id` are all ``references auth.users(id) ON DELETE
CASCADE`` (migrations 014 / 033). Deleting the Supabase auth user would
therefore silently take every review and score that person ever submitted with
it — the exact opposite of the requirement ("their reviews and scoring stay,
only their assignments are released").

So a delete here is a **de-rostering**:

  reviewer                                  juror
  ─────────────────────────────────────     ────────────────────────────────────
  · revoke the `reviewer` role              · revoke the `jury` role
  · delete ALL reviewer_assignments         · delete ALL jury_assignments
    (the app is released from THIS            (each app is released from THIS
     reviewer only; other reviewers and        juror only)
     the batch itself are untouched)        · delete their jury_selections (picks)
  · delete batch_reviewers memberships        and jury_recommendations
  · delete the reviewer_profiles row        · delete the jury_profiles row
  · KEEP every `reviews` row                · delete the jury_invites row (+ its
                                              jury_responses via ON DELETE
                                              CASCADE) so the address can be
                                              invited again

The auth account and the `profiles` row survive in both cases. A person who
holds another role (e.g. `udita@` is admin + leadership + jury) keeps that
access — only the one role being removed goes away.

Every helper takes the Supabase client so tests can drive an in-memory double.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import HTTPException, status

log = logging.getLogger(__name__)


# ─── shared helpers ──────────────────────────────────────────────────────


def _roles_of(sb: Any, user_id: str) -> set[str]:
    """Roles currently granted to ``user_id`` (empty set on a read failure)."""
    try:
        rows = sb.table("user_roles").select("*").eq("user_id", user_id).execute().data or []
    except Exception as exc:  # noqa: BLE001
        log.warning("roster_removal: user_roles read failed",
                    extra={"user_id": user_id, "err": str(exc)})
        return set()
    # The fake client honours .eq(), prod PostgREST narrows server-side — but
    # re-filter anyway so neither backend can widen the set.
    return {r.get("role") for r in rows if r.get("user_id") == user_id and r.get("role")}


def _delete_where(sb: Any, table: str, filters: dict[str, Any]) -> int:
    """Delete rows matching ``filters``; return how many went. Best-effort.

    A failure is logged and counted as 0 rather than raised: the caller has
    already revoked the role, and leaving one orphan child row is far better
    than a half-applied delete that 500s.
    """
    try:
        q = sb.table(table).delete()
        for col, val in filters.items():
            q = q.eq(col, val)
        return len(q.execute().data or [])
    except Exception as exc:  # noqa: BLE001
        log.warning("roster_removal: delete failed",
                    extra={"table": table, "filters": filters, "err": str(exc)})
        return 0


def _count_where(sb: Any, table: str, col: str, val: Any) -> int:
    try:
        rows = sb.table(table).select("*").eq(col, val).execute().data or []
    except Exception as exc:  # noqa: BLE001
        log.warning("roster_removal: count failed",
                    extra={"table": table, "err": str(exc)})
        return 0
    return len([r for r in rows if r.get(col) == val])


def _profile_email(sb: Any, user_id: str) -> str | None:
    try:
        rows = sb.table("profiles").select("*").eq("id", user_id).limit(1).execute().data or []
    except Exception:  # noqa: BLE001
        return None
    for r in rows:
        if r.get("id") == user_id:
            return (r.get("email") or "").strip().lower() or None
    return None


# ─── reviewer ────────────────────────────────────────────────────────────


def remove_reviewer(sb: Any, user_id: str, *, actor: str | None = None) -> dict[str, Any]:
    """De-roster a reviewer. 404 ``not_a_reviewer`` if they never held the role.

    Returns the counters the UI reports back to the admin.
    """
    if "reviewer" not in _roles_of(sb, user_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "not_a_reviewer",
                    "message": "That user is not on the reviewer roster."},
        )

    # Count the reviews BEFORE anything else so the response can state plainly
    # how much scored work was preserved.
    reviews_kept = _count_where(sb, "reviews", "reviewer_user_id", user_id)

    assignments_removed = _delete_where(
        sb, "reviewer_assignments", {"reviewer_user_id": user_id})
    batches_detached = _delete_where(
        sb, "batch_reviewers", {"reviewer_user_id": user_id})
    _delete_where(sb, "reviewer_profiles", {"reviewer_user_id": user_id})
    _delete_where(sb, "user_roles", {"user_id": user_id, "role": "reviewer"})

    remaining = sorted(_roles_of(sb, user_id))
    log.info("reviewer de-rostered",
             extra={"user_id": user_id, "actor": actor,
                    "assignments_removed": assignments_removed,
                    "reviews_kept": reviews_kept})
    return {
        "user_id": user_id,
        "assignments_removed": assignments_removed,
        "batches_detached": batches_detached,
        "reviews_kept": reviews_kept,
        "remaining_roles": remaining,
        "account_retained": True,
    }


# ─── juror ───────────────────────────────────────────────────────────────


def remove_juror(sb: Any, user_id: str, *, actor: str | None = None) -> dict[str, Any]:
    """De-roster a jury member. 404 ``not_a_juror`` if they never held the role.

    The ``jury_invites`` row goes too (and ``jury_responses`` with it, via ON
    DELETE CASCADE) so the same address can be invited again — ``jury_invites``
    has a UNIQUE index on ``lower(email)``, and leaving the row behind would
    make every re-invite come back ``already_invited`` with no email sent.
    """
    if "jury" not in _roles_of(sb, user_id):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "not_a_juror",
                    "message": "That user is not on the jury roster."},
        )

    # Resolve the invite BEFORE deleting the profile that points at it.
    invite_id: str | None = None
    try:
        rows = (sb.table("jury_profiles").select("*")
                .eq("juror_user_id", user_id).limit(1).execute().data) or []
        for r in rows:
            if r.get("juror_user_id") == user_id:
                invite_id = r.get("invite_id")
                break
    except Exception as exc:  # noqa: BLE001
        log.warning("roster_removal: jury_profiles read failed",
                    extra={"user_id": user_id, "err": str(exc)})

    assignments_removed = _delete_where(
        sb, "jury_assignments", {"juror_user_id": user_id})
    picks_removed = _delete_where(
        sb, "jury_selections", {"juror_user_id": user_id})
    _delete_where(sb, "jury_recommendations", {"juror_user_id": user_id})
    _delete_where(sb, "jury_profiles", {"juror_user_id": user_id})

    invite_removed = 0
    if invite_id:
        invite_removed = _delete_where(sb, "jury_invites", {"id": invite_id})
    if not invite_removed:
        # No profile→invite link (or it was already gone): fall back to the
        # address, which is what the UNIQUE index actually guards.
        email = _profile_email(sb, user_id)
        if email:
            invite_removed = _delete_where(sb, "jury_invites", {"email": email})

    _delete_where(sb, "user_roles", {"user_id": user_id, "role": "jury"})

    remaining = sorted(_roles_of(sb, user_id))
    log.info("juror de-rostered",
             extra={"user_id": user_id, "actor": actor,
                    "assignments_removed": assignments_removed,
                    "picks_removed": picks_removed})
    return {
        "user_id": user_id,
        "assignments_removed": assignments_removed,
        "picks_removed": picks_removed,
        "invite_removed": bool(invite_removed),
        "remaining_roles": remaining,
        "account_retained": True,
    }
