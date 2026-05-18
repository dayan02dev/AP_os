"""Read queries for the reviewer endpoints. All reads use the admin client
(RLS-bypassing) because authorization is already enforced at the route
layer via require_capability + per-request reviewer_user_id matching.
"""

from __future__ import annotations

from typing import Any

from ..supabase_client import get_admin_client


def _compose_app_identifier(track: str, app_id: str, submitted_at: str | None) -> str:
    prefix = (track or "").upper()
    year = 2026
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
    rows = (
        sb.table("reviewer_assignments")
        .select("*")
        .eq("reviewer_user_id", reviewer_user_id)
        .execute()
        .data
    )
    # Filter out declined / reassigned in Python (the fake test client
    # doesn't model IS NULL on chained selects).
    rows = [r for r in rows if r.get("declined_at") is None
            and r.get("reassigned_to") is None]

    # Hydrate each row with its application summary + my_review (if any).
    out = []
    for a in rows:
        track = a["application_track"]
        table = "tir_applications" if track == "tir" else "sip_applications"
        app_row = next(
            (x for x in sb.table(table).select("*").execute().data
             if x["id"] == a["application_id"]),
            None,
        )
        if app_row is None:
            continue

        # my_review lookup
        reviews = sb.table("reviews").select("*").eq(
            "application_id", a["application_id"]
        ).eq("reviewer_user_id", reviewer_user_id).execute().data
        my_review = reviews[0] if reviews else None

        # Filter rule: if review is submitted AND locked, exclude.
        if my_review and my_review.get("locked_at"):
            # Compare against now() in production (SQL); in the fake we
            # let through everything — the test below sets locked_at in
            # the future so the assignment surfaces with my_review set.
            from datetime import datetime, timezone
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
        if a.get("assigned_by"):
            profs = sb.table("profiles").select("*").eq("id", a["assigned_by"]).execute().data
            if profs:
                assigned_by_display = profs[0].get("full_name") or profs[0].get("email")

        out.append({
            "assignment_id": a["id"],
            "application_id": a["application_id"],
            "application_track": track,
            "app_identifier": _compose_app_identifier(
                track, a["application_id"], app_row.get("submitted_at"),
            ),
            "industry": app_row.get("basic_org") or "—",
            "problem_one_liner": _problem_one_liner(app_row.get("answers")),
            "assigned_at": a["assigned_at"],
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
