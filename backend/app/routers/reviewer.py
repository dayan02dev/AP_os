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
from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from pydantic import BaseModel, ConfigDict, Field, conint

from ..deps import get_current_user
from ..rbac import require_capability
from ..services import reviewer_query, state_machine
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
    score_problem:    conint(ge=0, le=10) | None = None
    score_solution:   conint(ge=0, le=10) | None = None
    score_tech:       conint(ge=0, le=10) | None = None
    score_founders:   conint(ge=0, le=10) | None = None
    score_commitment: conint(ge=0, le=10) | None = None
    recommendation:   Literal["yes", "maybe", "no"] | None = None
    strengths:   str | None = None
    concerns:    str | None = None
    quick_notes: str | None = None
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

    return {"review": review_row}


# ─── PATCH /reviewer/reviews/{review_id} ───────────────────────────────


class ReviewPatchBody(BaseModel):
    """Edit-in-flight body. Every field optional; only set keys are written.

    `extra="forbid"` again is load-bearing — same anti-anchoring guard as
    the submit body (no `score_integrity` etc).
    """
    model_config = ConfigDict(extra="forbid")

    score_problem:    conint(ge=0, le=10) | None = None
    score_solution:   conint(ge=0, le=10) | None = None
    score_tech:       conint(ge=0, le=10) | None = None
    score_founders:   conint(ge=0, le=10) | None = None
    score_commitment: conint(ge=0, le=10) | None = None
    recommendation:   Literal["yes", "maybe", "no"] | None = None
    strengths:   str | None = None
    concerns:    str | None = None
    quick_notes: str | None = None
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

    # Lock check — only meaningful for already-submitted (non-draft) reviews
    locked_at_str = existing.get("locked_at")
    if locked_at_str:
        locked_at = datetime.fromisoformat(locked_at_str.replace("Z", "+00:00"))
        # Strict `>` so a PATCH at the exact instant is still allowed
        if datetime.now(UTC) > locked_at:
            raise HTTPException(
                status_code=http_status.HTTP_423_LOCKED,
                detail={
                    "code": "review_locked",
                    "message": f"Edit window closed at {locked_at.isoformat()}.",
                },
            )

    # Build the patch — only fields the body actually sent (drop `draft`,
    # which controls the submit-transition rather than being persisted).
    patch: dict = {
        k: v for k, v in body.model_dump(exclude_unset=True).items()
        if k != "draft"
    }

    # Draft → submitted transition: stamp timestamps NOW.
    flipping_to_submitted = (
        body.draft is False and existing.get("submitted_at") is None
    )
    if flipping_to_submitted:
        # Compute the final state after the patch is applied.
        final = {**existing, **patch}
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

    return {"review_id": review_id, "patched": list(patch.keys())}
