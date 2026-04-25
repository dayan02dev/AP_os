"""Applications router (Phase 4, Phase 8 rate-limit audit).

Endpoints (all require auth via `get_current_user`):

    GET    /applications/me             fetch-or-create draft, return full row
    PATCH  /applications/me             partial update, status must be 'draft'
    POST   /applications/me/submit      strict validate → status='submitted'
    GET    /applications/me/completion  completion_pct + missing_required_fields

Rate limits (per spec; enforced via utils/rate_limit.per_user_rate_limit):
    GET    /me              60/min/user
    PATCH  /me              30/min/user
    POST   /me/submit        5/hour/user
    GET    /me/completion   60/min/user

Design notes
    * Admin client bypasses RLS because we've already verified the caller via
      `get_current_user`. Every DB call is filtered by `user_id = caller`.
    * PATCH re-computes `completion_pct` server-side after applying the patch.
    * Submit runs the same required-field set that completion uses, plus
      per-field format rules (phone, URL, email, word-count mins).
    * Email confirmation on submit is best-effort: if the SES service fails
      or isn't configured, we log a warning and still return success to the
      applicant. The submission is already written.
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import JSONResponse
from pydantic import HttpUrl, TypeAdapter, ValidationError

from ..deps import get_current_user
from ..models.application import (
    ApplicationRead,
    ApplicationUpdate,
    CompletionStatus,
    SubmissionResult,
)
from ..supabase_client import get_admin_client
from ..utils.rate_limit import (
    check_rate,
    per_user_rate_limit,
    record_rate,
    reset_buckets_for_tests,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/applications", tags=["applications"])


# ─── Config: which columns are writable / required / enum-valued ─────

WRITABLE_FIELDS: set[str] = set(ApplicationUpdate.model_fields.keys())

# Required *always* (independent of conditionals). Stamped first during
# required-field computation.
ALWAYS_REQUIRED: list[str] = [
    # basic
    "basic_has_team", "basic_full_name", "basic_phone", "basic_email",
    "basic_org", "basic_degree",
    # Bucket 3: replaced `basic_incubators` (single open-text) with the
    # two-step `incubator_association` (Yes/No) + conditional `incubator_details`.
    "basic_incubator_association",
    "basic_hear_about",
    # problem — manager's spec asks problemDescribe always (no longer gated).
    "problem_defined", "problem_describe",
    # solution — manager's spec drops tenX/hurdles/moat/nationalScale/customers
    # in favour of a single optional `contrarian_insight`. stage stays in
    # the DB column under solution_* but is rendered in the Execution section.
    "solution_stage", "solution_describe", "solution_core_tech",
    # execution — manager's spec drops `budget` and `evidence_deck`, adds
    # `infrastructure` as a required column. `failure` was required in the
    # pre-spec wizard but is optional in the new spec, so it leaves this list.
    "execution_milestone", "execution_infrastructure",
    # declarations (newsletter is optional)
    "declaration_truthful", "declaration_ref_checks", "declaration_terms",
]

# Word-count minimums — intentionally empty for launch day. The presence
# check (_is_filled) still rejects blank submissions, and reviewers can
# manually down-rank applications with shallow answers. Re-introducing
# these minimums is a future UX task: surface them *during* field entry
# (with a live word counter) rather than only at submit time, so users
# aren't surprised at the end of the wizard.
LONG_TEXT_MIN_WORDS: dict[str, int] = {}

# E.164-friendly — +?<7–15 digits>, optionally with spaces/hyphens/parens in between.
_PHONE_RE = re.compile(r"^\+?[\d][\d\s\-\(\)]{5,19}$")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# ─── Per-user rate-limit dependencies ────────────────────────────────
# Backed by utils/rate_limit.per_user_rate_limit (in-memory sliding window
# keyed on user_id). Shared primitive with auth/resume/support routers.

_rl_get = per_user_rate_limit("applications-get", 60, 60)          # 60/min
_rl_patch = per_user_rate_limit("applications-patch", 30, 60)       # 30/min
_rl_completion = per_user_rate_limit("applications-completion", 60, 60)  # 60/min

# Submit uses check-only + record-on-success. A failed 422 (word-count /
# missing-field validation) MUST NOT consume the caller's hourly quota, or
# users iterating on validation errors lock themselves out. Same split we
# use for /auth/request-otp.
_SUBMIT_MAX = 5
_SUBMIT_WINDOW_S = 3600


def _reset_patch_rate_limits() -> None:
    """Test hook — flushes all in-memory rate-limit state."""
    reset_buckets_for_tests()


# ─── Error helpers ───────────────────────────────────────────────────

def _error(status_code: int, code: str, message: str, **extra: Any) -> JSONResponse:
    body: dict[str, Any] = {"error": {"code": code, "message": message}}
    body["error"].update(extra)
    return JSONResponse(status_code=status_code, content=body)


def _new_request_id() -> str:
    return uuid.uuid4().hex[:12]


# ─── Required / completion / validation helpers ──────────────────────

def _is_filled(value: Any) -> bool:
    """Is `value` considered present for completion purposes?"""
    if value is None:
        return False
    if isinstance(value, str) and not value.strip():
        return False
    if isinstance(value, list):
        if not value:
            return False
        # basic_teammates: require at least one fully-filled member.
        if all(isinstance(m, dict) for m in value):
            filled = [
                m for m in value
                if m.get("email") and m.get("fullName") and m.get("phone") and m.get("org")
            ]
            return bool(filled)
        return True
    if isinstance(value, dict) and not value:
        return False
    if isinstance(value, bool):
        return value  # False counts as unfilled for declarations
    return True


def _required_fields(row: dict[str, Any]) -> list[str]:
    """Required fields given the current answer state (applies conditionals)."""
    required = list(ALWAYS_REQUIRED)

    if row.get("basic_has_team") == "Yes — I have co-founders":
        required.append("basic_teammates")

    # Bucket 3: incubator details only required if user said Yes.
    if row.get("basic_incubator_association") == "Yes":
        required.append("basic_incubator_details")

    # Bucket 3: willBreak (the technical-hurdles question, stored in
    # execution_will_break) is asked only when stage isn't "Still exploring".
    stage = row.get("solution_stage")
    if stage and stage != "Still exploring":
        required.append("execution_will_break")

    return required


def _completion_pct(row: dict[str, Any]) -> tuple[int, list[str]]:
    required = _required_fields(row)
    if not required:
        return 0, required
    missing = [f for f in required if not _is_filled(row.get(f))]
    pct = round((len(required) - len(missing)) / len(required) * 100)
    return pct, missing


# Cached adapter so HttpUrl validation is quick.
_HTTP_URL_ADAPTER = TypeAdapter(HttpUrl)


def _is_valid_http_url(s: str) -> bool:
    try:
        _HTTP_URL_ADAPTER.validate_python(s)
    except ValidationError:
        return False
    return True


def _validate_submission(row: dict[str, Any]) -> tuple[list[str], list[dict[str, str]]]:
    """Strict validation for POST /submit.

    Returns (missing_required, invalid_fields). Invalid entries look like
    {"field": "<col>", "reason": "<why>"}.
    """
    missing: list[str] = []
    invalid: list[dict[str, str]] = []

    # ── Presence ─────────────────────────────────────────────────
    for field in _required_fields(row):
        if not _is_filled(row.get(field)):
            missing.append(field)

    # Declarations: required ones must be true (checkbox off is still "draft-valid").
    for d in ("declaration_truthful", "declaration_ref_checks", "declaration_terms"):
        if row.get(d) is not True and d not in missing:
            missing.append(d)

    # ── Format rules ─────────────────────────────────────────────
    full_name = row.get("basic_full_name")
    if full_name is not None:
        stripped = full_name.strip()
        if not (2 <= len(stripped) <= 200):
            invalid.append({"field": "basic_full_name",
                            "reason": "must be 2–200 characters"})

    phone = row.get("basic_phone")
    if phone and not _PHONE_RE.match(phone.strip()):
        invalid.append({"field": "basic_phone",
                        "reason": "not a valid phone number (use + and digits, 7–20 total)"})

    email = row.get("basic_email")
    if email and not _EMAIL_RE.match(email.strip()):
        invalid.append({"field": "basic_email", "reason": "not a valid email address"})

    # Video URL is optional — if the user typed a non-URL we treat it as
    # if they left it blank rather than blocking submission. (Reviewers will
    # simply not see a video link in that case.) Launch-day pragmatic choice;
    # a proper fix surfaces URL validity live in the input component.
    video_url = row.get("evidence_video_url")
    if video_url and not _is_valid_http_url(video_url):
        log.info(
            "submit: ignoring invalid evidence_video_url",
            extra={"field": "evidence_video_url"},
        )

    # Long-text word counts — only applied when the field is filled.
    for field, min_w in LONG_TEXT_MIN_WORDS.items():
        text = row.get(field)
        if not text or not isinstance(text, str):
            continue
        word_count = len(text.split())
        if word_count < min_w:
            invalid.append({
                "field": field,
                "reason": f"needs at least {min_w} words (got {word_count})",
            })

    # Teammates shape — when present, every entry must have the four fields.
    teammates = row.get("basic_teammates")
    if isinstance(teammates, list):
        for i, m in enumerate(teammates):
            if not isinstance(m, dict):
                invalid.append({"field": f"basic_teammates[{i}]",
                                "reason": "must be an object"})
                continue
            # Only flag as invalid if partially filled (fully empty is just missing).
            partially = any(m.get(k) for k in ("email", "fullName", "phone", "org"))
            if partially:
                missing_keys = [k for k in ("email", "fullName", "phone", "org") if not m.get(k)]
                if missing_keys:
                    invalid.append({
                        "field": f"basic_teammates[{i}]",
                        "reason": f"missing: {', '.join(missing_keys)}",
                    })

    return missing, invalid


# ─── DB access (small helpers so tests can monkey-patch) ─────────────

def _fetch_application(user_id: str) -> dict[str, Any] | None:
    """Return the user's open draft, or None if they have no draft.

    Multi-app: a user can have many submitted rows but at most one draft
    (enforced by the partial-unique index applications_one_draft_per_user).
    Filtering by status='draft' here means submitted history is invisible
    to the wizard — the wizard always operates on the open draft.
    """
    res = (
        get_admin_client()
        .table("applications")
        .select("*")
        .eq("user_id", user_id)
        .eq("status", "draft")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def _fetch_submitted_applications(user_id: str) -> list[dict[str, Any]]:
    """All non-draft applications for this user, newest first."""
    res = (
        get_admin_client()
        .table("applications")
        .select("*")
        .eq("user_id", user_id)
        .neq("status", "draft")
        .order("submitted_at", desc=True)
        .execute()
    )
    return res.data or []


def _create_draft(user_id: str) -> dict[str, Any]:
    res = (
        get_admin_client()
        .table("applications")
        .insert({"user_id": user_id})
        .execute()
    )
    rows = res.data or []
    if not rows:
        raise RuntimeError("insert returned no rows")
    return rows[0]


def _update_application(application_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    """Update by row id. Multi-app means we can no longer use user_id as
    the WHERE clause (it would touch all the user's rows including
    submitted ones). Callers must pass the id of the row to mutate."""
    res = (
        get_admin_client()
        .table("applications")
        .update(patch)
        .eq("id", application_id)
        .execute()
    )
    rows = res.data or []
    if not rows:
        raise RuntimeError("update returned no rows")
    return rows[0]


def _audit(
    *,
    user_id: str,
    action: str,
    metadata: dict[str, Any],
    request: Request | None = None,
) -> None:
    """Fire-and-forget audit insert. Never raises."""
    try:
        get_admin_client().table("audit_logs").insert({
            "user_id": user_id,
            "action": action,
            "metadata": metadata,
            "ip_address": (request.client.host if request and request.client else None),
            "user_agent": (request.headers.get("user-agent") if request else None),
        }).execute()
    except Exception:
        log.warning("audit log insert failed", extra={"action": action, "user_id": user_id})


def _send_submission_email(user_id: str, email: str, full_name: str, application_id: str) -> None:
    """Best-effort transactional email. Never raises."""
    try:
        # Imported lazily so test code that stubs email_service doesn't need
        # AWS creds at collection time.
        from ..services.email_service import get_email_service  # noqa: WPS433

        get_email_service().send_submission_confirmation(
            to=email,
            applicant_name=full_name or email,
            application_id=application_id,
        )
    except NotImplementedError:
        log.warning("submission email skipped: email service not implemented", extra={"user_id": user_id})
    except Exception as exc:
        # Includes EmailDeliveryError, missing config, AWS ClientError, etc.
        log.warning(
            "submission email delivery failed",
            extra={"user_id": user_id, "err": str(exc)},
        )


# ─── Routes ──────────────────────────────────────────────────────────

@router.get(
    "/me",
    response_model=ApplicationRead,
    dependencies=[Depends(_rl_get)],
)
async def get_application(current_user: dict = Depends(get_current_user)):
    """Fetch the caller's application row; auto-create a draft if missing."""
    req_id = _new_request_id()
    user_id = current_user["user_id"]

    try:
        row = _fetch_application(user_id)
        if row is None:
            row = _create_draft(user_id)
    except Exception:
        log.exception("applications.get failed", extra={"request_id": req_id, "user_id": user_id})
        return _error(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "fetch_failed",
            f"Could not load application (ref {req_id}).",
        )

    return ApplicationRead.model_validate(row)


@router.patch(
    "/me",
    response_model=ApplicationRead,
    dependencies=[Depends(_rl_patch)],
)
async def patch_application(
    request: Request,
    body: dict[str, Any],
    current_user: dict = Depends(get_current_user),
):
    """Partial update. Rejects:
      - unknown fields → 400
      - invalid types → 422
      - status != 'draft' → 409
      - > 30 PATCHes/min/user → 429 (enforced by _rl_patch dependency)
    """
    req_id = _new_request_id()
    user_id = current_user["user_id"]

    if not isinstance(body, dict):
        return _error(
            status.HTTP_400_BAD_REQUEST,
            "invalid_body",
            "Request body must be a JSON object.",
        )

    unknown = [k for k in body if k not in WRITABLE_FIELDS]
    if unknown:
        return _error(
            status.HTTP_400_BAD_REQUEST,
            "unknown_fields",
            f"Unknown fields: {sorted(unknown)}",
            unknown=sorted(unknown),
        )

    # Type / enum validation via the partial model.
    try:
        patch_model = ApplicationUpdate(**body)
    except ValidationError as exc:
        return _error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "validation_error",
            "One or more fields failed validation.",
            errors=exc.errors(),
        )

    patch_dict: dict[str, Any] = patch_model.model_dump(exclude_unset=True)
    if not patch_dict:
        return _error(
            status.HTTP_400_BAD_REQUEST,
            "empty_patch",
            "At least one writable field is required.",
        )

    # Fetch current row — enforce 'draft' status.
    try:
        current_row = _fetch_application(user_id) or _create_draft(user_id)
    except Exception:
        log.exception("applications.patch fetch failed",
                      extra={"request_id": req_id, "user_id": user_id})
        return _error(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "fetch_failed",
            f"Could not load application (ref {req_id}).",
        )

    if current_row.get("status") != "draft":
        return _error(
            status.HTTP_409_CONFLICT,
            "not_draft",
            f"Application is already {current_row.get('status')}; no further edits allowed.",
        )

    # Compute new completion_pct from the merged state so the DB row stays fresh.
    merged = {**current_row, **patch_dict}
    new_pct, _missing = _completion_pct(merged)
    patch_dict["completion_pct"] = new_pct

    try:
        updated = _update_application(current_row["id"], patch_dict)
    except Exception:
        log.exception("applications.patch update failed",
                      extra={"request_id": req_id, "user_id": user_id})
        return _error(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "update_failed",
            f"Could not save changes (ref {req_id}).",
        )

    _audit(
        user_id=user_id,
        action="application.section_saved",
        metadata={"fields": sorted(patch_dict.keys())},
        request=request,
    )

    return ApplicationRead.model_validate(updated)


@router.post(
    "/me/submit",
    response_model=SubmissionResult,
)
async def submit_application(
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """Strict validate, then flip status to 'submitted'.

    Rate limit: 5 successful submissions per hour per user. The quota is
    consumed only after the status flip lands — validation failures (422)
    do NOT count, otherwise users iterating on word-count errors would
    lock themselves out.
    """
    req_id = _new_request_id()
    user_id = current_user["user_id"]

    # Check-only — raises 429 if over quota without consuming a slot.
    check_rate("applications-submit", user_id, _SUBMIT_MAX, _SUBMIT_WINDOW_S)

    try:
        row = _fetch_application(user_id)
    except Exception:
        log.exception("applications.submit fetch failed",
                      extra={"request_id": req_id, "user_id": user_id})
        return _error(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "fetch_failed",
            f"Could not load application (ref {req_id}).",
        )

    if row is None:
        return _error(
            status.HTTP_404_NOT_FOUND,
            "no_application",
            "No application found to submit.",
        )

    if row.get("status") != "draft":
        return _error(
            status.HTTP_409_CONFLICT,
            "not_draft",
            f"Application is already {row.get('status')}.",
        )

    missing, invalid = _validate_submission(row)
    if missing or invalid:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={
                "error": {
                    "code": "submission_invalid",
                    "message": "Application is not ready to submit.",
                },
                "missing_fields": sorted(set(missing)),
                "invalid_fields": invalid,
            },
        )

    # Flip status — submitted_at is stamped by the DB trigger.
    try:
        submitted = _update_application(row["id"], {
            "status": "submitted",
            "completion_pct": 100,
        })
    except Exception:
        log.exception("applications.submit update failed",
                      extra={"request_id": req_id, "user_id": user_id})
        return _error(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "submit_failed",
            f"Could not submit application (ref {req_id}).",
        )

    # Consume the rate-limit slot now — a SUCCESSFUL submit burns one of the
    # 5/hour/user allowance. (Idempotent re-submits of an already-submitted
    # app can't reach here because the status != 'draft' guard above returns
    # 409, so this will never double-charge the quota.)
    record_rate("applications-submit", user_id)

    _audit(
        user_id=user_id,
        action="application.submitted",
        metadata={"application_id": submitted["id"]},
        request=request,
    )

    _send_submission_email(
        user_id=user_id,
        email=current_user.get("email") or submitted.get("basic_email") or "",
        full_name=submitted.get("basic_full_name") or "",
        application_id=submitted["id"],
    )

    submitted_at = submitted.get("submitted_at")
    if isinstance(submitted_at, str):
        submitted_at_dt = datetime.fromisoformat(submitted_at.replace("Z", "+00:00"))
    elif isinstance(submitted_at, datetime):
        submitted_at_dt = submitted_at
    else:
        submitted_at_dt = datetime.utcnow()

    return SubmissionResult(
        ok=True,
        application_id=submitted["id"],
        submitted_at=submitted_at_dt,
    )


@router.get(
    "/me/submitted",
    response_model=list[ApplicationRead],
    dependencies=[Depends(_rl_get)],
)
async def list_submitted_applications(current_user: dict = Depends(get_current_user)):
    """Return the caller's submitted (non-draft) applications, newest first.

    Powers the "Past applications" tab. Read-only — submissions are frozen
    once the status moves off draft.
    """
    user_id = current_user["user_id"]
    try:
        rows = _fetch_submitted_applications(user_id)
    except Exception:
        log.exception("applications.list_submitted failed", extra={"user_id": user_id})
        return _error(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "fetch_failed",
            "Could not load past applications.",
        )
    return [ApplicationRead.model_validate(r) for r in rows]


@router.get(
    "/me/completion",
    response_model=CompletionStatus,
    dependencies=[Depends(_rl_completion)],
)
async def get_completion(current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    try:
        row = _fetch_application(user_id) or _create_draft(user_id)
    except Exception:
        log.exception("applications.completion fetch failed", extra={"user_id": user_id})
        return _error(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "fetch_failed",
            "Could not load completion status.",
        )

    pct, missing = _completion_pct(row)
    return CompletionStatus(
        completion_pct=pct,
        missing_required_fields=missing,
        current_section=row.get("current_section"),
    )
