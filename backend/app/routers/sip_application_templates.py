"""SIP offline application-template upload + parse pipeline.

SIP equivalent of routers/application_templates.py. Applicants
download `/templates/ARTPARK_SIP_Application_Template.docx`, fill it
offline, then upload the filled document here. Each answer between
the literal anchor markers ends up in the matching `sip_applications`
column on the user's open draft — NULL-only writes (deliberate
divergence from TIR's overwrite-on-apply; see spec D6).

Endpoints (all require auth via get_current_user + sip track):

    POST /sip-application-templates/upload                       inline parse
    GET  /sip-application-templates/me                           latest row
    POST /sip-application-templates/me/apply-to-application      copy into draft

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

from ..deps import get_current_user, require_track
from ..models.sip_application_template import (
    SipApplicationTemplateRecord,
    SipApplicationTemplateUploadResponse,
    SipApplyTemplateResult,
)
from ..services.sip_template_parser import (
    QUESTION_TO_SIP_COLUMN,
    SIP_QUESTION_IDS,
    parse_sip_template,
)
from ..services.template_parser import (
    DOCX_MIME,
    PDF_MIME,
    TemplateParseError,
)
from ..supabase_client import get_admin_client
from ..utils.rate_limit import per_user_rate_limit

log = logging.getLogger(__name__)

router = APIRouter(
    prefix="/sip-application-templates",
    tags=["sip-application-templates"],
    dependencies=[Depends(require_track("sip"))],
)

_BUCKET = "sip-application-templates"
_TABLE = "sip_application_templates"
_DRAFT_TABLE = "sip_applications"
_MAX_BYTES = 10 * 1024 * 1024
_ALLOWED_MIME = {DOCX_MIME, PDF_MIME}
_MIME_TO_EXT = {DOCX_MIME: "docx", PDF_MIME: "pdf"}

PARSE_BUDGET_SECONDS = 22.0

_rl_upload = per_user_rate_limit("sip-template-upload", 5, 3600)
_rl_get_me = per_user_rate_limit("sip-template-get-me", 30, 60)
_rl_apply = per_user_rate_limit("sip-template-apply", 10, 3600)


# ── Helpers ───────────────────────────────────────────────────────────────

def _stamp_failed(template_id: str, code: str, detail: str | None = None) -> None:
    error = code if not detail else f"{code}: {detail}"
    try:
        get_admin_client().table(_TABLE).update(
            {"parse_status": "failed", "parse_error": error[:1000]}
        ).eq("id", template_id).execute()
    except Exception as exc:
        log.error("could not stamp sip template failed",
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
        .table(_DRAFT_TABLE)
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
    response_model=SipApplicationTemplateUploadResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(_rl_upload)],
)
async def upload_sip_template(
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
            detail="Please upload the filled SIP template as .docx (preferred) or .pdf.",
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
        log.error("sip template storage upload failed",
                  extra={"user_id": user_id, "err": str(exc)})
        raise HTTPException(status_code=502, detail="Storage upload failed.") from exc

    application_id = _fetch_draft_application_id(user_id)

    try:
        insert = (
            admin.table(_TABLE)
            .insert({
                "user_id": user_id,
                "application_id": application_id,
                "storage_path": storage_path,
                "original_filename": file.filename or f"sip-template.{ext}",
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
        log.error("sip_application_templates insert failed",
                  extra={"user_id": user_id, "err": str(exc)})
        raise HTTPException(status_code=500, detail="Could not record upload.") from exc

    _audit(user_id, "sip_template.uploaded",
           {"template_id": str(template_id), "application_id": application_id,
            "mime": mime, "size_bytes": len(file_bytes)})

    if time.monotonic() - start > PARSE_BUDGET_SECONDS:
        return SipApplicationTemplateUploadResponse(
            template_id=template_id,
            parse_status="pending",
            original_filename=file.filename or f"sip-template.{ext}",
            message="Upload received. Parsing queued — poll GET /sip-application-templates/me.",
        )

    parse_status, parsed_data, parse_error = await _parse_inline(
        file_bytes=file_bytes, mime=mime, template_id=template_id, user_id=user_id,
    )

    return SipApplicationTemplateUploadResponse(
        template_id=template_id,
        parse_status=parse_status,
        original_filename=file.filename or f"sip-template.{ext}",
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
        admin.table(_TABLE).update(
            {"parse_status": "processing"}
        ).eq("id", template_id).execute()
    except Exception as exc:
        log.warning("could not stamp sip template processing",
                    extra={"template_id": template_id, "err": str(exc)})

    try:
        parsed = await parse_sip_template(file_bytes=file_bytes, mime=mime, user_id=user_id)
    except TemplateParseError as exc:
        _stamp_failed(template_id, exc.code, exc.detail)
        _audit(user_id, "sip_template.parsed",
               {"template_id": str(template_id), "parse_status": "failed",
                "parse_error": exc.code})
        return "failed", None, exc.code
    except Exception as exc:
        log.exception("unexpected sip template parse error",
                      extra={"template_id": template_id})
        _stamp_failed(template_id, "unexpected", str(exc))
        _audit(user_id, "sip_template.parsed",
               {"template_id": str(template_id), "parse_status": "failed",
                "parse_error": "unexpected"})
        return "failed", None, f"unexpected: {exc}"

    filled_count = sum(1 for v in parsed.values() if v)
    if filled_count < 3 and any(parsed.values()):
        log.info("sip template parse suspiciously sparse",
                 extra={"template_id": template_id, "filled_count": filled_count})

    try:
        admin.table(_TABLE).update({
            "parsed_data": parsed,
            "parse_status": "completed",
            "parsed_at": "now()",
        }).eq("id", template_id).execute()
    except Exception as exc:
        log.error("could not stamp sip template completed",
                  extra={"template_id": template_id, "err": str(exc)})
        return "failed", None, f"post-parse update failed: {exc}"

    _audit(user_id, "sip_template.parsed",
           {"template_id": str(template_id), "parse_status": "completed",
            "filled_keys": sorted(k for k, v in parsed.items() if v)})
    return "completed", parsed, None


# ── GET /me ───────────────────────────────────────────────────────────────

@router.get(
    "/me",
    response_model=SipApplicationTemplateRecord,
    dependencies=[Depends(_rl_get_me)],
)
async def get_my_latest_sip_template(current_user: dict = Depends(get_current_user)):
    """Latest SIP template scoped to the current open draft."""
    user_id = current_user["user_id"]
    draft_id = _fetch_draft_application_id(user_id)
    if not draft_id:
        raise HTTPException(status_code=404, detail="No draft SIP application.")
    res = (
        get_admin_client()
        .table(_TABLE)
        .select("*")
        .eq("user_id", user_id)
        .eq("application_id", draft_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="No SIP template uploaded yet.")
    return rows[0]


# ── POST /me/apply-to-application ─────────────────────────────────────────

@router.post(
    "/me/apply-to-application",
    response_model=SipApplyTemplateResult,
    dependencies=[Depends(_rl_apply)],
)
async def apply_sip_template_to_application(current_user: dict = Depends(get_current_user)):
    """Copy parsed SIP template answers into the user's open draft (NULL-only writes)."""
    user_id = current_user["user_id"]
    admin = get_admin_client()

    app_res = (
        admin.table(_DRAFT_TABLE)
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
            detail="No draft SIP application found. Begin an application first.",
        )
    app_row = app_rows[0]
    app_id = app_row["id"]

    parsed_res = (
        admin.table(_TABLE)
        .select("id, parsed_data, parse_status")
        .eq("user_id", user_id)
        .eq("application_id", app_id)
        .eq("parse_status", "completed")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = parsed_res.data or []
    if not rows or not rows[0].get("parsed_data"):
        raise HTTPException(
            status_code=404,
            detail="No completed SIP template parse found. Upload a filled template first.",
        )
    template_id = rows[0]["id"]
    parsed: dict[str, Any] = rows[0]["parsed_data"]

    applied: list[str] = []
    skipped: list[str] = []
    missing: list[str] = []
    patch: dict[str, Any] = {}

    # NULL-only writes — skip if target column already has a value.
    for qid, dest_col in QUESTION_TO_SIP_COLUMN.items():
        val = parsed.get(qid)
        if not val:
            missing.append(qid)
            continue
        existing = app_row.get(dest_col)
        if existing:
            skipped.append(dest_col)
            continue
        patch[dest_col] = val
        applied.append(dest_col)

    if patch:
        try:
            admin.table(_DRAFT_TABLE).update(patch).eq("id", app_id).eq(
                "status", "draft"
            ).execute()
        except Exception as exc:
            log.warning(
                "sip template bulk apply rejected, retrying per-field",
                extra={"user_id": user_id, "app_id": app_id, "err": str(exc)},
            )
            applied.clear()
            new_missing: list[str] = list(missing)
            for col, val in patch.items():
                try:
                    admin.table(_DRAFT_TABLE).update({col: val}).eq(
                        "id", app_id
                    ).eq("status", "draft").execute()
                    applied.append(col)
                except Exception as col_exc:
                    log.warning(
                        "sip template per-field apply rejected",
                        extra={"user_id": user_id, "app_id": app_id,
                               "column": col, "err": str(col_exc)},
                    )
                    qid = next(
                        (q for q, c in QUESTION_TO_SIP_COLUMN.items() if c == col),
                        col,
                    )
                    if qid not in new_missing:
                        new_missing.append(qid)
            missing = new_missing

    try:
        admin.table(_TABLE).update(
            {"applied_to_application_at": "now()"}
        ).eq("id", template_id).execute()
    except Exception as exc:
        log.warning("could not stamp applied_to_application_at",
                    extra={"template_id": str(template_id), "err": str(exc)})

    _audit(user_id, "sip_template.applied_to_application", {
        "template_id": str(template_id),
        "application_id": app_id,
        "applied_fields": applied,
        "skipped_fields": skipped,
        "missing_answers": missing,
    })

    return SipApplyTemplateResult(
        applied_fields=applied,
        skipped_fields=skipped,
        missing_answers=missing,
    )
