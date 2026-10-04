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
        if app_row.get("status") == "rejected":
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


# Statuses where the admin has already decided the app: the reviewer's form is
# read-only and review writes are refused (409 application_decided).
DECIDED_STATUSES = frozenset({"rejected", "jury_review", "offered", "onboarded"})


def _is_active_assignment(a: dict) -> bool:
    return a.get("declined_at") is None and a.get("reassigned_to") is None


def has_live_assignment(sb, reviewer_user_id: str, track: str, application_id: str) -> bool:
    """True iff the reviewer still holds an active assignment for (app, track).
    Raises on a DB error so write paths fail closed."""
    rows = (
        sb.table("reviewer_assignments")
        .select("*")
        .eq("application_id", application_id)
        .eq("application_track", track)
        .eq("reviewer_user_id", reviewer_user_id)
        .execute()
        .data
    ) or []
    return any(
        r.get("reviewer_user_id") == reviewer_user_id
        and r.get("application_id") == application_id
        and r.get("application_track") == track
        and _is_active_assignment(r)
        for r in rows
    )


def fetch_app_status(sb, track: str, application_id: str) -> str | None:
    """Current status of one application (None when the row is missing)."""
    table = "tir_applications" if track == "tir" else "sip_applications"
    rows = (sb.table(table).select("status").eq("id", application_id)
            .limit(1).execute().data) or []
    return rows[0].get("status") if rows else None


def fetch_application_for_reviewer(
    reviewer_user_id: str, track: str, application_id: str,
) -> dict | None:
    """Return the app payload visible to a reviewer.

    Access: an active assignment, OR (read-only) the reviewer's own SUBMITTED
    review for this app — unassign / Gate-1 cleanup hard-delete assignment rows
    but keep reviews, and the reviewer must still be able to open their past
    review. Returns None otherwise (the router converts None → 404/403).

    ``read_only`` is True when there is no live assignment ("unassigned") or the
    app is already decided ("decided"); ``read_only_reason`` says which.

    The `ai_screening` key is always present in the response dict.
    Per the 2026-06-12 spec §1 decision, the reviewer prototypes are the
    source of truth and show AI scores at all times, so ai_screening is
    included unconditionally (anti-anchoring strip is OFF). To restore the
    privacy boundary later, set ``include_ai`` below to:
        bool(my_review and my_review.get("submitted_at"))
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
    active = [a for a in assignment_rows if _is_active_assignment(a)]
    assignment = active[0] if active else None

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

    if assignment is None and not (my_review and my_review.get("submitted_at")):
        return None

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

    # ── AI screening ──────────────────────────────────────────────
    # Spec 2026-06-12 §1 decision: the reviewer prototypes are the source of
    # truth and show AI scores pre-submit, so anti-anchoring is OFF. To restore
    # it later, set this to: bool(my_review and my_review.get("submitted_at")).
    include_ai = True
    ai_screening = None
    if include_ai:
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

    app_status = application.get("status")
    read_only_reason = None
    if app_status in DECIDED_STATUSES:
        read_only_reason = "decided"
    elif assignment is None:
        read_only_reason = "unassigned"

    return {
        "application": application,
        "assignment": (
            {"assignment_id": assignment["id"],
             "assigned_at": assignment.get("assigned_at")}
            if assignment else None
        ),
        "my_review": my_review,
        "ai_screening": ai_screening,
        "app_status": app_status,
        "read_only": read_only_reason is not None,
        "read_only_reason": read_only_reason,
    }


# Score weights per spec §4.3 — keep in lockstep with frontend
# ScoreSegmentInput's display labels and the leadership AI overall calc.
_SCORE_WEIGHTS = {
    "score_problem":    22,
    "score_solution":   30,
    "score_tech":       22,
    "score_founders":   14,
    "score_commitment": 12,
}


def _weighted_overall(review: dict) -> float | None:
    """Returns None iff any required score is missing."""
    total = 0
    for col, w in _SCORE_WEIGHTS.items():
        v = review.get(col)
        if v is None:
            return None
        total += v * w
    return round(total / 100, 2)


def fetch_completed_reviews(
    reviewer_user_id: str, track: str = "all", page: int = 1, page_size: int = 20,
) -> dict:
    """Return the reviewer's locked reviews, paginated, with app context."""
    sb = get_admin_client()
    try:
        rows = (
            sb.table("reviews")
            .select("*")
            .eq("reviewer_user_id", reviewer_user_id)
            .execute()
            .data
        )
    except Exception as exc:
        log.warning(
            "completed_list: reviews fetch failed",
            extra={"reviewer": reviewer_user_id, "err": str(exc)},
        )
        return {"reviews": [], "page": page, "total_pages": 1, "total": 0}

    now = datetime.now(timezone.utc)
    locked_mine: list[dict] = []
    for r in rows:
        locked_at = r.get("locked_at")
        if not locked_at:
            continue
        try:
            t = datetime.fromisoformat(locked_at.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            continue
        if t > now:
            continue
        if track != "all" and r.get("application_track") != track:
            continue
        locked_mine.append(r)

    # Sort by submitted_at DESC
    locked_mine.sort(key=lambda x: x.get("submitted_at") or "", reverse=True)

    total = len(locked_mine)
    start = (page - 1) * page_size
    end = start + page_size
    page_rows = locked_mine[start:end]

    # Bulk-fetch app rows for the page (one query per track) instead of one
    # query per review.
    ids_by_track: dict[str, list[str]] = {}
    for r in page_rows:
        ids_by_track.setdefault(r["application_track"], []).append(r["application_id"])
    apps_by_key: dict[tuple, dict] = {}
    for track, ids in ids_by_track.items():
        if not ids:
            continue
        table = "tir_applications" if track == "tir" else "sip_applications"
        try:
            app_rows = (sb.table(table).select("*").in_("id", ids).execute().data) or []
        except Exception as exc:
            log.warning("completed_list: app bulk fetch failed",
                        extra={"track": track, "err": str(exc)})
            app_rows = []
        for a in app_rows:
            if a.get("id") is not None:
                apps_by_key[(a["id"], track)] = a

    out: list[dict] = []
    for r in page_rows:
        a = apps_by_key.get((r["application_id"], r["application_track"]))
        if not a:
            continue
        out.append({
            "review_id": r["id"],
            "application_id": r["application_id"],
            "application_track": r["application_track"],
            "app_identifier": _compose_app_identifier(
                r["application_track"], r["application_id"], a.get("submitted_at"),
            ),
            "problem_one_liner": _problem_one_liner(a.get("answers")),
            "score_overall_mine": _weighted_overall(r),
            "recommendation": r.get("recommendation"),
            "submitted_at": r.get("submitted_at"),
        })

    return {
        "reviews": out,
        "page": page,
        "total_pages": max(1, (total + page_size - 1) // page_size),
        "total": total,
    }


def _display_id(track: str, app_row: dict) -> str:
    seq = app_row.get("display_seq")
    prefix = "TIR" if track == "tir" else "SIP"
    return f"{prefix}-{seq}" if seq is not None else _compose_app_identifier(
        track, app_row.get("id", ""), app_row.get("submitted_at"))


def _founder_names(track: str, app_row: dict) -> list[str]:
    names = [app_row.get("basic_full_name") or ""]
    extra = app_row.get("basic_teammates") if track == "tir" else app_row.get("sip_founders")
    for t in (extra or []):
        n = (t or {}).get("name") or (t or {}).get("fullName")
        if n:
            names.append(n)
    return [n for n in names if n]


def _ai_block(ai_row: dict | None) -> dict | None:
    if not ai_row:
        return None
    conf = ai_row.get("confidence")
    return {
        "overall":  ai_row.get("score_overall"),
        "conf":     round(conf * 100) if isinstance(conf, (int, float)) else None,
        "problem":  ai_row.get("score_problem"),
        "solution": ai_row.get("score_completeness"),  # ai_screening naming (mig 016)
        "tech":     ai_row.get("score_tech"),
        "founders": ai_row.get("score_founders"),
        "commit":   ai_row.get("score_commitment"),
    }


def _review_status(my_review: dict | None) -> str:
    if my_review is None:
        return "not-started"
    if my_review.get("submitted_at"):
        return "submitted"
    return "draft"


def _fetch_apps_by_key(sb, ids_by_track: dict[str, list[str]], log_ctx: str) -> dict:
    """{(id, track): app_row} — one bulk read per *_applications table."""
    apps_by_key: dict[tuple[str, str], dict] = {}
    for track, ids in ids_by_track.items():
        if not ids:
            continue
        table = "tir_applications" if track == "tir" else "sip_applications"
        try:
            app_rows = (sb.table(table).select("*").in_("id", ids).execute().data) or []
        except Exception as exc:
            log.warning(f"{log_ctx}: app fetch failed",
                        extra={"track": track, "err": str(exc)})
            app_rows = []
        for row in app_rows:
            rid = row.get("id")
            if rid is not None:
                apps_by_key[(rid, track)] = row
    return apps_by_key


def fetch_queue(reviewer_user_id: str) -> list[dict]:
    """Spec §4.2 — one canonical record per active assignment. SUBMITTED reviews
    stay in the queue (status chip); AI scores included pre-submit.

    Contract C5: the reviewer's SUBMITTED reviews whose assignment row was
    deleted (batch-unassign / Gate-1 cleanup hard-delete assignments but keep
    reviews) are appended with ``detached=True`` / ``assignmentId=None``, so the
    dashboard's SUBMITTED tile matches History. Rejected apps are kept only when
    the reviewer submitted a review, flagged ``closed=True`` (the queue hides
    them by default)."""
    from . import stats  # local import avoids any circular-import risk

    sb = get_admin_client()
    try:
        assignments = (sb.table("reviewer_assignments").select("*")
                       .eq("reviewer_user_id", reviewer_user_id).execute().data) or []
    except Exception as exc:
        log.warning("queue: assignments fetch failed",
                    extra={"reviewer": reviewer_user_id, "err": str(exc)})
        return []
    assignments = [a for a in assignments
                   if a.get("reviewer_user_id") == reviewer_user_id
                   and _is_active_assignment(a)]

    # This reviewer's reviews (ALL of them — not narrowed to the assignment ids,
    # so detached submitted reviews are found): {(app_id, track): row}
    rv_by_key: dict[tuple[str, str], dict] = {}
    try:
        rv_rows = (sb.table("reviews").select("*")
                   .eq("reviewer_user_id", reviewer_user_id).execute().data) or []
    except Exception as exc:
        log.warning(
            "queue: reviews fetch failed",
            extra={"reviewer": reviewer_user_id, "err": str(exc)},
        )
        rv_rows = []
    for row in rv_rows:
        if row.get("reviewer_user_id") != reviewer_user_id:
            continue  # fake .in_/.eq don't filter; enforce ownership here
        rv_by_key.setdefault(
            (row.get("application_id"), row.get("application_track")), row)

    # (assignment | None, app_id, track) — live assignments first, then the
    # detached submitted reviews.
    live_keys = {(a["application_id"], a["application_track"]) for a in assignments}
    entries: list[tuple[dict | None, str, str]] = [
        (a, a["application_id"], a["application_track"]) for a in assignments
    ]
    for (aid, track), rv in rv_by_key.items():
        if aid and rv.get("submitted_at") and (aid, track) not in live_keys:
            entries.append((None, aid, track))
    if not entries:
        return []

    # ── Bulk-fetch every table once instead of 3 queries per assignment. ──
    # Partition the application ids by track so each *_applications table is
    # read at most once via .in_("id", ids). Then look up ai_screening with a
    # single .in_("application_id", all_ids), keying by
    # (application_id, application_track) in Python (the fake client's .in_()
    # is a no-op, and production may return cross-track rows, so we always
    # filter/assemble here rather than trusting server-side narrowing).
    all_ids = list(dict.fromkeys(aid for _, aid, _ in entries))
    ids_by_track: dict[str, list[str]] = {}
    for _, aid, track in entries:
        ids_by_track.setdefault(track, []).append(aid)

    apps_by_key = _fetch_apps_by_key(sb, ids_by_track, "queue")

    # AI screening rows: {(application_id, application_track): row}
    ai_by_key: dict[tuple[str, str], dict] = {}
    try:
        ai_rows = (sb.table("ai_screening").select("*")
                   .in_("application_id", all_ids).execute().data) or []
    except Exception as exc:
        log.warning(
            "queue: ai_screening fetch failed",
            extra={"reviewer": reviewer_user_id, "err": str(exc)},
        )
        ai_rows = []
    for row in ai_rows:
        ai_by_key.setdefault(
            (row.get("application_id"), row.get("application_track")), row)

    try:
        cats = (sb.table("industry_categories").select("*").execute().data) or []
    except Exception as exc:
        log.warning(
            "queue: industry_categories fetch failed",
            extra={"reviewer": reviewer_user_id, "err": str(exc)},
        )
        cats = []
    cat_label = {c["id"]: c.get("label") for c in cats}

    out: list[dict] = []
    for a, app_id, track in entries:
        app_row = apps_by_key.get((app_id, track))
        if not app_row:
            continue
        my_review = rv_by_key.get((app_id, track))
        submitted = bool(my_review and my_review.get("submitted_at"))
        closed = app_row.get("status") == "rejected"
        if closed and not submitted:
            continue

        ai_row = ai_by_key.get((app_id, track))

        industry = None
        if ai_row and ai_row.get("industry_category_id"):
            industry = cat_label.get(ai_row["industry_category_id"])

        stage_info = stats.derive_stage_label({**app_row, "track": track})
        stage = stage_info.get("label") if stage_info else None

        # `track` stays NATIVE: the review/content write-paths key off it and
        # the eval route uses it. Display/filter/count use the EFFECTIVE track
        # (movedToTrack or track) on the client, like admin & leadership.
        out.append({
            "id":            app_id,
            "assignmentId":  a["id"] if a else None,
            "applicationId": _display_id(track, app_row),
            "track":         track,
            "movedToTrack":  app_row.get("moved_to_track"),
            "name":          (ai_row or {}).get("project_name")
                             or app_row.get("basic_org")
                             or app_row.get("basic_full_name") or "—",
            "founders":      _founder_names(track, app_row),
            "industry":      industry or "—",
            "stage":         stage or "—",
            "due":           a.get("due_at") if a else None,
            "ai":            _ai_block(ai_row),
            "reviewStatus":  _review_status(my_review),
            "myScore":       _weighted_overall(my_review) if my_review else None,
            # Only a SUBMITTED recommendation counts; a draft's is separate.
            "myReco":        (my_review or {}).get("recommendation") if submitted else None,
            "myDraftReco":   (None if submitted
                              else (my_review or {}).get("recommendation")),
            "editWindowExpiresAt": (my_review or {}).get("locked_at"),
            "detached":      a is None,
            "closed":        closed,
        })
    out.sort(key=lambda x: x.get("due") or "9999")
    return out


# Legacy statuses that meant "passed the 1st gate" before jury_review existed.
_LEGACY_GATE1_SELECTED = {"shortlisted", "interview", "accepted"}


def _fetch_gate_context(sb, ids_by_track: dict[str, list[str]]) -> tuple[dict, dict]:
    """Bulk-read the latest gate-2 admin decision and the CURRENT ic_documents
    per (app_id, track). Returns (gate2_latest, current_docs)."""
    gate2: dict[tuple[str, str], dict] = {}
    docs: dict[tuple[str, str], list[dict]] = {}
    for track, ids in ids_by_track.items():
        if not ids:
            continue
        idset = set(ids)
        try:
            rows = (sb.table("admin_decisions").select("*")
                    .eq("application_track", track).in_("application_id", ids)
                    .execute().data) or []
        except Exception as exc:
            log.warning("gate ctx: admin_decisions fetch failed",
                        extra={"track": track, "err": str(exc)})
            rows = []
        for r in rows:
            if (r.get("application_track") != track or r.get("application_id") not in idset
                    or r.get("gate_stage") != "gate2"):
                continue
            key = (r["application_id"], track)
            cur = gate2.get(key)
            if cur is None or (r.get("decided_at") or "") >= (cur.get("decided_at") or ""):
                gate2[key] = r
        try:
            rows = (sb.table("ic_documents").select("*")
                    .eq("application_track", track).in_("application_id", ids)
                    .is_("superseded_at", None).execute().data) or []
        except Exception as exc:
            log.warning("gate ctx: ic_documents fetch failed",
                        extra={"track": track, "err": str(exc)})
            rows = []
        for r in rows:
            if (r.get("application_track") != track or r.get("application_id") not in idset
                    or r.get("superseded_at") is not None):
                continue
            docs.setdefault((r["application_id"], track), []).append(r)
    return gate2, docs


def _admin_decision(app_status: str | None, gate2_row: dict | None,
                    current_docs: list[dict] | None) -> str:
    """Contract C5 bucket for one app: pending | gate1_selected | gate1_rejected
    | final_selected | final_rejected | offered | onboarded. Same rule as the
    portal-wide pipeline breakdown (C1): final_selected = jury_review with >=1
    current IC document and every current one signed."""
    if app_status == "rejected":
        if (gate2_row or {}).get("decision") == "rejected":
            return "final_rejected"
        return "gate1_rejected"
    if app_status == "jury_review":
        if current_docs and all(d.get("signed_storage_path") for d in current_docs):
            return "final_selected"
        return "gate1_selected"
    if app_status in ("offered", "onboarded"):
        return app_status
    if app_status in _LEGACY_GATE1_SELECTED:
        return "gate1_selected"
    return "pending"


def fetch_history(reviewer_user_id: str) -> dict:
    """Spec §4.5 — every SUBMITTED review by this reviewer, newest first.

    Each row carries ``adminDecision`` (contract C5 bucket, see
    _admin_decision), ``canEdit`` (live assignment AND app not decided), the
    display ``applicationId`` and ``org``.

    Bulk-fetches app rows (per track) and ai_screening once, instead of two
    queries per review (the old N+1 could exceed the Lambda/API-Gateway 29 s
    ceiling for prolific reviewers and surface as a red error in the UI). The
    whole body is guarded so any failure degrades to a flagged-empty response
    rather than a 5xx.
    """
    empty = {"stats": {"total": 0, "avgVariance": None,
                       "consistencyPct": None, "avgMinutes": None},
             "rows": [], "degraded": False}
    sb = get_admin_client()
    try:
        rows = (sb.table("reviews").select("*")
                .eq("reviewer_user_id", reviewer_user_id).execute().data) or []
    except Exception as exc:
        log.warning("history: reviews fetch failed",
                    extra={"reviewer": reviewer_user_id, "err": str(exc)})
        return {**empty, "degraded": True}

    try:
        submitted = [r for r in rows
                     if r.get("reviewer_user_id") == reviewer_user_id and r.get("submitted_at")]
        submitted.sort(key=lambda r: r.get("submitted_at") or "", reverse=True)

        # Partition ids by track for one bulk fetch per app table + one for ai.
        ids_by_track: dict[str, list[str]] = {}
        all_ids: list[str] = []
        for r in submitted:
            track = r.get("application_track")
            aid = r.get("application_id")
            if not aid:
                continue
            ids_by_track.setdefault(track, []).append(aid)
            all_ids.append(aid)

        apps_by_key = _fetch_apps_by_key(sb, ids_by_track, "history")
        gate2_by_key, docs_by_key = _fetch_gate_context(sb, ids_by_track)

        # Live assignments → canEdit (a reviewer may edit only while still
        # assigned and before the admin decides).
        try:
            asg_rows = (sb.table("reviewer_assignments").select("*")
                        .eq("reviewer_user_id", reviewer_user_id).execute().data) or []
        except Exception as exc:
            log.warning("history: assignments fetch failed",
                        extra={"reviewer": reviewer_user_id, "err": str(exc)})
            asg_rows = []
        live_keys = {(a.get("application_id"), a.get("application_track"))
                     for a in asg_rows
                     if a.get("reviewer_user_id") == reviewer_user_id
                     and _is_active_assignment(a)}

        ai_by_key: dict[tuple, dict] = {}
        try:
            ai_rows = (sb.table("ai_screening").select("*")
                       .in_("application_id", all_ids).execute().data) or []
        except Exception as exc:
            log.warning("history: ai bulk fetch failed",
                        extra={"reviewer": reviewer_user_id, "err": str(exc)})
            ai_rows = []
        for row in ai_rows:
            ai_by_key.setdefault(
                (row.get("application_id"), row.get("application_track")), row)

        out_rows: list[dict] = []
        variances: list[float] = []
        for r in submitted:
            track = r.get("application_track")
            key = (r.get("application_id"), track)
            app_row = apps_by_key.get(key) or {}
            ai_row = ai_by_key.get(key)

            my_score = _weighted_overall(r)
            ai_score = (ai_row or {}).get("score_overall")
            variance = (round(abs(my_score - ai_score), 1)
                        if my_score is not None and ai_score is not None else None)
            if variance is not None:
                variances.append(variance)

            out_rows.append({
                "appId":         r.get("application_id"),
                "reviewId":      r.get("id"),
                "track":         track,
                "name":          (ai_row or {}).get("project_name")
                                 or app_row.get("basic_org")
                                 or app_row.get("basic_full_name") or "—",
                "date":          r.get("submitted_at"),
                "myScore":       my_score,
                "aiScore":       ai_score,
                "variance":      variance,
                "reco":          r.get("recommendation"),
                "adminDecision": _admin_decision(
                    app_row.get("status"), gate2_by_key.get(key), docs_by_key.get(key)),
                "canEdit":       (key in live_keys
                                  and app_row.get("status") not in DECIDED_STATUSES),
                "applicationId": _display_id(track, {"id": r.get("application_id"),
                                                     **app_row}),
                "org":           app_row.get("basic_org"),
                "editWindowExpiresAt": r.get("locked_at"),
            })

        avg_var = round(sum(variances) / len(variances), 2) if variances else None
        return {
            "stats": {"total": len(out_rows), "avgVariance": avg_var,
                      "consistencyPct": None, "avgMinutes": None},
            "rows": out_rows,
            "degraded": False,
        }
    except Exception as exc:
        log.exception("history: assembly failed",
                      extra={"reviewer": reviewer_user_id, "err": str(exc)})
        return {**empty, "degraded": True}


def fetch_my_review_for_application(
    reviewer_user_id: str, application_id: str,
) -> dict | None:
    sb = get_admin_client()
    try:
        rows = (
            sb.table("reviews")
            .select("*")
            .eq("reviewer_user_id", reviewer_user_id)
            .eq("application_id", application_id)
            .execute()
            .data
        )
    except Exception as exc:
        log.warning(
            "mine_probe: fetch failed",
            extra={"reviewer": reviewer_user_id, "application_id": application_id, "err": str(exc)},
        )
        return None
    return rows[0] if rows else None
