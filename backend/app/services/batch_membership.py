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

_CHUNK = 150
_PAGE = 1000


def closed_statuses() -> frozenset[str]:
    """Statuses on which a reviewer can no longer act (decided/withdrawn)."""
    from app.services.reviewer_query import DECIDED_STATUSES

    return frozenset(DECIDED_STATUSES) | {"withdrawn"}


def _chunks(seq: list, n: int = _CHUNK):
    for i in range(0, len(seq), n):
        yield seq[i : i + n]


def app_statuses(sb: Any, items: list[tuple[str, str]]) -> dict[tuple[str, str], str | None]:
    """`(app_id, track) -> status` for every item that exists in its track's
    table. One bulk read per track per 150 ids; items absent from the table are
    simply missing from the result."""
    out: dict[tuple[str, str], str | None] = {}
    for track in ("tir", "sip"):
        ids = list(dict.fromkeys(a for a, t in items if t == track))
        for chunk in _chunks(ids):
            rows = (
                sb.table(f"{track}_applications").select("id,status").in_("id", chunk).execute().data
            ) or []
            for r in rows:
                if r.get("id") in chunk:
                    out[(r["id"], track)] = r.get("status")
    return out


def closed_keys(sb: Any, items: list[tuple[str, str]]) -> set[tuple[str, str]]:
    """Items whose app exists and is in a closed status."""
    closed = closed_statuses()
    return {k for k, st in app_statuses(sb, items).items() if st in closed}


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
    """`(application_id, application_track)` pairs currently in `batch_id`
    (paginated past the PostgREST 1000-row cap)."""
    out: list[tuple[str, str]] = []
    offset = 0
    while True:
        rows = (
            sb.table("application_batches")
            .select("application_id,application_track,batch_id")
            .eq("batch_id", batch_id)
            .order("application_id")
            .range(offset, offset + _PAGE - 1)
            .execute()
            .data
        ) or []
        out.extend(
            (r["application_id"], r["application_track"])
            for r in rows
            if r.get("batch_id") == batch_id
            and r.get("application_id")
            and r.get("application_track")
        )
        if len(rows) < _PAGE:
            break
        offset += _PAGE
    return out


def reviewers_via_batches(sb: Any, batch_ids: set[str]) -> set[str]:
    """Union of reviewers across the given batches."""
    out: set[str] = set()
    for b in batch_ids:
        out |= batch_reviewer_ids(sb, b)
    return out


def has_submitted_review(sb: Any, app_id: str, track: str, reviewer_id: str) -> bool:
    """True if this reviewer already submitted a review for the app. Targeted
    query (never the reviewer's whole review history). A non-null
    `submitted_at` or `status == 'submitted'` counts as submitted."""
    rows = (
        sb.table("reviews")
        .select("*")
        .eq("application_id", app_id)
        .eq("application_track", track)
        .eq("reviewer_user_id", reviewer_id)
        .execute()
        .data
    ) or []
    return any(
        rv.get("application_id") == app_id
        and rv.get("application_track") == track
        and rv.get("reviewer_user_id") == reviewer_id
        and (rv.get("submitted_at") or rv.get("status") == "submitted")
        for rv in rows
    )


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


def _advance(app_id: str, track: str, changed_by: str | None = None) -> None:
    """Fire the submitted→under_review transition (best-effort; uses the real
    admin client, so unit tests monkeypatch this to a no-op)."""
    from app.services import state_machine

    try:
        state_machine.advance_to_under_review_on_assignment(app_id, track, changed_by=changed_by)
    except Exception:
        log.warning(
            "advance_to_under_review failed",
            extra={"application_id": app_id, "track": track},
        )


def advance_many(
    sb: Any, keys: list[tuple[str, str]], changed_by: str | None = None
) -> list[tuple[str, str]]:
    """Bulk guarded submitted→under_review for apps that just received a
    reviewer. Two round trips per (track, 150-id chunk) instead of ~4 per app.
    Only rows still 'submitted' flip. Best-effort: failures are logged."""
    flipped: list[tuple[str, str]] = []
    for track in ("tir", "sip"):
        ids = list(dict.fromkeys(a for a, t in keys if t == track))
        for chunk in _chunks(ids):
            try:
                res = (
                    sb.table(f"{track}_applications")
                    .update({"status": "under_review"})
                    .in_("id", chunk)
                    .eq("status", "submitted")
                    .execute()
                )
                done = [r["id"] for r in (res.data or []) if r.get("id")]
                if done:
                    now = datetime.now(UTC).isoformat()
                    try:
                        sb.table("application_status_log").insert([
                            {
                                "application_id": i,
                                "application_track": track,
                                "from_status": "submitted",
                                "to_status": "under_review",
                                "changed_by": changed_by,
                                "reason": "reviewer assigned",
                                "changed_at": now,
                            }
                            for i in done
                        ]).execute()
                    except Exception:
                        log.warning("advance_many: status_log insert failed", exc_info=True)
                flipped += [(i, track) for i in done]
            except Exception:
                log.warning("advance_many failed", extra={"track": track}, exc_info=True)
    return flipped


# ─── operations ──────────────────────────────────────────────────────────
def _linked_keys(sb: Any, batch_id: str, items: list[tuple[str, str]]) -> set[tuple[str, str]]:
    """Subset of `items` already linked to `batch_id`."""
    out: set[tuple[str, str]] = set()
    ids = list(dict.fromkeys(a for a, _ in items))
    for chunk in _chunks(ids):
        rows = (
            sb.table("application_batches")
            .select("application_id,application_track,batch_id")
            .eq("batch_id", batch_id)
            .in_("application_id", chunk)
            .execute()
            .data
        ) or []
        out |= {
            (r["application_id"], r["application_track"])
            for r in rows
            if r.get("batch_id") == batch_id
        }
    return out


def add_apps_to_batch(
    sb: Any, batch_id: str, items: list[tuple[str, str]], *, actor: str
) -> dict[str, Any]:
    """Append applications to a batch and fan out the batch's reviewers to them.

    Idempotent: an app already in the batch is left in place; a reviewer already
    assigned is not re-created. Draft / non-existent apps are neither linked nor
    assigned; closed apps (decided/withdrawn) are linked but get no assignments.
    Returns counts + `created_rows` so the caller can email only the
    newly-assigned reviewers."""
    now = datetime.now(UTC).isoformat()
    items = list(dict.fromkeys(items))
    statuses = app_statuses(sb, items)
    closed = closed_statuses()
    skipped_unknown = [a for (a, t) in items if (a, t) not in statuses]
    skipped_draft = [a for (a, t) in items if (a, t) in statuses and statuses[(a, t)] == "draft"]
    linkable = [
        k for k in items
        if k in statuses and statuses[k] != "draft"
    ]
    skipped_closed = [a for (a, t) in linkable if statuses[(a, t)] in closed]
    assignable = [k for k in linkable if statuses[k] not in closed]

    already = _linked_keys(sb, batch_id, linkable)
    new_links = [k for k in linkable if k not in already]
    if linkable:
        sb.table("application_batches").upsert(
            [
                {
                    "application_id": aid,
                    "application_track": track,
                    "batch_id": batch_id,
                    "added_at": now,
                }
                for (aid, track) in linkable
            ],
            on_conflict="application_id,application_track,batch_id",
            ignore_duplicates=True,
        ).execute()

    reviewers = batch_reviewer_ids(sb, batch_id)
    created: list[dict] = []
    if reviewers and assignable:
        existing = {
            (a.get("application_id"), a.get("application_track"), a.get("reviewer_user_id"))
            for a in _iter_assignments(sb, reviewers)
        }
        for (aid, track) in assignable:
            for rid in reviewers:
                key = (aid, track, rid)
                if key in existing:
                    continue
                existing.add(key)
                created.append(
                    {
                        "application_id": aid,
                        "application_track": track,
                        "reviewer_user_id": rid,
                        "assigned_by": actor,
                        "assigned_at": now,
                        "state": "pending",
                        "due_at": None,
                    }
                )
    if created:
        # ONE bulk upsert per 500 rows (API Lambda has a 29 s budget).
        for chunk in _chunks(created, 500):
            sb.table("reviewer_assignments").upsert(
                chunk,
                on_conflict="application_id,application_track,reviewer_user_id",
                ignore_duplicates=True,
            ).execute()
    # Only apps that actually received a new assignment leave 'submitted'.
    advance_many(
        sb,
        list(dict.fromkeys((r["application_id"], r["application_track"]) for r in created)),
        changed_by=actor,
    )
    return {
        "assigned": len(new_links),
        "assignments_created": len(created),
        "reviewers_notified": len({r["reviewer_user_id"] for r in created}),
        "created_rows": created,
        "skipped_closed": skipped_closed,
        "skipped_draft": skipped_draft,
        "skipped_unknown": skipped_unknown,
        "linked_ids": [a for (a, t) in new_links],
    }


def _iter_assignments(sb: Any, reviewer_ids):
    from app.services.admin_query import iter_assignment_rows

    return iter_assignment_rows(sb, reviewer_ids=list(reviewer_ids))


def _other_links(
    sb: Any, batch_id: str, apps: list[tuple[str, str]]
) -> dict[tuple[str, str], set[str]]:
    """For each app, the set of batches OTHER than `batch_id` it belongs to
    (chunked `.in_` reads)."""
    out: dict[tuple[str, str], set[str]] = {k: set() for k in apps}
    ids = list(dict.fromkeys(a for a, _ in apps))
    for chunk in _chunks(ids):
        offset = 0
        while True:
            rows = (
                sb.table("application_batches")
                .select("application_id,application_track,batch_id")
                .in_("application_id", chunk)
                .order("application_id")
                .range(offset, offset + _PAGE - 1)
                .execute()
                .data
            ) or []
            for r in rows:
                key = (r.get("application_id"), r.get("application_track"))
                if key in out and r.get("batch_id") and r["batch_id"] != batch_id:
                    out[key].add(r["batch_id"])
            if len(rows) < _PAGE:
                break
            offset += _PAGE
    return out


def _members_by_batch(sb: Any, batch_ids: set[str]) -> dict[str, set[str]]:
    out: dict[str, set[str]] = {b: set() for b in batch_ids}
    ids = sorted(batch_ids)
    for chunk in _chunks(ids):
        rows = (
            sb.table("batch_reviewers")
            .select("batch_id,reviewer_user_id")
            .in_("batch_id", chunk)
            .execute()
            .data
        ) or []
        for r in rows:
            if r.get("batch_id") in out and r.get("reviewer_user_id"):
                out[r["batch_id"]].add(r["reviewer_user_id"])
    return out


def _detach_reviewers_from_apps(
    sb: Any,
    reviewer_ids: set[str],
    apps: list[tuple[str, str]],
    other_links: dict[tuple[str, str], set[str]],
    members: dict[str, set[str]],
) -> tuple[int, list[str]]:
    """Delete each reviewer's assignment on each app unless another of the
    app's batches still supplies that reviewer. Bulk (chunked `.in_`).
    Returns (rows removed, affected application ids)."""
    removed = 0
    touched: set[tuple[str, str]] = set()
    for rid in reviewer_ids:
        by_track: dict[str, list[str]] = {}
        for key in apps:
            if any(rid in members.get(b, set()) for b in other_links.get(key, set())):
                continue
            by_track.setdefault(key[1], []).append(key[0])
        for track, ids in by_track.items():
            for chunk in _chunks(ids):
                res = (
                    sb.table("reviewer_assignments")
                    .delete()
                    .eq("reviewer_user_id", rid)
                    .eq("application_track", track)
                    .in_("application_id", chunk)
                    .execute()
                )
                removed += len(res.data or [])
                touched |= {(a.get("application_id"), track) for a in (res.data or [])}
    return removed, sorted({a for a, _ in touched})


def remove_app_from_batch(
    sb: Any, batch_id: str, app_id: str, track: str, *, actor: str
) -> dict[str, Any]:
    """Detach an app from ONE batch. Drop that batch's reviewers from the app
    UNLESS another of the app's remaining batches still supplies them.

    Same rule as `remove_reviewer_from_batch` (2026-07-25): a submitted review
    does NOT protect the assignment; the review row is kept. `skipped_submitted`
    stays in the response (always 0) for contract stability."""
    sb.table("application_batches").delete().eq("application_id", app_id).eq(
        "application_track", track
    ).eq("batch_id", batch_id).execute()

    others = app_batch_ids(sb, app_id, track)
    members = _members_by_batch(sb, others | {batch_id})
    remaining = set().union(*(members[b] for b in others)) if others else set()
    candidates = members[batch_id] - remaining
    removed = 0
    if candidates:
        res = (
            sb.table("reviewer_assignments")
            .delete()
            .eq("application_id", app_id)
            .eq("application_track", track)
            .in_("reviewer_user_id", sorted(candidates))
            .execute()
        )
        removed = len(res.data or [])
    return {"removed": 1, "assignments_removed": removed, "skipped_submitted": 0}


def remove_reviewer_from_batch(
    sb: Any, batch_id: str, reviewer_id: str, *, actor: str
) -> dict[str, Any]:
    """Remove a reviewer's membership in a batch. For each app in that batch,
    drop the reviewer's assignment UNLESS another of the app's batches still
    supplies them.

    A submitted review does NOT protect the assignment (2026-07-25): the review
    row lives in `reviews` and is kept, so the reviewer's scores/comments/reco
    still show in every portal — but the assignment is detached so the app
    stops counting under this reviewer's batch. `skipped_submitted` stays in
    the response (always 0) for contract stability.

    Bulk: O(pages + chunks) round trips regardless of batch size."""
    sb.table("batch_reviewers").delete().eq("batch_id", batch_id).eq(
        "reviewer_user_id", reviewer_id
    ).execute()

    apps = apps_in_batch(sb, batch_id)
    other = _other_links(sb, batch_id, apps)
    members = _members_by_batch(sb, set().union(*other.values()) if other else set())
    removed, ids = _detach_reviewers_from_apps(sb, {reviewer_id}, apps, other, members)
    return {"removed": removed, "skipped_submitted": 0, "application_ids": ids}


def detach_batch_for_delete(sb: Any, batch_id: str) -> dict[str, Any]:
    """Pre-delete cleanup: detach every member reviewer from the batch's apps
    (honouring other batches that still supply them) and remove the batch's
    `batch_reviewers` rows. Reviews are kept. Caller unlinks apps + deletes the
    batch row."""
    reviewers = batch_reviewer_ids(sb, batch_id)
    apps = apps_in_batch(sb, batch_id)
    other = _other_links(sb, batch_id, apps)
    members = _members_by_batch(sb, set().union(*other.values()) if other else set())
    removed, _ids = _detach_reviewers_from_apps(sb, reviewers, apps, other, members)
    sb.table("batch_reviewers").delete().eq("batch_id", batch_id).execute()
    return {"assignments_removed": removed, "reviewers": len(reviewers), "applications": len(apps)}
