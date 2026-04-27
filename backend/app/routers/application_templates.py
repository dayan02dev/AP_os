"""Offline application-template upload + parse pipeline.

Mirrors routers/resume.py — the second auto-fill mechanism. Applicants
download `/templates/ARTPARK_TIR_Application_Template.docx`, fill it
offline, then upload the filled document here. Each answer between the
literal anchor markers ends up in the matching `applications` column on
the user's open draft (NULL-only — never overwrites a typed answer).

Endpoints (all require auth via get_current_user):

    POST /application-templates/upload                       inline parse
    GET  /application-templates/me                           latest row
    POST /application-templates/me/apply-to-application      copy into draft

Rate limits (per-user):
    POST /upload                       5/hour/user
    GET  /me                           30/min/user
    POST /me/apply-to-application      10/hour/user
"""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, status

from ..deps import get_current_user
from ..models.application_template import (
    ApplicationTemplateRecord,
    ApplicationTemplateUploadResponse,
    ApplyTemplateResult,
)
from ..services.template_parser import (
    DOCX_MIME,
    PDF_MIME,
    QUESTION_TO_APPLICATION_COLUMN,
    TemplateParseError,
    parse_template,
)
from ..supabase_client import get_admin_client
from ..utils.rate_limit import per_user_rate_limit

log = logging.getLogger(__name__)

router = APIRouter(prefix="/application-templates", tags=["application-templates"])

_BUCKET = "application-templates"
_MAX_BYTES = 10 * 1024 * 1024
_ALLOWED_MIME = {DOCX_MIME, PDF_MIME}
_MIME_TO_EXT = {DOCX_MIME: "docx", PDF_MIME: "pdf"}

# Same Lambda budget logic as resume upload — at ~22s elapsed we bail on
# inline parse and leave the row pending so a reupload can finish it.
PARSE_BUDGET_SECONDS = 22.0

_rl_upload = per_user_rate_limit("template-upload", 5, 3600)
_rl_get_me = per_user_rate_limit("template-get-me", 30, 60)
_rl_apply = per_user_rate_limit("template-apply", 10, 3600)


# ── Helpers ───────────────────────────────────────────────────────────────

def _stamp_failed(template_id: str, code: str, detail: str | None = None) -> None:
    error = code if not detail else f"{code}: {detail}"
    try:
        get_admin_client().table("application_templates").update(
            {"parse_status": "failed", "parse_error": error[:1000]}
        ).eq("id", template_id).execute()
    except Exception as exc:
        log.error("could not stamp template failed",
                  extra={"template_id": template_id, "err": str(exc)})


def _audit(user_id: str, action: str, metadata: dict[str, Any]) -> None:
    try:
        get_admin_client().table("audit_logs").insert(
            {"user_id": user_id, "action": action, "metadata": metadata}
        ).execute()
    except Exception as exc:
        log.warning("audit insert failed",
                    extra={"user_id": user_id, "action": action, "err": str(exc)})


def _fetch_draft_application_id(user_id: str) -> str | None:
    res = (
        get_admin_client()
        .table("applications")
        .select("id")
        .eq("user_id", user_id)
        .eq("status", "draft")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0]["id"] if rows else None


# ── POST /upload ──────────────────────────────────────────────────────────

@router.post(
    "/upload",
    response_model=ApplicationTemplateUploadResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_rl_upload)],
)
async def upload_template(
    request: Request,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    start = time.monotonic()
    user_id = current_user["user_id"]

    mime = (file.content_type or "").lower()
    if mime not in _ALLOWED_MIME:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="Please upload the filled template as .docx (preferred) or .pdf.",
        )

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Empty file.")
    if len(file_bytes) > _MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File exceeds {_MAX_BYTES // (1024 * 1024)} MiB.",
        )

    ext = _MIME_TO_EXT[mime]
    storage_path = f"{user_id}/{uuid.uuid4()}.{ext}"
    admin = get_admin_client()

    try:
        admin.storage.from_(_BUCKET).upload(
            path=storage_path,
            file=file_bytes,
            file_options={"content-type": mime},
        )
    except Exception as exc:
        log.error("template storage upload failed",
                  extra={"user_id": user_id, "err": str(exc)})
        raise HTTPException(status_code=502, detail="Storage upload failed.") from exc

    application_id = _fetch_draft_application_id(user_id)

    try:
        insert = (
            admin.table("application_templates")
            .insert({
                "user_id": user_id,
                "application_id": application_id,
                "storage_path": storage_path,
                "original_filename": file.filename or f"template.{ext}",
                "file_size_bytes": len(file_bytes),
                "mime_type": mime,
                "parse_status": "pending",
            })
            .execute()
        )
        row = (insert.data or [None])[0]
        if not row:
            raise RuntimeError("insert returned no rows")
        template_id = row["id"]
    except Exception as exc:
        log.error("application_templates insert failed",
                  extra={"user_id": user_id, "err": str(exc)})
        raise HTTPException(status_code=500, detail="Could not record upload.") from exc

    _audit(user_id, "template.uploaded",
           {"template_id": str(template_id), "application_id": application_id, "mime": mime,
            "size_bytes": len(file_bytes)})

    if time.monotonic() - start > PARSE_BUDGET_SECONDS:
        return ApplicationTemplateUploadResponse(
            template_id=template_id,
            parse_status="pending",
            original_filename=file.filename or f"template.{ext}",
            message="Upload received. Parsing queued — poll GET /application-templates/me.",
        )

    parse_status, parsed_data, parse_error = await _parse_inline(
        file_bytes=file_bytes, mime=mime, template_id=template_id, user_id=user_id,
    )

    return ApplicationTemplateUploadResponse(
        template_id=template_id,
        parse_status=parse_status,
        original_filename=file.filename or f"template.{ext}",
        parsed_data=parsed_data if parse_status == "completed" else None,
        message=parse_error if parse_status == "failed" else None,
    )


async def _parse_inline(
    *,
    file_bytes: bytes,
    mime: str,
    template_id: str,
    user_id: str,
) -> tuple[str, dict[str, Any] | None, str | None]:
    admin = get_admin_client()

    try:
        admin.table("application_templates").update(
            {"parse_status": "processing"}
        ).eq("id", template_id).execute()
    except Exception as exc:
        log.warning("could not stamp template processing",
                    extra={"template_id": template_id, "err": str(exc)})

    try:
        parsed = await parse_template(file_bytes=file_bytes, mime=mime, user_id=user_id)
    except TemplateParseError as exc:
        _stamp_failed(template_id, exc.code, exc.detail)
        _audit(user_id, "template.parsed",
               {"template_id": str(template_id), "parse_status": "failed",
                "parse_error": exc.code})
        return "failed", None, exc.code
    except Exception as exc:
        log.exception("unexpected template parse error",
                      extra={"template_id": template_id})
        _stamp_failed(template_id, "unexpected", str(exc))
        _audit(user_id, "template.parsed",
               {"template_id": str(template_id), "parse_status": "failed",
                "parse_error": "unexpected"})
        return "failed", None, f"unexpected: {exc}"

    try:
        admin.table("application_templates").update({
            "parsed_data": parsed,
            "parse_status": "completed",
            "parsed_at": "now()",
        }).eq("id", template_id).execute()
    except Exception as exc:
        log.error("could not stamp template completed",
                  extra={"template_id": template_id, "err": str(exc)})
        return "failed", None, f"post-parse update failed: {exc}"

    _audit(user_id, "template.parsed",
           {"template_id": str(template_id), "parse_status": "completed",
            "filled_keys": sorted(k for k, v in parsed.items() if v)})
    return "completed", parsed, None


# ── GET /me ───────────────────────────────────────────────────────────────

@router.get(
    "/me",
    response_model=ApplicationTemplateRecord,
    dependencies=[Depends(_rl_get_me)],
)
async def get_my_latest_template(current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    res = (
        get_admin_client()
        .table("application_templates")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="No template uploaded yet.")
    return rows[0]


# ── POST /me/apply-to-application ─────────────────────────────────────────

@router.post(
    "/me/apply-to-application",
    response_model=ApplyTemplateResult,
    dependencies=[Depends(_rl_apply)],
)
async def apply_template_to_application(current_user: dict = Depends(get_current_user)):
    user_id = current_user["user_id"]
    admin = get_admin_client()

    parsed_res = (
        admin.table("application_templates")
        .select("id, parsed_data, parse_status")
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
            detail="No completed template parse found. Upload a filled template first.",
        )
    template_id = rows[0]["id"]
    parsed: dict[str, Any] = rows[0]["parsed_data"]

    # Multi-app: scope to the OPEN draft so we never write into a
    # previously-submitted (immutable) application.
    app_res = (
        admin.table("applications")
        .select("*")
        .eq("user_id", user_id)
        .eq("status", "draft")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    app_rows = app_res.data or []
    if not app_rows:
        raise HTTPException(
            status_code=404,
            detail="No draft application found. Begin an application first.",
        )
    app_row = app_rows[0]
    app_id = app_row["id"]

    applied: list[str] = []
    skipped: list[str] = []
    missing: list[str] = []
    patch: dict[str, Any] = {}

    for qid, dest_col in QUESTION_TO_APPLICATION_COLUMN.items():
        val = parsed.get(qid)
        if not val:
            missing.append(qid)
            continue
        existing = app_row.get(dest_col)
        if existing not in (None, ""):
            skipped.append(dest_col)
            continue
        # Last-line guards: enum-shaped columns get the same allowed-value
        # checks the wizard imposes. If the LLM returned a stage that
        # doesn't match the canonical list we drop it as missing rather
        # than poisoning the column.
        if dest_col == "solution_stage":
            from ..services.llm_service import TEMPLATE_Q14_STAGE_OPTIONS
            if val not in TEMPLATE_Q14_STAGE_OPTIONS:
                missing.append(qid)
                continue
        elif dest_col == "problem_defined":
            from ..services.llm_service import TEMPLATE_Q10_OPTIONS
            if val not in TEMPLATE_Q10_OPTIONS:
                missing.append(qid)
                continue

        patch[dest_col] = val
        applied.append(dest_col)

    if patch:
        try:
            admin.table("applications").update(patch).eq("id", app_id).eq(
                "status", "draft"
            ).execute()
        except Exception as exc:
            # CHECK constraints on legacy columns occasionally drift from
            # the wizard copy (e.g. problem_defined accepted 'Yes, clearly
            # defined' historically; the wizard now writes 'Yes'). Rather
            # than fail the whole apply on the first 23514, retry one
            # field at a time and demote violators to missing_answers so
            # the applicant can fill them manually in the wizard.
            err_str = str(exc)
            log.warning(
                "template bulk apply rejected, retrying per-field",
                extra={"user_id": user_id, "app_id": app_id, "err": err_str},
            )
            applied.clear()
            new_skipped: list[str] = []
            new_missing: list[str] = list(missing)
            for col, val in patch.items():
                try:
                    admin.table("applications").update({col: val}).eq(
                        "id", app_id
                    ).eq("status", "draft").execute()
                    applied.append(col)
                except Exception as col_exc:
                    log.warning(
                        "template per-field apply rejected",
                        extra={"user_id": user_id, "app_id": app_id,
                               "column": col, "err": str(col_exc)},
                    )
                    # Column-level failure → surface as missing so the
                    # wizard prompts the applicant for it normally.
                    qid = next(
                        (q for q, c in QUESTION_TO_APPLICATION_COLUMN.items() if c == col),
                        col,
                    )
                    if qid not in new_missing:
                        new_missing.append(qid)
            skipped = list(skipped) + new_skipped
            missing = new_missing

    try:
        admin.table("application_templates").update(
            {"applied_to_application_at": "now()"}
        ).eq("id", template_id).execute()
    except Exception as exc:
        log.warning("could not stamp applied_to_application_at",
                    extra={"template_id": str(template_id), "err": str(exc)})

    _audit(user_id, "template.applied_to_application", {
        "template_id": str(template_id),
        "application_id": app_id,
        "applied_fields": applied,
        "skipped_fields": skipped,
        "missing_answers": missing,
    })

    return ApplyTemplateResult(
        applied_fields=applied,
        skipped_fields=skipped,
        missing_answers=missing,
    )
