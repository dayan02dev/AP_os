"""Reviewer↔batch membership + application↔batch reconcile engine.

`batch_reviewers` is the source of truth for which reviewers belong to a batch.
`application_batches` is many-to-many (an app may be in many batches). The
effective reviewer set for an app = union of `batch_reviewers` over the app's
batches (∪ manual per-app assignments, which this module never removes unless
they coincide with a batch member). `reviewer_assignments` stays the derived
reviewer-queue truth; its shape is unchanged.
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

log = logging.getLogger("app.batch_membership")


# ─── primitives ──────────────────────────────────────────────────────────
def batch_reviewer_ids(sb: Any, batch_id: str) -> set[str]:
    """Reviewer ids that belong to `batch_id`."""
    rows = (
        sb.table("batch_reviewers")
        .select("reviewer_user_id")
        .eq("batch_id", batch_id)
        .execute()
        .data
    ) or []
    return {r["reviewer_user_id"] for r in rows if r.get("reviewer_user_id")}


def app_batch_ids(sb: Any, app_id: str, track: str) -> set[str]:
    """Batch ids that `(app_id, track)` is currently a member of."""
    rows = (
        sb.table("application_batches")
        .select("batch_id")
        .eq("application_id", app_id)
        .eq("application_track", track)
        .execute()
        .data
    ) or []
    return {r["batch_id"] for r in rows if r.get("batch_id")}


def apps_in_batch(sb: Any, batch_id: str) -> list[tuple[str, str]]:
    """`(application_id, application_track)` pairs currently in `batch_id`."""
    rows = (
        sb.table("application_batches")
        .select("application_id,application_track,batch_id")
        .eq("batch_id", batch_id)
        .execute()
        .data
    ) or []
    return [
        (r["application_id"], r["application_track"])
        for r in rows
        if r.get("batch_id") == batch_id
        and r.get("application_id")
        and r.get("application_track")
    ]


def reviewers_via_batches(sb: Any, batch_ids: set[str]) -> set[str]:
    """Union of reviewers across the given batches."""
    out: set[str] = set()
    for b in batch_ids:
        out |= batch_reviewer_ids(sb, b)
    return out


def has_submitted_review(sb: Any, app_id: str, track: str, reviewer_id: str) -> bool:
    """True if this reviewer already submitted a review for the app (protected
    from auto-removal). Treats either a non-null `submitted_at` or a
    `status == 'submitted'` as submitted."""
    for rv in (
        sb.table("reviews").select("*").eq("reviewer_user_id", reviewer_id).execute().data
    ) or []:
        if (
            rv.get("application_id") == app_id
            and rv.get("application_track") == track
            and rv.get("reviewer_user_id") == reviewer_id
            and (rv.get("submitted_at") or rv.get("status") == "submitted")
        ):
            return True
    return False


def _existing_assignment_keys(sb: Any) -> set[tuple[str, str, str]]:
    """All `(app, track, reviewer)` triples that already have an assignment.
    Paged read (1000-row-cap safe) reused from admin_query."""
    from app.services.admin_query import iter_assignment_rows

    return {
        (a.get("application_id"), a.get("application_track"), a.get("reviewer_user_id"))
        for a in iter_assignment_rows(sb)
    }


def _ensure_assignment(
    sb: Any,
    app_id: str,
    track: str,
    reviewer_id: str,
    assigned_by: str,
    existing: set[tuple[str, str, str]],
) -> dict | None:
    """Idempotently create one reviewer_assignment; returns the new row or None
    if it already existed."""
    key = (app_id, track, reviewer_id)
    if key in existing:
        return None
    row = {
        "application_id": app_id,
        "application_track": track,
        "reviewer_user_id": reviewer_id,
        "assigned_by": assigned_by,
        "assigned_at": datetime.now(UTC).isoformat(),
        "state": "pending",
        "due_at": None,
    }
    sb.table("reviewer_assignments").upsert(
        [row],
        on_conflict="application_id,application_track,reviewer_user_id",
        ignore_duplicates=True,
    ).execute()
    existing.add(key)
    return row


def _advance(app_id: str, track: str) -> None:
    """Fire the submitted→under_review transition (best-effort; uses the real
    admin client, so unit tests monkeypatch this to a no-op)."""
    from app.services import state_machine

    try:
        state_machine.advance_to_under_review_on_assignment(app_id, track)
    except Exception:
        log.warning(
            "advance_to_under_review failed",
            extra={"application_id": app_id, "track": track},
        )


# ─── operations ──────────────────────────────────────────────────────────
def add_apps_to_batch(
    sb: Any, batch_id: str, items: list[tuple[str, str]], *, actor: str
) -> dict[str, Any]:
    """Append applications to a batch and fan out the batch's reviewers to them.

    Idempotent: an app already in the batch is left in place; a reviewer already
    assigned is not re-created. Returns counts + `created_rows` so the caller can
    email only the newly-assigned reviewers."""
    now = datetime.now(UTC).isoformat()
    if items:
        sb.table("application_batches").upsert(
            [
                {
                    "application_id": aid,
                    "application_track": track,
                    "batch_id": batch_id,
                    "added_at": now,
                }
                for (aid, track) in items
            ],
            on_conflict="application_id,application_track,batch_id",
            ignore_duplicates=True,
        ).execute()

    reviewers = batch_reviewer_ids(sb, batch_id)
    existing = _existing_assignment_keys(sb)
    created: list[dict] = []
    for (aid, track) in items:
        for rid in reviewers:
            row = _ensure_assignment(sb, aid, track, rid, actor, existing)
            if row:
                created.append(row)
        _advance(aid, track)
    return {
        "assigned": len(items),
        "assignments_created": len(created),
        "reviewers_notified": len({r["reviewer_user_id"] for r in created}),
        "created_rows": created,
    }


def remove_app_from_batch(
    sb: Any, batch_id: str, app_id: str, track: str, *, actor: str
) -> dict[str, Any]:
    """Detach an app from ONE batch. Drop that batch's reviewers from the app
    UNLESS another of the app's remaining batches still supplies them, or they
    have a submitted review."""
    sb.table("application_batches").delete().eq("application_id", app_id).eq(
        "application_track", track
    ).eq("batch_id", batch_id).execute()

    remaining = reviewers_via_batches(sb, app_batch_ids(sb, app_id, track))
    candidates = batch_reviewer_ids(sb, batch_id)
    removed = 0
    skipped = 0
    for rid in candidates - remaining:
        if has_submitted_review(sb, app_id, track, rid):
            skipped += 1
            continue
        res = (
            sb.table("reviewer_assignments")
            .delete()
            .eq("application_id", app_id)
            .eq("application_track", track)
            .eq("reviewer_user_id", rid)
            .execute()
        )
        removed += len(res.data or [])
    return {"removed": 1, "assignments_removed": removed, "skipped_submitted": skipped}


def remove_reviewer_from_batch(
    sb: Any, batch_id: str, reviewer_id: str, *, actor: str
) -> dict[str, Any]:
    """Remove a reviewer's membership in a batch. For each app in that batch,
    drop the reviewer's assignment UNLESS another of the app's batches still
    supplies them.

    A submitted review does NOT protect the assignment (2026-07-25): the review
    row lives in `reviews` and is kept, so the reviewer's scores/comments/reco
    still show in every portal — but the assignment is detached so the app
    stops counting under this reviewer's batch and the batch reads as
    unassigned for them. `skipped_submitted` stays in the response (always 0)
    for contract stability."""
    sb.table("batch_reviewers").delete().eq("batch_id", batch_id).eq(
        "reviewer_user_id", reviewer_id
    ).execute()

    removed = 0
    for (aid, track) in apps_in_batch(sb, batch_id):
        others = app_batch_ids(sb, aid, track) - {batch_id}
        if reviewer_id in reviewers_via_batches(sb, others):
            continue
        res = (
            sb.table("reviewer_assignments")
            .delete()
            .eq("application_id", aid)
            .eq("application_track", track)
            .eq("reviewer_user_id", reviewer_id)
            .execute()
        )
        removed += len(res.data or [])
    return {"removed": removed, "skipped_submitted": 0}
