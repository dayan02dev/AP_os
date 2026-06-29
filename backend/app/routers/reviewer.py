"""Reviewer endpoints (Phase 1.5).

Every endpoint guarded by `require_capability(...)`. Mutations append to
`audit_log_v2`. Per the 2026-06-12 spec §1 decision, the reviewer prototypes
are the source of truth and show AI scores at all times — ai_screening is
included in GET /reviewer/applications/{track}/{id} unconditionally.

Routes (built up across Tasks 1-7 of the implementation plan):

    GET    /reviewer/assignments                       inbox
    GET    /reviewer/applications/{track}/{id}         app detail (AI included)
    GET    /reviewer/reviews/mine?application_id=...   probe
    GET    /reviewer/reviews?mine=true&locked=true     completed list
    POST   /reviewer/reviews                           submit (or draft)
    PATCH  /reviewer/reviews/{review_id}               edit (423 after lock)
    POST   /reviewer/assignments/{id}/decline          decline with reason
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi import status as http_status
from pydantic import BaseModel, ConfigDict, Field

from ..deps import get_current_user
from ..rbac import require_capability
from ..services import review_presenter, reviewer_query, state_machine
from ..services import rubric as rubric_service
from ..services.audit import write_audit
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


@router.get(
    "/queue",
    dependencies=[Depends(require_capability("view_assigned_apps"))],
)
async def get_queue(user: dict = Depends(get_current_user)) -> list[dict]:
    """Spec §4.2 — canonical reviewer queue (replaces the prototype's buildReviewerQueue())."""
    return reviewer_query.fetch_queue(user["user_id"])


@router.get(
    "/applications/{track}/{application_id}/content",
    dependencies=[Depends(require_capability("view_assigned_apps"))],
)
async def get_application_content(
    track: Literal["tir", "sip"],
    application_id: str,
    user: dict = Depends(get_current_user),
) -> dict:
    """Spec §4.3 presenter — the full application as the eval screen renders it.
    404 (not 403) when unassigned: no app-existence enumeration."""
    payload = reviewer_query.fetch_application_for_reviewer(
        user["user_id"], track, application_id,
    )
    if payload is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND,
                            detail={"code": "not_found"})
    app_row = payload["application"]
    ai = payload.get("ai_screening") or {}
    field_map = (review_presenter.TIR_FIELD_MAP if track == "tir"
                 else review_presenter.SIP_FIELD_MAP)

    attachments = []
    sb = get_admin_client()
    for att in review_presenter.collect_attachment_paths(app_row, track):
        try:
            signed = (sb.storage.from_(att["bucket"])
                      .create_signed_url(att["storage_path"], 120))
            url = None
            if isinstance(signed, dict):
                url = signed.get("signedURL") or signed.get("signedUrl") or signed.get("url")
            if url:
                attachments.append({"kind": att["kind"], "name": att["name"], "url": url})
        except Exception:
            log.warning("content: signed url failed",
                        extra={"path": att["storage_path"]})

    return {
        "id": application_id,
        "applicationId": reviewer_query._display_id(track, app_row),
        "track": track,
        "name": ai.get("project_name") or app_row.get("basic_org")
                or app_row.get("basic_full_name") or "—",
        "aiSummary": ai.get("summary"),
        "ai": reviewer_query._ai_block(payload.get("ai_screening")),
        "fields": review_presenter.build_fields(app_row, field_map),
        "sections": review_presenter.build_sections(app_row, track),
        "attachments": attachments,
        "evaluation": payload.get("my_review"),
        "assignment": payload.get("assignment"),
    }


@router.get(
    "/applications/{track}/{application_id}",
    dependencies=[Depends(require_capability("view_assigned_apps"))],
)
async def get_application_for_reviewer(
    track: str,
    application_id: str,
    user: dict = Depends(get_current_user),
) -> dict:
    if track not in ("tir", "sip"):
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail={"code": "invalid_track", "message": "Track must be 'tir' or 'sip'."},
        )

    payload = reviewer_query.fetch_application_for_reviewer(
        user["user_id"], track, application_id,
    )
    if payload is None:
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail={"code": "not_assigned",
                    "message": "You have no active assignment for this application."},
        )
    return payload


# ─── POST /reviewer/reviews ────────────────────────────────────────────

# Scores arrive from a 0.5-step slider; the DB column is numeric(4,1).
# multiple_of=0.5 rejects values Postgres would otherwise silently round.
Score = Annotated[float, Field(ge=0, le=10, multiple_of=0.5)] | None


class ReviewSubmitBody(BaseModel):
    """Payload for submit (or save-as-draft).

    `extra="forbid"` is the load-bearing guard: it rejects anti-anchoring
    fields like `score_integrity` (spec §6.2 explicitly drops integrity as
    a scored dimension — any client that ships it is on a stale schema).
    """
    model_config = ConfigDict(extra="forbid")

    application_id: str = Field(..., min_length=1)
    application_track: Literal["tir", "sip"]
    assignment_id: str = Field(..., min_length=1)
    score_problem:    Score = None
    score_solution:   Score = None
    score_tech:       Score = None
    score_founders:   Score = None
    score_commitment: Score = None
    recommendation:   Literal["yes", "maybe", "no"] | None = None
    strengths:   str | None = None
    concerns:    str | None = None
    quick_notes: str | None = None
    flags: list[str] | None = None
    disagree_with_ai: dict[str, str] | None = None
    draft: bool = False


def _validate_complete(body: ReviewSubmitBody) -> None:
    """Non-draft submits require all 5 scores AND a recommendation."""
    if body.draft:
        return
    missing: list[str] = []
    for col in ("score_problem", "score_solution", "score_tech",
                "score_founders", "score_commitment"):
        if getattr(body, col) is None:
            missing.append(col)
    if body.recommendation is None:
        missing.append("recommendation")
    if missing:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "incomplete_review", "missing": missing},
        )


_MAX_FLAGS = 8
_MAX_FLAG_LEN = 80


def _validate_flags(flags: list[str] | None) -> None:
    if flags is None:
        return
    if len(flags) > _MAX_FLAGS or any(
        (not isinstance(f, str)) or len(f) > _MAX_FLAG_LEN or not f.strip()
        for f in flags
    ):
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "flags_invalid",
                    "message": f"Max {_MAX_FLAGS} flags, each non-empty and ≤{_MAX_FLAG_LEN} chars."},
        )


def _validate_notes(quick_notes: str | None, draft: bool) -> None:
    if draft:
        return
    if not (quick_notes or "").strip():
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "notes_required",
                    "message": "Notes are required before you can submit."},
        )


# CLIENT-FACING CONTRACT: these short keys ("problem", "solution", "tech",
# "founders", "commit") are the canonical dimension identifiers used by the
# reviewer-UI prototype's `scores` and `disagree_with_ai` objects.  The
# `disagree_with_ai` request dict and the 422 "disagreement_reason_required"
# `dimensions` array both use them.  Do NOT rename "commit" to "commitment" —
# that would break frontend alignment.
_DIM_MAP = [  # (short, review_col, ai_col)
    ("problem",  "score_problem",    "score_problem"),
    ("solution", "score_solution",   "score_completeness"),
    ("tech",     "score_tech",       "score_tech"),
    ("founders", "score_founders",   "score_founders"),
    ("commit",   "score_commitment", "score_commitment"),
]

# Score columns touched by a review body — used to gate the ai_screening fetch
# in patch_review (only fetch when a score is actually changing or we're
# flipping to submitted).
_SCORE_COLS = {
    "score_problem", "score_solution", "score_tech",
    "score_founders", "score_commitment",
}


def _validate_disagreements(merged: dict, ai_row: dict | None,
                            disagree: dict[str, str] | None) -> None:
    """No-op: disagreement explanations are no longer required.

    Previously (spec §4.7) any dimension where |reviewer − AI| > 1.0 required a
    written reason in `disagree_with_ai`. The reviewer UI for entering those
    reasons was removed, so the requirement is dropped. Kept as a stable hook
    so the submit_review call site stays unchanged.
    """
    return


def _fetch_ai_screening_row(sb, application_id: str, application_track: str) -> dict | None:
    """Best-effort fetch for the disagreement check. A fetch error must not
    block a submit (log + skip), so failures return None instead of 502."""
    try:
        rows = (
            sb.table("ai_screening")
            .select("*")
            .eq("application_id", application_id)
            .eq("application_track", application_track)
            .limit(1)
            .execute()
            .data
        ) or []
        return rows[0] if rows else None
    except Exception as exc:
        log.warning(
            "ai_screening fetch failed; skipping disagreement check",
            extra={"application_id": application_id,
                   "application_track": application_track,
                   "err": str(exc)},
        )
        return None


@router.post(
    "/reviews",
    status_code=http_status.HTTP_201_CREATED,
    dependencies=[Depends(require_capability("score_app"))],
)
async def submit_review(
    body: ReviewSubmitBody,
    user: dict = Depends(get_current_user),
) -> dict:
    """Create a review row.

    Two modes:
      * ``draft=True``  — partial save, no submitted_at, no locked_at, no
        audit, no auto-transition. Reviewer can keep editing.
      * ``draft=False`` (default) — full submit. All 5 scores + recommendation
        required. Writes submitted_at = now, locked_at = now + 60min, marks
        the assignment ``completed_at = now``, audits, and triggers the
        spec §14.4 auto-transition to ``evaluated`` when every active
        reviewer for the app has submitted.
    """
    _validate_complete(body)
    _validate_flags(body.flags)
    _validate_notes(body.quick_notes, body.draft)

    # Verify the caller actually owns this assignment. The RBAC gate already
    # confirmed they hold the ``score_app`` capability, but that's role-wide;
    # this enforces the per-assignment ownership boundary.
    sb = get_admin_client()
    try:
        asg_rows = (
            sb.table("reviewer_assignments")
            .select("*")
            .eq("id", body.assignment_id)
            .execute()
            .data
        ) or []
    except Exception as exc:
        log.warning(
            "submit_review: assignment fetch failed",
            extra={"assignment_id": body.assignment_id, "err": str(exc)},
        )
        raise HTTPException(
            status_code=http_status.HTTP_502_BAD_GATEWAY,
            detail={"code": "assignment_lookup_failed"},
        ) from exc

    if not asg_rows or asg_rows[0].get("reviewer_user_id") != user["user_id"]:
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail={"code": "not_your_assignment"},
        )

    # Reject duplicate (UNIQUE constraint guard with a clean 409 instead
    # of a 502 from the DB). Pulls only one row; cheap.
    existing = (
        sb.table("reviews")
        .select("id, submitted_at, locked_at")
        .eq("application_id", body.application_id)
        .eq("application_track", body.application_track)
        .eq("reviewer_user_id", user["user_id"])
        .limit(1)
        .execute()
        .data
    )
    if existing:
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail={
                "code": "review_already_exists",
                "message": "You already have a review for this application. Use PATCH to edit it.",
                "review_id": existing[0]["id"],
            },
        )

    # High-variance disagreement gate (spec §4.7) — non-draft only. A failed
    # ai_screening fetch is logged and skipped, never a 502.
    if not body.draft:
        ai_row = _fetch_ai_screening_row(
            sb, body.application_id, body.application_track,
        )
        _validate_disagreements(body.model_dump(), ai_row, body.disagree_with_ai)

    now = datetime.now(UTC)
    submitted_at = None if body.draft else now.isoformat()
    locked_at    = None if body.draft else (now + timedelta(minutes=60)).isoformat()

    insert_row = {
        "application_id":    body.application_id,
        "application_track": body.application_track,
        "reviewer_user_id":  user["user_id"],
        "assignment_id":     body.assignment_id,
        "score_problem":     body.score_problem,
        "score_solution":    body.score_solution,
        "score_tech":        body.score_tech,
        "score_founders":    body.score_founders,
        "score_commitment":  body.score_commitment,
        "recommendation":    body.recommendation,
        "strengths":         body.strengths,
        "concerns":          body.concerns,
        "quick_notes":       body.quick_notes,
        "flags":             body.flags or [],
        "disagree_with_ai":  body.disagree_with_ai,
        "submitted_at":      submitted_at,
        "locked_at":         locked_at,
    }
    try:
        result = sb.table("reviews").insert(insert_row).execute()
    except Exception as exc:
        log.warning(
            "submit_review: reviews insert failed",
            extra={"application_id": body.application_id,
                   "reviewer_user_id": user["user_id"],
                   "err": str(exc)},
        )
        raise HTTPException(
            status_code=http_status.HTTP_502_BAD_GATEWAY,
            detail={"code": "review_insert_failed"},
        ) from exc

    review_row = (result.data or [{}])[0]
    review_id = review_row.get("id")

    if not body.draft:
        # Mark the assignment complete.
        try:
            sb.table("reviewer_assignments").update(
                {"completed_at": now.isoformat()},
            ).eq("id", body.assignment_id).execute()
        except Exception as exc:
            # Don't fail the whole request — the review row landed; the
            # assignment-complete flag is a best-effort hygiene marker.
            log.warning(
                "submit_review: assignment completed_at update failed",
                extra={"assignment_id": body.assignment_id, "err": str(exc)},
            )

        # Audit: kwarg is `after`, not `after_state` (DB col vs kwarg name).
        write_audit(
            actor_user_id=user["user_id"],
            actor_role="reviewer",
            action_type="submit_review",
            target_table="reviews",
            target_id=review_id,
            after={"recommendation": body.recommendation},
        )

        # Auto-transition (closes spec §14.4). Pass the just-completed
        # assignment id so the helper doesn't race a stale read-your-writes.
        state_machine.auto_transition_to_evaluated_if_complete(
            body.application_id,
            body.application_track,
            just_completed_assignment_id=body.assignment_id,
        )

    return {
        "review": review_row,
        "overall": reviewer_query._weighted_overall(review_row),
        "editWindowExpiresAt": review_row.get("locked_at"),
    }


# ─── PATCH /reviewer/reviews/{review_id} ───────────────────────────────


class ReviewPatchBody(BaseModel):
    """Edit-in-flight body. Every field optional; only set keys are written.

    `extra="forbid"` again is load-bearing — same anti-anchoring guard as
    the submit body (no `score_integrity` etc).
    """
    model_config = ConfigDict(extra="forbid")

    score_problem:    Score = None
    score_solution:   Score = None
    score_tech:       Score = None
    score_founders:   Score = None
    score_commitment: Score = None
    recommendation:   Literal["yes", "maybe", "no"] | None = None
    strengths:   str | None = None
    concerns:    str | None = None
    quick_notes: str | None = None
    flags: list[str] | None = None
    disagree_with_ai: dict[str, str] | None = None
    draft: bool | None = None  # flip draft → submitted (stamps submitted_at/locked_at)


@router.patch(
    "/reviews/{review_id}",
    dependencies=[Depends(require_capability("score_app"))],
)
async def patch_review(
    review_id: str,
    body: ReviewPatchBody,
    user: dict = Depends(get_current_user),
) -> dict:
    """Edit a review within its 60-min lock window.

    Two shapes:
      * Patch fields on an already-submitted review — allowed iff
        ``datetime.now > locked_at`` is False (returns 423 after).
      * Flip ``draft: false`` on a draft review — stamps submitted_at/locked_at,
        marks the assignment complete, audits, triggers auto-transition.

    The lock window is never extended by a PATCH — once stamped, the original
    locked_at is the hard ceiling. Open question logged in spec §14.4.
    """
    sb = get_admin_client()
    try:
        rows = (
            sb.table("reviews").select("*").eq("id", review_id).execute().data
        ) or []
    except Exception as exc:
        log.warning(
            "patch_review: review fetch failed",
            extra={"review_id": review_id, "err": str(exc)},
        )
        raise HTTPException(
            status_code=http_status.HTTP_502_BAD_GATEWAY,
            detail={"code": "review_lookup_failed"},
        ) from exc

    if not rows:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail={"code": "review_not_found"},
        )
    existing = rows[0]
    if existing["reviewer_user_id"] != user["user_id"]:
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail={"code": "not_your_review"},
        )

    # Edit lock removed (2026-06-29): reviewers may edit a submitted review at
    # any time. `locked_at` is still stamped on submit (used only for display).

    # Build the patch — only fields the body actually sent (drop `draft`,
    # which controls the submit-transition rather than being persisted).
    patch: dict = {
        k: v for k, v in body.model_dump(exclude_unset=True).items()
        if k != "draft"
    }

    # Always validate flag shape — the 80-char per-flag limit has no DB backstop.
    _validate_flags(patch.get("flags"))

    # Draft → submitted transition: stamp timestamps NOW.
    flipping_to_submitted = (
        body.draft is False and existing.get("submitted_at") is None
    )

    # Re-run submit-time invariants whenever the review is already submitted
    # OR is being flipped to submitted right now.
    must_satisfy_submit_invariants = (
        flipping_to_submitted or existing.get("submitted_at") is not None
    )

    if must_satisfy_submit_invariants:
        # Compute the final state after the patch is applied.
        final = {**existing, **patch}

        if flipping_to_submitted:
            # Completeness check only on the flip path — scores can't be
            # unset by exclude_unset semantics on a draft, but if a score
            # key is explicitly set to null on an already-submitted review
            # we catch that in the shared null check below.
            missing: list[str] = []
            for col in ("score_problem", "score_solution", "score_tech",
                        "score_founders", "score_commitment"):
                if final.get(col) is None:
                    missing.append(col)
            if final.get("recommendation") is None:
                missing.append("recommendation")
            if missing:
                raise HTTPException(
                    status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail={"code": "incomplete_review", "missing": missing},
                )
        else:
            # Already-submitted review: a caller explicitly setting a score
            # or recommendation to null would violate submit invariants.
            # Only check columns the caller actually included in this patch
            # (exclude_unset means absent keys weren't touched).
            explicitly_nulled: list[str] = []
            for col in ("score_problem", "score_solution", "score_tech",
                        "score_founders", "score_commitment", "recommendation"):
                if col in patch and patch[col] is None:
                    explicitly_nulled.append(col)
            if explicitly_nulled:
                raise HTTPException(
                    status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail={"code": "incomplete_review", "missing": explicitly_nulled},
                )

        # Submit-time gates shared by both paths: notes-required and the
        # spec §4.7 disagreement check against the merged final state.
        # Only fetch ai_screening when a score column is actually in the patch
        # OR we're flipping to submitted — avoids a redundant DB round-trip on
        # text-only edits (quick_notes, flags, etc.).
        _validate_notes(final.get("quick_notes"), draft=False)
        ai_row = None
        if flipping_to_submitted or _SCORE_COLS.intersection(patch):
            ai_row = _fetch_ai_screening_row(
                sb, existing["application_id"], existing["application_track"],
            )
        _validate_disagreements(final, ai_row, final.get("disagree_with_ai"))
    now = datetime.now(UTC)
    if flipping_to_submitted:
        patch["submitted_at"] = now.isoformat()
        patch["locked_at"] = (now + timedelta(minutes=60)).isoformat()

    if patch:
        try:
            sb.table("reviews").update(patch).eq("id", review_id).execute()
        except Exception as exc:
            log.warning(
                "patch_review: review update failed",
                extra={"review_id": review_id, "err": str(exc)},
            )
            raise HTTPException(
                status_code=http_status.HTTP_502_BAD_GATEWAY,
                detail={"code": "review_update_failed"},
            ) from exc

    if flipping_to_submitted:
        # Same post-submit fan-out as POST /reviews (assignment hygiene + audit
        # + auto-transition). Best-effort on the assignment update.
        try:
            sb.table("reviewer_assignments").update(
                {"completed_at": now.isoformat()},
            ).eq("id", existing["assignment_id"]).execute()
        except Exception as exc:
            log.warning(
                "patch_review: assignment completed_at update failed",
                extra={"assignment_id": existing.get("assignment_id"),
                       "err": str(exc)},
            )

        final_rec = (
            body.recommendation
            if body.recommendation is not None
            else existing.get("recommendation")
        )
        write_audit(
            actor_user_id=user["user_id"],
            actor_role="reviewer",
            action_type="submit_review",
            target_table="reviews",
            target_id=review_id,
            after={"recommendation": final_rec},
        )
        state_machine.auto_transition_to_evaluated_if_complete(
            existing["application_id"],
            existing["application_track"],
            just_completed_assignment_id=existing.get("assignment_id"),
        )

    final_row = {**existing, **patch}
    return {
        "review_id": review_id,
        "patched": list(patch.keys()),
        "overall": reviewer_query._weighted_overall(final_row),
        "editWindowExpiresAt": final_row.get("locked_at"),
    }


# ─── POST /reviewer/assignments/{id}/decline ───────────────────────────


class DeclineBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(..., min_length=10, max_length=2000)


@router.post(
    "/assignments/{assignment_id}/decline",
    dependencies=[Depends(require_capability("decline_assignment"))],
)
async def decline_assignment(
    assignment_id: str,
    body: DeclineBody,
    user: dict = Depends(get_current_user),
) -> dict:
    sb = get_admin_client()
    rows = (
        sb.table("reviewer_assignments")
        .select("*")
        .eq("id", assignment_id)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail={"code": "assignment_not_found"},
        )
    assignment = rows[0]
    if assignment["reviewer_user_id"] != user["user_id"]:
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail={"code": "not_your_assignment"},
        )
    if assignment.get("declined_at") is not None:
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail={"code": "already_declined"},
        )

    now = datetime.now(UTC).isoformat()
    sb.table("reviewer_assignments").update({
        "declined_at": now,
        "decline_reason": body.reason,
    }).eq("id", assignment_id).execute()

    write_audit(
        actor_user_id=user["user_id"],
        actor_role="reviewer",
        action_type="decline_assignment",
        target_table="reviewer_assignments",
        target_id=assignment_id,
        after={"declined_at": now, "decline_reason": body.reason},
    )

    # Email is best-effort — see spec §8 rule for swallowing Resend failures.
    # `send_assignment_declined` template lands in a follow-up task; the
    # hasattr guard means this endpoint works today without it.
    try:
        from ..services import email_service as _email_module
        send_fn = getattr(_email_module, "send_assignment_declined", None)
        if send_fn is None:
            # Look for it as a bound method on the singleton service instance
            # (the codebase uses both module-level and instance APIs).
            svc = getattr(_email_module, "email_service", None) or getattr(_email_module, "service", None)
            if svc is not None:
                send_fn = getattr(svc, "send_assignment_declined", None)
        if send_fn is not None:
            send_fn(
                application_id=assignment["application_id"],
                application_track=assignment["application_track"],
                reviewer_user_id=user["user_id"],
                reason=body.reason,
            )
    except Exception:
        log.exception("decline email best-effort send failed; ignored")

    return {"assignment_id": assignment_id, "declined_at": now}


# ─── GET /reviewer/reviews (completed list) + /reviews/mine (probe) ────


@router.get(
    "/reviews",
    dependencies=[Depends(require_capability("view_assigned_apps"))],
)
async def list_reviews(
    mine: bool = Query(False),
    locked: bool = Query(False),
    track: Literal["tir", "sip", "all"] = Query("all"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: dict = Depends(get_current_user),
) -> dict:
    if not mine:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail={"code": "mine_required",
                    "message": "Phase 1.5 only exposes self-reviews. Pass mine=true."},
        )
    if not locked:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail={"code": "locked_filter_required",
                    "message": "Phase 1.5 list endpoint only returns locked reviews."},
        )
    return reviewer_query.fetch_completed_reviews(
        user["user_id"], track=track, page=page, page_size=page_size,
    )


@router.get(
    "/history",
    dependencies=[Depends(require_capability("view_assigned_apps"))],
)
async def get_history(user: dict = Depends(get_current_user)) -> dict:
    """Spec §4.5 — submitted reviews + AI variance + current admin decision."""
    return reviewer_query.fetch_history(user["user_id"])


@router.get(
    "/rubric",
    dependencies=[Depends(require_capability("view_assigned_apps"))],
)
async def get_rubric(
    track: Literal["tir", "sip"] = Query("tir"),
) -> dict:
    return rubric_service.get_rubric(track)


@router.get(
    "/reviews/mine",
    dependencies=[Depends(require_capability("view_assigned_apps"))],
)
async def get_my_review(
    application_id: str = Query(..., min_length=1),
    user: dict = Depends(get_current_user),
) -> dict:
    row = reviewer_query.fetch_my_review_for_application(
        user["user_id"], application_id,
    )
    return {"review": row}
