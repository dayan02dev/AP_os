"""SIP Resume upload + parse pipeline.

Mirror of routers/resume.py for the SIP track. Uploads to the
'sip-resumes' bucket and writes parse results to sip_resume_uploads.
Apply-to-application targets sip_applications.

Endpoints:
  POST /sip-resume/upload
  GET  /sip-resume/me
  GET  /sip-resume/{resume_id}
  POST /sip-resume/me/apply-to-application
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

_rl_upload = per_user_rate_limit("sip-resume-upload", 5, 3600)
_rl_get_me = per_user_rate_limit("sip-resume-get-me", 30, 60)
_rl_get_id = per_user_rate_limit("sip-resume-get-id", 30, 60)
_rl_apply = per_user_rate_limit("sip-resume-apply", 10, 3600)

log = logging.getLogger(__name__)

router = APIRouter(
    prefix="/sip-resume",
    tags=["sip-resume"],
    dependencies=[Depends(require_track("sip"))],
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

PARSE_BUDGET_SECONDS = 22.0
_BUCKET = "sip-resumes"


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
        admin.storage.from_(_BUCKET).upload(
            path=storage_path,
            file=file_bytes,
            file_options={"content-type": mime},
        )
    except Exception as exc:
        log.error("sip storage upload failed",
                  extra={"user_id": user_id, "err": str(exc)})
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Storage upload failed.",
        ) from exc

    try:
        insert = (
            admin.table("sip_resume_uploads")
            .insert({
                "user_id": user_id,
                "storage_path": storage_path,
                "original_filename": file.filename or f"resume.{ext}",
                "file_size_bytes": len(file_bytes),
                "mime_type": mime,
                "parse_status": "pending",
            })
            .execute()
        )
        row = (insert.data or [None])[0]
        if not row:
            raise RuntimeError("insert returned no rows")
        resume_id = row["id"]
    except Exception as exc:
        log.error("sip_resume_uploads insert failed",
                  extra={"user_id": user_id, "err": str(exc)})
        raise HTTPException(status_code=500, detail="Could not record upload.") from exc

    if time.monotonic() - start > PARSE_BUDGET_SECONDS:
        return ResumeUploadResponse(
            resume_id=resume_id,
            parse_status="pending",
            original_filename=file.filename or f"resume.{ext}",
            message="Upload received. Parsing queued — poll GET /sip-resume/me.",
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


async def _parse_inline(*, file_bytes: bytes, mime: str, resume_id: str,
                        user_id: str) -> tuple[str, dict[str, Any] | None, str | None]:
    admin = get_admin_client()

    try:
        admin.table("sip_resume_uploads").update(
            {"parse_status": "processing"}
        ).eq("id", resume_id).execute()
    except Exception as exc:
        log.warning("could not stamp processing",
                    extra={"resume_id": resume_id, "err": str(exc)})

    try:
        text = extract_text(file_bytes, mime)
    except (UnsupportedFileType, ValueError) as exc:
        _stamp_failed(resume_id, str(exc))
        return "failed", None, str(exc)

    try:
        parsed = await OpenRouterClient().parse_resume(text, user_id=user_id)
    except LLMParseError as exc:
        _stamp_failed(resume_id, str(exc))
        return "failed", None, str(exc)
    except Exception as exc:
        log.exception("unexpected LLM error", extra={"resume_id": resume_id})
        _stamp_failed(resume_id, f"unexpected: {exc}")
        return "failed", None, f"unexpected: {exc}"

    try:
        admin.table("sip_resume_uploads").update(
            {"parsed_data": parsed, "parse_status": "completed"}
        ).eq("id", resume_id).execute()
    except Exception as exc:
        log.error("could not stamp completed",
                  extra={"resume_id": resume_id, "err": str(exc)})
        return "failed", None, f"post-parse update failed: {exc}"

    return "completed", parsed, None


def _stamp_failed(resume_id: str, error: str) -> None:
    try:
        get_admin_client().table("sip_resume_uploads").update(
            {"parse_status": "failed", "parse_error": error[:1000]}
        ).eq("id", resume_id).execute()
    except Exception as exc:
        log.error("could not stamp failed",
                  extra={"resume_id": resume_id, "err": str(exc)})


@router.get("/me", response_model=ResumeRecord, dependencies=[Depends(_rl_get_me)])
async def get_my_latest_resume(current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    try:
        res = (
            get_admin_client()
            .table("sip_resume_uploads")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Query failed.") from exc

    rows = res.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="No resume uploaded yet.")
    return rows[0]


@router.get("/{resume_id}", response_model=ResumeRecord,
            dependencies=[Depends(_rl_get_id)])
async def get_resume_by_id(
    resume_id: str,
    current_user: dict = Depends(get_current_user),
):
    try:
        res = (
            get_admin_client()
            .table("sip_resume_uploads")
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


# Same parsed-key → SIP application column mapping as TIR. SIP shares the
# basic_full_name / basic_phone / basic_email columns.
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


@router.post("/me/apply-to-application", response_model=ApplyToApplicationResult,
             dependencies=[Depends(_rl_apply)])
async def apply_parsed_to_application(current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    admin = get_admin_client()

    parsed_res = (
        admin.table("sip_resume_uploads")
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
    # overwrites them. Previously we used a "fill only if empty" guard, which
    # cached the first CV's name forever and caused stale greetings when the
    # same test account was reused with a different CV. The wizard's
    # basic_full_name (per-draft) still stays editable by the user; this
    # profile-level field is intended to mirror the latest parsed source.
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

    app_res = (
        admin.table("sip_applications")
        .select("*")
        .eq("user_id", user_id)
        .eq("status", "draft")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    app_rows = app_res.data or []
    if not app_rows:
        skipped.extend(f"sip_applications.{col}" for _, col in APPLICATION_MAP)
    else:
        app_row = app_rows[0]
        app_patch: dict[str, Any] = {}
        for src, dest in APPLICATION_MAP:
            val = parsed.get(src)
            if val and not app_row.get(dest):
                app_patch[dest] = val
                applied.append(f"sip_applications.{dest}")
            else:
                skipped.append(f"sip_applications.{dest}")
        if app_patch:
            admin.table("sip_applications").update(app_patch).eq(
                "id", app_row["id"]
            ).execute()

    try:
        admin.table("audit_logs").insert({
            "user_id": user_id,
            "action": "sip_resume.applied_to_application",
            "metadata": {"applied_fields": applied, "skipped_fields": skipped},
        }).execute()
    except Exception as exc:
        log.warning("audit log insert failed",
                    extra={"user_id": user_id, "err": str(exc)})

    return ApplyToApplicationResult(applied_fields=applied, skipped_fields=skipped)
