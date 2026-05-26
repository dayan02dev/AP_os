"""SIP Applications router.

Mirror of routers/applications.py for the SIP track. Operates on
sip_applications table with require_track("sip") gating every endpoint.

Endpoints:
    GET    /sip-applications/me              fetch-or-create draft, return full row
    PATCH  /sip-applications/me              partial update, status must be 'draft'
    POST   /sip-applications/me/submit       strict validate → status='submitted'
    GET    /sip-applications/me/completion   completion_pct + missing_required_fields
    GET    /sip-applications/me/submitted    list of submitted SIP applications
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from ..deps import get_current_user, require_track
from ..models.sip_application import (
    SipApplicationRead,
    SipApplicationUpdate,
    SipCompletionStatus,
    SipSubmissionResult,
)
from ..supabase_client import get_admin_client
from ..utils.rate_limit import (
    check_rate,
    per_user_rate_limit,
    record_rate,
)

log = logging.getLogger(__name__)

router = APIRouter(
    prefix="/sip-applications",
    tags=["sip-applications"],
    dependencies=[Depends(require_track("sip"))],
)


# ─── Required fields for SIP submission ──────────────────────────────

WRITABLE_FIELDS: set[str] = set(SipApplicationUpdate.model_fields.keys())

# Always-required for SIP submit. Different from TIR — no team, no
# problem_defined, no solution_stage. SIP-specific gates take their place.
# Note: basic_org (registered company name) was removed from the wizard
# in favour of the cap-table entry; the column stays nullable.
ALWAYS_REQUIRED: list[str] = [
    # basic
    "basic_full_name", "basic_phone", "basic_email",
    "basic_degree",
    "basic_incubator_association",
    "basic_hear_about",
    # SIP-specific Section 2 gates
    "sip_incorporated", "sip_trl",
    # problem
    "problem_describe",
    # solution
    "solution_describe", "solution_core_tech",
    # SIP-specific Section 4 traction
    "sip_traction", "sip_traction_details",
    # execution
    "execution_milestone", "execution_infrastructure",
    # SIP-specific Section 6 evidence
    "sip_pitch_deck",
    # declarations
    "declaration_truthful", "declaration_ref_checks", "declaration_terms",
]

LONG_TEXT_MIN_WORDS: dict[str, int] = {}

_PHONE_RE = re.compile(r"^\+?[\d][\d\s\-\(\)]{5,19}$")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# ─── Per-user rate-limit dependencies ────────────────────────────────

_rl_get = per_user_rate_limit("sip-applications-get", 60, 60)
_rl_patch = per_user_rate_limit("sip-applications-patch", 30, 60)
_rl_completion = per_user_rate_limit("sip-applications-completion", 60, 60)

_SUBMIT_MAX = 5
_SUBMIT_WINDOW_S = 3600


# ─── Helpers ─────────────────────────────────────────────────────────

def _error(status_code: int, code: str, message: str, **extra: Any) -> JSONResponse:
    body: dict[str, Any] = {"error": {"code": code, "message": message}}
    body["error"].update(extra)
    return JSONResponse(status_code=status_code, content=body)


def _new_request_id() -> str:
    return uuid.uuid4().hex[:12]


def _is_filled(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str) and not value.strip():
        return False
    if isinstance(value, list) and not value:
        return False
    if isinstance(value, dict) and not value:
        return False
    if isinstance(value, bool):
        return value
    return True


def _required_fields(row: dict[str, Any]) -> list[str]:
    """SIP required fields with conditional logic."""
    required = list(ALWAYS_REQUIRED)

    # Conditional: if not incorporated → early exit, no further questions
    # required (the early-exit screen short-circuits the wizard).
    if row.get("sip_incorporated") == "Not yet — we're still pre-incorporation":
        return ["sip_incorporated"]

    # Conditional: TRL too low → early exit
    if row.get("sip_trl") == "TRL 3 or earlier — research stage":
        return ["sip_incorporated", "sip_trl"]

    if row.get("basic_incubator_association") == "Yes":
        required.append("basic_incubator_details")

    return required


def _completion_pct(row: dict[str, Any]) -> tuple[int, list[str]]:
    required = _required_fields(row)
    if not required:
        return 0, required
    missing = [f for f in required if not _is_filled(row.get(f))]
    pct = round((len(required) - len(missing)) / len(required) * 100)
    return pct, missing


def _validate_submission(row: dict[str, Any]) -> tuple[list[str], list[dict[str, str]]]:
    """Strict validation for POST /submit."""
    missing: list[str] = []
    invalid: list[dict[str, str]] = []

    for field in _required_fields(row):
        if not _is_filled(row.get(field)):
            missing.append(field)

    for d in ("declaration_truthful", "declaration_ref_checks", "declaration_terms"):
        if row.get(d) is not True and d not in missing:
            missing.append(d)

    full_name = row.get("basic_full_name")
    if full_name is not None:
        stripped = full_name.strip()
        if not (2 <= len(stripped) <= 200):
            invalid.append({"field": "basic_full_name",
                            "reason": "must be 2–200 characters"})

    phone = row.get("basic_phone")
    if phone and not _PHONE_RE.match(phone.strip()):
        invalid.append({"field": "basic_phone",
                        "reason": "not a valid phone number"})

    email = row.get("basic_email")
    if email and not _EMAIL_RE.match(email.strip()):
        invalid.append({"field": "basic_email", "reason": "not a valid email address"})

    return missing, invalid


# ─── DB helpers ──────────────────────────────────────────────────────

def _fetch_application(user_id: str) -> dict[str, Any] | None:
    res = (
        get_admin_client()
        .table("sip_applications")
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
    res = (
        get_admin_client()
        .table("sip_applications")
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
        .table("sip_applications")
        .insert({"user_id": user_id})
        .execute()
    )
    rows = res.data or []
    if not rows:
        raise RuntimeError("insert returned no rows")
    return rows[0]


def _update_application(application_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    res = (
        get_admin_client()
        .table("sip_applications")
        .update(patch)
        .eq("id", application_id)
        .execute()
    )
    rows = res.data or []
    if not rows:
        raise RuntimeError("update returned no rows")
    return rows[0]


def _audit(*, user_id: str, action: str, metadata: dict[str, Any],
           request: Request | None = None) -> None:
    try:
        get_admin_client().table("audit_logs").insert({
            "user_id": user_id,
            "action": action,
            "metadata": metadata,
            "ip_address": (request.client.host if request and request.client else None),
            "user_agent": (request.headers.get("user-agent") if request else None),
        }).execute()
    except Exception:
        log.warning("audit log insert failed",
                    extra={"action": action, "user_id": user_id})


def _send_submission_email(user_id: str, email: str, full_name: str,
                            application_id: str) -> None:
    try:
        from ..services.email_service import get_email_service
        get_email_service().send_submission_confirmation(
            to=email,
            applicant_name=full_name or email,
            application_id=application_id,
            track="sip",
        )
    except NotImplementedError:
        log.warning("submission email skipped",
                    extra={"user_id": user_id, "track": "sip"})
    except Exception as exc:
        log.warning("submission email delivery failed",
                    extra={"user_id": user_id, "track": "sip", "err": str(exc)})


# ─── Routes ──────────────────────────────────────────────────────────

@router.get("/me", response_model=SipApplicationRead, dependencies=[Depends(_rl_get)])
async def get_application(current_user: dict = Depends(get_current_user)):
    req_id = _new_request_id()
    user_id = current_user["user_id"]

    try:
        row = _fetch_application(user_id)
        if row is None:
            row = _create_draft(user_id)
    except Exception:
        log.exception("sip_applications.get failed",
                      extra={"request_id": req_id, "user_id": user_id})
        return _error(status.HTTP_500_INTERNAL_SERVER_ERROR, "fetch_failed",
                      f"Could not load SIP application (ref {req_id}).")

    return SipApplicationRead.model_validate(row)


@router.patch("/me", response_model=SipApplicationRead,
              dependencies=[Depends(_rl_patch)])
async def patch_application(
    request: Request,
    body: dict[str, Any],
    current_user: dict = Depends(get_current_user),
):
    req_id = _new_request_id()
    user_id = current_user["user_id"]

    if not isinstance(body, dict):
        return _error(status.HTTP_400_BAD_REQUEST, "invalid_body",
                      "Request body must be a JSON object.")

    # Soft-drop unknown fields rather than failing the whole batch.
    # Combined with SipApplicationUpdate's extra="ignore", any stale field
    # (e.g. from a wizard schema that's drifted from the DB) is logged for
    # visibility and silently stripped — never poisoning saves of the
    # other valid fields in the same PATCH.
    unknown = sorted(k for k in body if k not in WRITABLE_FIELDS)
    if unknown:
        log.warning(
            "sip-applications PATCH dropped unknown fields",
            extra={"user_id": user_id, "ref": req_id, "unknown": unknown},
        )
        body = {k: v for k, v in body.items() if k in WRITABLE_FIELDS}
        if not body:
            return _error(status.HTTP_400_BAD_REQUEST, "empty_patch",
                          "No writable fields in request body.",
                          unknown=unknown)

    try:
        patch_model = SipApplicationUpdate(**body)
    except ValidationError as exc:
        return _error(status.HTTP_422_UNPROCESSABLE_ENTITY, "validation_error",
                      "One or more fields failed validation.",
                      errors=exc.errors())

    patch_dict: dict[str, Any] = patch_model.model_dump(exclude_unset=True)
    if not patch_dict:
        return _error(status.HTTP_400_BAD_REQUEST, "empty_patch",
                      "At least one writable field is required.")

    try:
        current_row = _fetch_application(user_id) or _create_draft(user_id)
    except Exception:
        log.exception("sip_applications.patch fetch failed",
                      extra={"request_id": req_id, "user_id": user_id})
        return _error(status.HTTP_500_INTERNAL_SERVER_ERROR, "fetch_failed",
                      f"Could not load SIP application (ref {req_id}).")

    if current_row.get("status") != "draft":
        return _error(status.HTTP_409_CONFLICT, "not_draft",
                      f"Application is already {current_row.get('status')}.")

    merged = {**current_row, **patch_dict}
    new_pct, _missing = _completion_pct(merged)
    patch_dict["completion_pct"] = new_pct

    try:
        updated = _update_application(current_row["id"], patch_dict)
    except Exception:
        log.exception("sip_applications.patch update failed",
                      extra={"request_id": req_id, "user_id": user_id})
        return _error(status.HTTP_500_INTERNAL_SERVER_ERROR, "update_failed",
                      f"Could not save changes (ref {req_id}).")

    _audit(user_id=user_id, action="sip_application.section_saved",
           metadata={"fields": sorted(patch_dict.keys())}, request=request)

    return SipApplicationRead.model_validate(updated)


@router.post("/me/submit", response_model=SipSubmissionResult)
async def submit_application(
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    req_id = _new_request_id()
    user_id = current_user["user_id"]

    check_rate("sip-applications-submit", user_id, _SUBMIT_MAX, _SUBMIT_WINDOW_S)

    try:
        row = _fetch_application(user_id)
    except Exception:
        log.exception("sip_applications.submit fetch failed",
                      extra={"request_id": req_id, "user_id": user_id})
        return _error(status.HTTP_500_INTERNAL_SERVER_ERROR, "fetch_failed",
                      f"Could not load SIP application (ref {req_id}).")

    if row is None:
        return _error(status.HTTP_404_NOT_FOUND, "no_application",
                      "No application found to submit.")

    if row.get("status") != "draft":
        return _error(status.HTTP_409_CONFLICT, "not_draft",
                      f"Application is already {row.get('status')}.")

    # Cross-track submission lock REMOVED 2026-05-26 per business decision —
    # applicants may now submit to BOTH tracks. Prior block (Task 10 of SIP
    # cutover plan) preserved in git history if we need to revert.

    missing, invalid = _validate_submission(row)
    if missing or invalid:
        log.info(
            "sip_applications.submit accepted with gaps",
            extra={"request_id": req_id, "user_id": user_id,
                   "missing_fields": sorted(set(missing)),
                   "invalid_fields": invalid,
                   "completion_pct": row.get("completion_pct")},
        )

    snapshot_pct, _ = _completion_pct(row)

    try:
        submitted = _update_application(row["id"], {
            "status": "submitted",
            "completion_pct": snapshot_pct,
        })
    except Exception:
        log.exception("sip_applications.submit update failed",
                      extra={"request_id": req_id, "user_id": user_id})
        return _error(status.HTTP_500_INTERNAL_SERVER_ERROR, "submit_failed",
                      f"Could not submit application (ref {req_id}).")

    record_rate("sip-applications-submit", user_id)

    _audit(user_id=user_id, action="sip_application.submitted",
           metadata={"application_id": submitted["id"]}, request=request)

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

    return SipSubmissionResult(
        ok=True,
        application_id=submitted["id"],
        submitted_at=submitted_at_dt,
    )


@router.get("/me/submitted", response_model=list[SipApplicationRead],
            dependencies=[Depends(_rl_get)])
async def list_submitted_applications(current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    try:
        rows = _fetch_submitted_applications(user_id)
    except Exception:
        log.exception("sip_applications.list_submitted failed",
                      extra={"user_id": user_id})
        return _error(status.HTTP_500_INTERNAL_SERVER_ERROR, "fetch_failed",
                      "Could not load past applications.")
    return [SipApplicationRead.model_validate(r) for r in rows]


@router.get("/me/completion", response_model=SipCompletionStatus,
            dependencies=[Depends(_rl_completion)])
async def get_completion(current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    try:
        row = _fetch_application(user_id) or _create_draft(user_id)
    except Exception:
        log.exception("sip_applications.completion fetch failed",
                      extra={"user_id": user_id})
        return _error(status.HTTP_500_INTERNAL_SERVER_ERROR, "fetch_failed",
                      "Could not load completion status.")

    pct, missing = _completion_pct(row)
    return SipCompletionStatus(
        completion_pct=pct,
        missing_required_fields=missing,
        current_section=row.get("current_section"),
    )
