"""Read queries for the reviewer endpoints. All reads use the admin client
(RLS-bypassing) because authorization is already enforced at the route
layer via require_capability + per-request reviewer_user_id matching.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from ..supabase_client import get_admin_client

log = logging.getLogger(__name__)


def _compose_app_identifier(track: str, app_id: str, submitted_at: str | None) -> str:
    prefix = (track or "").upper()
    year = datetime.now().year
    if submitted_at:
        try:
            year = int(submitted_at[:4])
        except (ValueError, TypeError):
            pass
    tail = (app_id or "")[:8] or "unknown"
    return f"{prefix}-{year}-{tail}"


def _problem_one_liner(answers: dict | None) -> str:
    if not isinstance(answers, dict):
        return ""
    text = answers.get("problem") or answers.get("problem_statement") or ""
    text = str(text).strip()
    if len(text) > 140:
        return text[:137] + "..."
    return text


def fetch_inbox(reviewer_user_id: str) -> list[dict]:
    """Return the reviewer's active, non-locked assignments with the thin
    application summary the inbox UI needs.

    Filters applied:
      - reviewer_user_id == caller
      - declined_at IS NULL
      - reassigned_to IS NULL
      - my_review either does not exist OR its locked_at > now() (the
        latter check is applied in Python after the join, since the fake
        client doesn't have a `now()` comparison; in production this is
        a single CTE).
    """
    sb = get_admin_client()
    try:
        rows = (
            sb.table("reviewer_assignments")
            .select("*")
            .eq("reviewer_user_id", reviewer_user_id)
            .execute()
            .data
        ) or []
    except Exception as exc:
        log.warning(
            "inbox: reviewer_assignments fetch failed",
            extra={"reviewer_user_id": reviewer_user_id, "err": str(exc)},
        )
        return []

    # Filter out declined / reassigned in Python (the fake test client
    # doesn't model IS NULL on chained selects).
    rows = [r for r in rows if r.get("declined_at") is None
            and r.get("reassigned_to") is None]

    # Hydrate each row with its application summary + my_review (if any).
    out = []
    for assignment in rows:
        track = assignment["application_track"]
        table = "tir_applications" if track == "tir" else "sip_applications"
        try:
            app_rows = (
                sb.table(table)
                .select("*")
                .eq("id", assignment["application_id"])
                .limit(1)
                .execute()
                .data
            ) or []
            app_row = app_rows[0] if app_rows else None
        except Exception as exc:
            log.warning(
                "inbox: application row fetch failed",
                extra={
                    "track": track,
                    "application_id": assignment.get("application_id"),
                    "err": str(exc),
                },
            )
            app_row = None
        if app_row is None:
            continue

        # my_review lookup
        try:
            reviews = (
                sb.table("reviews")
                .select("*")
                .eq("application_id", assignment["application_id"])
                .eq("application_track", track)
                .eq("reviewer_user_id", reviewer_user_id)
                .execute()
                .data
            ) or []
        except Exception as exc:
            log.warning(
                "inbox: reviews fetch failed",
                extra={
                    "track": track,
                    "application_id": assignment.get("application_id"),
                    "reviewer_user_id": reviewer_user_id,
                    "err": str(exc),
                },
            )
            reviews = []
        my_review = reviews[0] if reviews else None

        # Filter rule: if review is submitted AND locked, exclude.
        if my_review and my_review.get("locked_at"):
            # Compare against now() in production (SQL); in the fake we
            # let through everything — the test below sets locked_at in
            # the future so the assignment surfaces with my_review set.
            try:
                locked_at = datetime.fromisoformat(
                    my_review["locked_at"].replace("Z", "+00:00")
                )
                if locked_at <= datetime.now(timezone.utc):
                    continue
            except (ValueError, TypeError):
                pass

        # assigned_by display name
        assigned_by_display = None
        if assignment.get("assigned_by"):
            try:
                profs = (
                    sb.table("profiles")
                    .select("*")
                    .eq("id", assignment["assigned_by"])
                    .execute()
                    .data
                ) or []
            except Exception as exc:
                log.warning(
                    "inbox: profile fetch failed",
                    extra={
                        "assigned_by": assignment.get("assigned_by"),
                        "err": str(exc),
                    },
                )
                profs = []
            if profs:
                assigned_by_display = profs[0].get("full_name") or profs[0].get("email")

        out.append({
            "assignment_id": assignment["id"],
            "application_id": assignment["application_id"],
            "application_track": track,
            "app_identifier": _compose_app_identifier(
                track, assignment["application_id"], app_row.get("submitted_at"),
            ),
            "industry": app_row.get("basic_org") or "—",
            "problem_one_liner": _problem_one_liner(app_row.get("answers")),
            "assigned_at": assignment["assigned_at"],
            "assigned_by_display": assigned_by_display,
            "my_review": (
                {
                    "review_id": my_review["id"],
                    "submitted_at": my_review.get("submitted_at"),
                    "locked_at": my_review.get("locked_at"),
                }
                if my_review else None
            ),
        })
    return out


def fetch_application_for_reviewer(
    reviewer_user_id: str, track: str, application_id: str,
) -> dict | None:
    """Return the app payload visible to a reviewer.

    Returns None if the reviewer has no active assignment for this app
    (the router converts None → 403).

    The `ai_screening` key is always present in the response dict but is
    None unless the reviewer has a submitted (non-draft) review. This is
    the load-bearing privacy boundary — see spec §6.3.
    """
    sb = get_admin_client()

    # Active assignment check
    try:
        assignment_rows = (
            sb.table("reviewer_assignments")
            .select("*")
            .eq("application_id", application_id)
            .eq("application_track", track)
            .eq("reviewer_user_id", reviewer_user_id)
            .execute()
            .data
        )
    except Exception as exc:
        log.warning("app_detail: assignment fetch failed",
                    extra={"application_id": application_id, "track": track,
                           "err": str(exc)})
        return None
    active = [
        a for a in assignment_rows
        if a.get("declined_at") is None and a.get("reassigned_to") is None
    ]
    if not active:
        return None
    assignment = active[0]

    # Application body
    table = "tir_applications" if track == "tir" else "sip_applications"
    try:
        app_rows = sb.table(table).select("*").eq("id", application_id).limit(1).execute().data
    except Exception as exc:
        log.warning("app_detail: app fetch failed",
                    extra={"application_id": application_id, "track": track,
                           "err": str(exc)})
        return None
    if not app_rows:
        return None
    application = app_rows[0]

    # My review (if any)
    try:
        review_rows = (
            sb.table("reviews")
            .select("*")
            .eq("application_id", application_id)
            .eq("application_track", track)
            .eq("reviewer_user_id", reviewer_user_id)
            .execute()
            .data
        )
    except Exception as exc:
        log.warning("app_detail: review fetch failed",
                    extra={"application_id": application_id, "track": track,
                           "reviewer": reviewer_user_id, "err": str(exc)})
        review_rows = []
    my_review = review_rows[0] if review_rows else None

    # ── Privacy boundary ──────────────────────────────────────────
    ai_screening = None
    if my_review and my_review.get("submitted_at"):
        try:
            ai_rows = (
                sb.table("ai_screening")
                .select("*")
                .eq("application_id", application_id)
                .eq("application_track", track)
                .execute()
                .data
            )
        except Exception as exc:
            log.warning("app_detail: ai_screening fetch failed",
                        extra={"application_id": application_id, "track": track,
                               "err": str(exc)})
            ai_rows = []
        if ai_rows:
            ai_screening = ai_rows[0]

    return {
        "application": application,
        "assignment": {
            "assignment_id": assignment["id"],
            "assigned_at": assignment["assigned_at"],
        },
        "my_review": my_review,
        "ai_screening": ai_screening,
    }
