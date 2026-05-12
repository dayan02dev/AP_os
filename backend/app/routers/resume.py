"""Resume upload + parse pipeline (Phase 5, Phase 8 rate-limit audit).

Four endpoints:
  POST /resume/upload                  — upload, store, parse inline
  GET  /resume/me                      — latest resume for caller
  GET  /resume/{resume_id}             — specific resume (owner only)
  POST /resume/me/apply-to-application — null-guarded copy into profiles/applications

Rate limits (per-user, via utils/rate_limit.per_user_rate_limit):
  POST /upload                     5/hour/user
  GET  /me                         30/min/user
  GET  /{resume_id}                30/min/user
  POST /me/apply-to-application    10/hour/user

Parsing is inline on upload. At ~1000 apps over 4 months, an SQS+worker split
would be over-engineering. If volume changes, pull the `_parse_inline` call
out and publish a message instead — the rest of this file doesn't care.
"""

import logging
import time
import uuid
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status

from ..deps import get_current_user, require_track
from ..models.resume import (
    ApplyToApplicationResult,
    ResumeRecord,
    ResumeUploadResponse,
)
from ..services.file_parser import UnsupportedFileType, extract_text
from ..services.llm_service import LLMParseError, OpenRouterClient
from ..supabase_client import get_admin_client
from ..utils.rate_limit import per_user_rate_limit

# Per-user rate-limit dependencies — all keyed on the authed user's id.
_rl_upload = per_user_rate_limit("resume-upload", 5, 3600)          # 5/hour
_rl_get_me = per_user_rate_limit("resume-get-me", 30, 60)           # 30/min
_rl_get_id = per_user_rate_limit("resume-get-id", 30, 60)           # 30/min
_rl_apply = per_user_rate_limit("resume-apply", 10, 3600)           # 10/hour

log = logging.getLogger(__name__)

router = APIRouter(
    prefix="/resume",
    tags=["resume"],
    dependencies=[Depends(require_track("tir"))],
)

MAX_UPLOAD_BYTES = 10 * 1024 * 1024
ALLOWED_MIME_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/msword",
}
MIME_TO_EXT = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/msword": "doc",
}

# Skip parsing if the request has already burned most of a 30s Lambda budget.
# Once Phase 9 adds a background worker, flip to always-enqueue; for now a
# skip leaves parse_status='pending' with nothing to retry.
PARSE_BUDGET_SECONDS = 22.0


@router.post(
    "/upload",
    response_model=ResumeUploadResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_rl_upload)],
)
async def upload_resume(
    request: Request,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    start = time.monotonic()
    user_id = current_user["user_id"]

    mime = (file.content_type or "").lower()
    if mime not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"Unsupported file type: {mime!r}. Accepted: PDF, DOCX, DOC.",
        )

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Empty file.")
    if len(file_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)} MiB.",
        )

    ext = MIME_TO_EXT[mime]
    storage_path = f"{user_id}/{uuid.uuid4()}.{ext}"
    admin = get_admin_client()
    try:
        admin.storage.from_("tir-resumes").upload(
            path=storage_path,
            file=file_bytes,
            file_options={"content-type": mime},
        )
    except Exception as exc:
        log.error("storage upload failed", extra={"user_id": user_id, "err": str(exc)})
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Storage upload failed.",
        ) from exc

    try:
        insert = (
            admin.table("tir_resume_uploads")
            .insert(
                {
                    "user_id": user_id,
                    "storage_path": storage_path,
                    "original_filename": file.filename or f"resume.{ext}",
                    "file_size_bytes": len(file_bytes),
                    "mime_type": mime,
                    "parse_status": "pending",
                }
            )
            .execute()
        )
        row = (insert.data or [None])[0]
        if not row:
            raise RuntimeError("insert returned no rows")
        resume_id = row["id"]
    except Exception as exc:
        log.error("resume_uploads insert failed", extra={"user_id": user_id, "err": str(exc)})
        raise HTTPException(status_code=500, detail="Could not record upload.") from exc

    if time.monotonic() - start > PARSE_BUDGET_SECONDS:
        log.warning(
            "resume parse skipped: budget exhausted",
            extra={"user_id": user_id, "resume_id": resume_id},
        )
        return ResumeUploadResponse(
            resume_id=resume_id,
            parse_status="pending",
            original_filename=file.filename or f"resume.{ext}",
            message="Upload received. Parsing queued — poll GET /resume/me.",
        )

    parse_status, parsed_data, parse_error = await _parse_inline(
        file_bytes=file_bytes, mime=mime, resume_id=resume_id, user_id=user_id,
    )

    return ResumeUploadResponse(
        resume_id=resume_id,
        parse_status=parse_status,
        original_filename=file.filename or f"resume.{ext}",
        parsed_data=parsed_data if parse_status == "completed" else None,
        message=parse_error if parse_status == "failed" else None,
    )


async def _parse_inline(
    *,
    file_bytes: bytes,
    mime: str,
    resume_id: str,
    user_id: str,
) -> tuple[str, dict[str, Any] | None, str | None]:
    admin = get_admin_client()

    try:
        admin.table("tir_resume_uploads").update({"parse_status": "processing"}).eq(
            "id", resume_id
        ).execute()
    except Exception as exc:
        log.warning("could not stamp processing", extra={"resume_id": resume_id, "err": str(exc)})

    try:
        text = extract_text(file_bytes, mime)
        log.info("resume.extract_text ok", extra={"resume_id": resume_id, "chars": len(text)})
    except UnsupportedFileType as exc:
        _stamp_failed(resume_id, str(exc))
        return "failed", None, str(exc)
    except ValueError as exc:
        _stamp_failed(resume_id, str(exc))
        return "failed", None, str(exc)

    try:
        parsed = await OpenRouterClient().parse_resume(text, user_id=user_id)
        log.info(
            "resume.llm_parse ok",
            extra={"resume_id": resume_id, "parsed_keys": list(parsed.keys())},
        )
    except LLMParseError as exc:
        _stamp_failed(resume_id, str(exc))
        return "failed", None, str(exc)
    except Exception as exc:
        log.exception("unexpected LLM error", extra={"resume_id": resume_id})
        _stamp_failed(resume_id, f"unexpected: {exc}")
        return "failed", None, f"unexpected: {exc}"

    # parsed_at is set by the database via DEFAULT now() / trigger when we
    # don't pass it; sending the literal string "now()" used to silently
    # 400 from PostgREST and may be the reason this PATCH was hanging in
    # production (no exception surfaced because supabase-py swallowed it).
    try:
        admin.table("tir_resume_uploads").update(
            {"parsed_data": parsed, "parse_status": "completed"}
        ).eq("id", resume_id).execute()
        log.info("resume.stamp_completed ok", extra={"resume_id": resume_id})
    except Exception as exc:
        log.error("could not stamp completed", extra={"resume_id": resume_id, "err": str(exc)})
        return "failed", None, f"post-parse update failed: {exc}"

    return "completed", parsed, None


def _stamp_failed(resume_id: str, error: str) -> None:
    try:
        get_admin_client().table("tir_resume_uploads").update(
            {"parse_status": "failed", "parse_error": error[:1000]}
        ).eq("id", resume_id).execute()
    except Exception as exc:
        log.error("could not stamp failed", extra={"resume_id": resume_id, "err": str(exc)})


@router.get(
    "/me",
    response_model=ResumeRecord,
    dependencies=[Depends(_rl_get_me)],
)
async def get_my_latest_resume(current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    try:
        res = (
            get_admin_client()
            .table("tir_resume_uploads")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        log.error("resume /me query failed", extra={"user_id": user_id, "err": str(exc)})
        raise HTTPException(status_code=500, detail="Query failed.") from exc

    rows = res.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="No resume uploaded yet.")
    return rows[0]


@router.get(
    "/{resume_id}",
    response_model=ResumeRecord,
    dependencies=[Depends(_rl_get_id)],
)
async def get_resume_by_id(
    resume_id: str,
    current_user: dict = Depends(get_current_user),
):
    try:
        res = (
            get_admin_client()
            .table("tir_resume_uploads")
            .select("*")
            .eq("id", resume_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Query failed.") from exc

    rows = res.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Resume not found.")
    row = rows[0]
    if row["user_id"] != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Not your resume.")
    return row


# Mapping of parsed LLM output → typed columns that actually exist in
# migrations/001_initial_schema.sql. Richer structured fields (education,
# work_experience, skills, ventures, summary) stay inside
# resume_uploads.parsed_data until a future migration adds columns.
PROFILE_MAP: list[tuple[str, str]] = [
    ("full_name", "full_name"),
    ("phone", "phone"),
    ("linkedin_url", "linkedin_url"),
    ("location", "location_city"),
]
APPLICATION_MAP: list[tuple[str, str]] = [
    ("full_name", "basic_full_name"),
    ("phone", "basic_phone"),
    ("email", "basic_email"),
]
UNMAPPED_PARSED_KEYS = ("education", "work_experience", "skills", "ventures", "summary")


@router.post(
    "/me/apply-to-application",
    response_model=ApplyToApplicationResult,
    dependencies=[Depends(_rl_apply)],
)
async def apply_parsed_to_application(current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    admin = get_admin_client()

    parsed_res = (
        admin.table("tir_resume_uploads")
        .select("parsed_data, parse_status")
        .eq("user_id", user_id)
        .eq("parse_status", "completed")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = parsed_res.data or []
    if not rows or not rows[0].get("parsed_data"):
        raise HTTPException(
            status_code=404,
            detail="No completed resume parse found. Upload a resume first.",
        )
    parsed: dict[str, Any] = rows[0]["parsed_data"]

    applied: list[str] = []
    skipped: list[str] = []

    # Profile fields always reflect the LATEST CV — every apply-to-application
    # overwrites them. See the matching note in sip_resume.py for why.
    profile_res = admin.table("profiles").select("id").eq("id", user_id).limit(1).execute()
    profile_rows = profile_res.data or []
    if not profile_rows:
        skipped.extend(f"profiles.{col}" for _, col in PROFILE_MAP)
    else:
        profile_patch: dict[str, Any] = {}
        for src, dest in PROFILE_MAP:
            val = parsed.get(src)
            if val:
                profile_patch[dest] = val
                applied.append(f"profiles.{dest}")
            else:
                skipped.append(f"profiles.{dest}")
        if profile_patch:
            admin.table("profiles").update(profile_patch).eq("id", user_id).execute()

    # Multi-app: scope to the OPEN DRAFT specifically. Without the
    # status filter, .limit(1) could pick a submitted row (in which
    # case the status guard below would skip every field — that was
    # the "auto-fill not working after a re-submission" bug). Order
    # by created_at desc so we deterministically pick the newest
    # draft if there's ever more than one in flight.
    app_res = (
        admin.table("tir_applications")
        .select("*")
        .eq("user_id", user_id)
        .eq("status", "draft")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    app_rows = app_res.data or []
    if not app_rows:
        skipped.extend(f"applications.{col}" for _, col in APPLICATION_MAP)
    else:
        app_row = app_rows[0]
        app_patch: dict[str, Any] = {}
        for src, dest in APPLICATION_MAP:
            val = parsed.get(src)
            if val and not app_row.get(dest):
                app_patch[dest] = val
                applied.append(f"applications.{dest}")
            else:
                skipped.append(f"applications.{dest}")
        if app_patch:
            # Update by row id so we can never accidentally mutate a
            # submitted row that shares this user_id.
            admin.table("tir_applications").update(app_patch).eq(
                "id", app_row["id"]
            ).execute()

    for k in UNMAPPED_PARSED_KEYS:
        if parsed.get(k):
            skipped.append(f"parsed_data.{k} (no typed column)")

    try:
        admin.table("audit_logs").insert(
            {
                "user_id": user_id,
                "action": "resume.applied_to_application",
                "metadata": {"applied_fields": applied, "skipped_fields": skipped},
            }
        ).execute()
    except Exception as exc:
        log.warning("audit log insert failed", extra={"user_id": user_id, "err": str(exc)})

    return ApplyToApplicationResult(applied_fields=applied, skipped_fields=skipped)
