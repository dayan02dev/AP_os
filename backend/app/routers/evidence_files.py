"""Evidence-files upload — Section 5 of the wizard.

Mirrors routers/milestone_files.py but writes the user's evidence
attachments (publications, patents, prototype photos) to the private
``evidence-files`` storage bucket and to the ``applications.evidence_files``
JSONB column.

Endpoints
    POST   /applications/me/evidence-files                 multipart upload
    DELETE /applications/me/evidence-files/{file_uuid}     remove

Path inside the bucket: ``<user_id>/evidence/<file_uuid>.<ext>`` so the
RLS policy (which checks the first folder segment) keeps users in their
own folder.

Limits (mirror 006_evidence_files_storage.sql):
  - 10 MiB per file (heavier than milestone docs because papers can run large)
  - max 5 files per application (DB CHECK enforces this too)
  - MIME types: PDF / PNG / JPG / DOC / DOCX

Locked applications (status != 'draft') reject both endpoints with 409.
The bucket object is left as-is on submit — it's the audit artefact.
"""

import contextlib
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, File, Request, UploadFile, status
from fastapi.responses import JSONResponse

from ..deps import get_current_user, require_track
from ..supabase_client import get_admin_client
from ..utils.rate_limit import per_user_rate_limit

log = logging.getLogger(__name__)

router = APIRouter(
    prefix="/applications/me/evidence-files",
    tags=["applications"],
    dependencies=[Depends(require_track("tir"))],
)

_BUCKET = "tir-evidence-files"
_MAX_BYTES = 10 * 1024 * 1024
_MAX_FILES_PER_APP = 5
_ALLOWED_MIME = {
    "application/pdf",
    "image/png",
    "image/jpeg",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
_MIME_TO_EXT = {
    "application/pdf": "pdf",
    "image/png": "png",
    "image/jpeg": "jpg",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
}

_rl_upload = per_user_rate_limit("tir-evidence-files-upload", 60, 3600)
_rl_delete = per_user_rate_limit("tir-evidence-files-delete", 60, 3600)


def _error(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": message}},
    )


def _new_request_id() -> str:
    return uuid.uuid4().hex[:12]


def _fetch_draft_application(user_id: str) -> dict[str, Any] | None:
    res = (
        get_admin_client()
        .table("tir_applications")
        .select("id, status, evidence_files")
        .eq("user_id", user_id)
        .eq("status", "draft")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


@router.post("", status_code=status.HTTP_201_CREATED, dependencies=[Depends(_rl_upload)])
async def upload_evidence_file(
    request: Request,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["user_id"]
    req_id = _new_request_id()

    mime = (file.content_type or "").lower()
    if mime not in _ALLOWED_MIME:
        return _error(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            "unsupported_media",
            f"Unsupported file type: {mime!r}. Accepted: PDF, PNG, JPG, DOC, DOCX.",
        )

    file_bytes = await file.read()
    if not file_bytes:
        return _error(status.HTTP_400_BAD_REQUEST, "empty_file", "Empty file.")
    if len(file_bytes) > _MAX_BYTES:
        return _error(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            "too_large",
            f"File exceeds {_MAX_BYTES // (1024 * 1024)} MiB.",
        )

    app_row = _fetch_draft_application(user_id)
    if not app_row:
        return _error(
            status.HTTP_404_NOT_FOUND,
            "application_missing",
            "No application found. Start the wizard first.",
        )
    if app_row["status"] != "draft":
        return _error(
            status.HTTP_409_CONFLICT,
            "application_locked",
            "Application is already submitted; attachments can't be changed.",
        )

    existing = list(app_row.get("evidence_files") or [])
    # Old submissions stored bare {name, size, type} dicts here. Treat
    # those as opaque legacy entries for length-counting purposes; the new
    # endpoint only ever appends entries with file_uuid + path.
    if len(existing) >= _MAX_FILES_PER_APP:
        return _error(
            status.HTTP_409_CONFLICT,
            "file_cap_reached",
            f"You can attach at most {_MAX_FILES_PER_APP} files. Remove one to add another.",
        )

    file_uuid = str(uuid.uuid4())
    ext = _MIME_TO_EXT[mime]
    storage_path = f"{user_id}/evidence/{file_uuid}.{ext}"

    admin = get_admin_client()
    try:
        admin.storage.from_(_BUCKET).upload(
            path=storage_path,
            file=file_bytes,
            file_options={"content-type": mime},
        )
    except Exception as exc:
        log.error(
            "evidence-files storage upload failed",
            extra={"user_id": user_id, "ref": req_id, "err": str(exc)},
        )
        return _error(
            status.HTTP_502_BAD_GATEWAY,
            "storage_upload_failed",
            "Storage upload failed. Try again.",
        )

    entry = {
        "file_uuid": file_uuid,
        "path": storage_path,
        "name": file.filename or f"evidence-{file_uuid[:8]}.{ext}",
        "size": len(file_bytes),
        "mime": mime,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }
    new_list = [*existing, entry]

    try:
        (
            admin.table("tir_applications")
            .update({"evidence_files": new_list})
            .eq("id", app_row["id"])
            .eq("status", "draft")
            .execute()
        )
    except Exception as exc:
        log.error(
            "evidence-files JSONB update failed; rolling back storage object",
            extra={"user_id": user_id, "ref": req_id, "err": str(exc)},
        )
        with contextlib.suppress(Exception):
            admin.storage.from_(_BUCKET).remove([storage_path])
        return _error(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "metadata_write_failed",
            f"Could not record attachment (ref {req_id}). Try again.",
        )

    log.info(
        "evidence-files upload ok",
        extra={"user_id": user_id, "ref": req_id, "file_uuid": file_uuid,
               "size": len(file_bytes), "mime": mime},
    )
    return {"ok": True, "file": entry, "files": new_list}


@router.delete("/{file_uuid}", dependencies=[Depends(_rl_delete)])
async def delete_evidence_file(
    file_uuid: str,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["user_id"]
    req_id = _new_request_id()

    try:
        uuid.UUID(file_uuid)
    except ValueError:
        return _error(status.HTTP_400_BAD_REQUEST, "bad_file_uuid",
                      "file_uuid must be a UUID.")

    app_row = _fetch_draft_application(user_id)
    if not app_row:
        return _error(status.HTTP_404_NOT_FOUND, "application_missing",
                      "No application found.")
    if app_row["status"] != "draft":
        return _error(status.HTTP_409_CONFLICT, "application_locked",
                      "Application is submitted; attachments are frozen.")

    existing = list(app_row.get("evidence_files") or [])
    target = next(
        (e for e in existing if isinstance(e, dict) and e.get("file_uuid") == file_uuid),
        None,
    )
    if not target:
        return _error(status.HTTP_404_NOT_FOUND, "file_not_found",
                      "Attachment not found.")

    new_list = [
        e for e in existing
        if not (isinstance(e, dict) and e.get("file_uuid") == file_uuid)
    ]
    admin = get_admin_client()

    try:
        (
            admin.table("tir_applications")
            .update({"evidence_files": new_list})
            .eq("id", app_row["id"])
            .eq("status", "draft")
            .execute()
        )
    except Exception as exc:
        log.error(
            "evidence-files JSONB delete failed",
            extra={"user_id": user_id, "ref": req_id, "err": str(exc)},
        )
        return _error(status.HTTP_500_INTERNAL_SERVER_ERROR,
                      "metadata_delete_failed",
                      f"Could not remove attachment (ref {req_id}).")

    with contextlib.suppress(Exception):
        admin.storage.from_(_BUCKET).remove([target["path"]])

    log.info(
        "evidence-files delete ok",
        extra={"user_id": user_id, "ref": req_id, "file_uuid": file_uuid},
    )
    return {"ok": True, "files": new_list}


_ = Request
