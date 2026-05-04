"""SIP evidence-files upload — handles 4 different kinds in one router.

SIP Section 6 has multiple distinct file slots, each backed by its own
JSONB column on sip_applications:

    kind          column                  shape   max files  storage subfolder
    pitch-deck    sip_pitch_deck          single  1 (replace) <uid>/pitch-deck/<uuid>.pdf
    cap-table     sip_cap_table_file      single  1 (replace) <uid>/cap-table/<uuid>.<ext>
    traction      sip_traction_files      list    5           <uid>/traction/<uuid>.<ext>
    patents       sip_patents_files       list    5           <uid>/patents/<uuid>.<ext>

All files live in the 'sip-evidence-files' bucket.

Endpoints:
    POST   /sip-applications/me/evidence-files?kind=<kind>            multipart upload
    DELETE /sip-applications/me/evidence-files/{file_uuid}?kind=<kind>   remove
"""

import contextlib
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile, status
from fastapi.responses import JSONResponse

from ..deps import get_current_user, require_track
from ..supabase_client import get_admin_client
from ..utils.rate_limit import per_user_rate_limit

log = logging.getLogger(__name__)

router = APIRouter(
    prefix="/sip-applications/me/evidence-files",
    tags=["sip-applications"],
    dependencies=[Depends(require_track("sip"))],
)

_BUCKET = "sip-evidence-files"

# Per-kind config: {column, is_list, max_files, max_bytes, allowed_mime, subfolder}
_KIND_CONFIG: dict[str, dict[str, Any]] = {
    "pitch-deck": {
        "column": "sip_pitch_deck",
        "is_list": False,
        "max_bytes": 26214400,  # 25 MiB
        "allowed_mime": {"application/pdf"},
        "subfolder": "pitch-deck",
    },
    "cap-table": {
        "column": "sip_cap_table_file",
        "is_list": False,
        "max_bytes": 5242880,  # 5 MiB
        "allowed_mime": {
            "application/pdf",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "text/csv",
        },
        "subfolder": "cap-table",
    },
    "traction": {
        "column": "sip_traction_files",
        "is_list": True,
        "max_files": 5,
        "max_bytes": 5242880,
        "allowed_mime": {
            "application/pdf",
            "image/png",
            "image/jpeg",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
        "subfolder": "traction",
    },
    "patents": {
        "column": "sip_patents_files",
        "is_list": True,
        "max_files": 5,
        "max_bytes": 5242880,
        "allowed_mime": {
            "application/pdf",
            "image/png",
            "image/jpeg",
        },
        "subfolder": "patents",
    },
}

_MIME_TO_EXT = {
    "application/pdf": "pdf",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "text/csv": "csv",
    "image/png": "png",
    "image/jpeg": "jpg",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
}

_KindLiteral = Literal["pitch-deck", "cap-table", "traction", "patents"]

_rl_upload = per_user_rate_limit("sip-evidence-files-upload", 60, 3600)
_rl_delete = per_user_rate_limit("sip-evidence-files-delete", 60, 3600)


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
        .table("sip_applications")
        .select(
            "id, status, sip_pitch_deck, sip_cap_table_file, "
            "sip_traction_files, sip_patents_files"
        )
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
    kind: _KindLiteral = Query(..., description="One of: pitch-deck, cap-table, traction, patents"),
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["user_id"]
    req_id = _new_request_id()
    cfg = _KIND_CONFIG[kind]

    mime = (file.content_type or "").lower()
    if mime not in cfg["allowed_mime"]:
        return _error(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "unsupported_media",
                      f"Unsupported file type for {kind!r}: {mime!r}")

    file_bytes = await file.read()
    if not file_bytes:
        return _error(status.HTTP_400_BAD_REQUEST, "empty_file", "Empty file.")
    if len(file_bytes) > cfg["max_bytes"]:
        mb = cfg["max_bytes"] // (1024 * 1024)
        return _error(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "too_large",
                      f"File exceeds {mb} MiB for {kind!r}.")

    app_row = _fetch_draft_application(user_id)
    if not app_row:
        return _error(status.HTTP_404_NOT_FOUND, "application_missing",
                      "No SIP application found. Start the wizard first.")
    if app_row["status"] != "draft":
        return _error(status.HTTP_409_CONFLICT, "application_locked",
                      "Application is already submitted.")

    column = cfg["column"]

    if cfg["is_list"]:
        existing = list(app_row.get(column) or [])
        if len(existing) >= cfg["max_files"]:
            return _error(status.HTTP_409_CONFLICT, "file_cap_reached",
                          f"You can attach at most {cfg['max_files']} {kind} files.")

    file_uuid = str(uuid.uuid4())
    ext = _MIME_TO_EXT.get(mime, "bin")
    storage_path = f"{user_id}/{cfg['subfolder']}/{file_uuid}.{ext}"

    admin = get_admin_client()
    try:
        admin.storage.from_(_BUCKET).upload(
            path=storage_path,
            file=file_bytes,
            file_options={"content-type": mime},
        )
    except Exception as exc:
        log.error("sip-evidence-files storage upload failed",
                  extra={"user_id": user_id, "ref": req_id, "kind": kind,
                         "err": str(exc)})
        return _error(status.HTTP_502_BAD_GATEWAY, "storage_upload_failed",
                      "Storage upload failed.")

    entry = {
        "file_uuid": file_uuid,
        "path": storage_path,
        "name": file.filename or f"{kind}-{file_uuid[:8]}.{ext}",
        "size": len(file_bytes),
        "mime": mime,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }

    if cfg["is_list"]:
        new_value: Any = [*list(app_row.get(column) or []), entry]
    else:
        # Single-file slot: replacing means we should also clean up the old
        # storage object so the bucket doesn't accumulate orphans.
        old = app_row.get(column)
        new_value = entry
        if old and isinstance(old, dict) and old.get("path"):
            with contextlib.suppress(Exception):
                admin.storage.from_(_BUCKET).remove([old["path"]])

    try:
        (admin.table("sip_applications")
         .update({column: new_value})
         .eq("id", app_row["id"])
         .eq("status", "draft")
         .execute())
    except Exception as exc:
        log.error("sip-evidence-files JSONB update failed",
                  extra={"user_id": user_id, "ref": req_id, "kind": kind,
                         "err": str(exc)})
        with contextlib.suppress(Exception):
            admin.storage.from_(_BUCKET).remove([storage_path])
        return _error(status.HTTP_500_INTERNAL_SERVER_ERROR, "metadata_write_failed",
                      f"Could not record attachment (ref {req_id}).")

    log.info("sip-evidence-files upload ok",
             extra={"user_id": user_id, "ref": req_id, "kind": kind,
                    "file_uuid": file_uuid})
    return {"ok": True, "kind": kind, "file": entry, "value": new_value}


@router.delete("/{file_uuid}", dependencies=[Depends(_rl_delete)])
async def delete_evidence_file(
    file_uuid: str,
    kind: _KindLiteral = Query(..., description="Which slot the file lives in"),
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["user_id"]
    req_id = _new_request_id()
    cfg = _KIND_CONFIG[kind]

    if file_uuid != "single":
        try:
            uuid.UUID(file_uuid)
        except ValueError:
            return _error(status.HTTP_400_BAD_REQUEST, "bad_file_uuid",
                          "file_uuid must be a UUID (or 'single' for single-file slots).")

    app_row = _fetch_draft_application(user_id)
    if not app_row:
        return _error(status.HTTP_404_NOT_FOUND, "application_missing",
                      "No SIP application found.")
    if app_row["status"] != "draft":
        return _error(status.HTTP_409_CONFLICT, "application_locked",
                      "Application is submitted.")

    column = cfg["column"]
    admin = get_admin_client()

    if cfg["is_list"]:
        existing = list(app_row.get(column) or [])
        target = next((e for e in existing if e.get("file_uuid") == file_uuid), None)
        if not target:
            return _error(status.HTTP_404_NOT_FOUND, "file_not_found",
                          "Attachment not found.")
        new_value: Any = [e for e in existing if e.get("file_uuid") != file_uuid]
    else:
        # Single-slot: file_uuid 'single' or matching the slot's file_uuid clears it.
        target = app_row.get(column)
        if not target or not isinstance(target, dict):
            return _error(status.HTTP_404_NOT_FOUND, "file_not_found",
                          f"No {kind} file currently attached.")
        if file_uuid != "single" and target.get("file_uuid") != file_uuid:
            return _error(status.HTTP_404_NOT_FOUND, "file_not_found",
                          "file_uuid does not match the attached file.")
        new_value = None

    try:
        (admin.table("sip_applications")
         .update({column: new_value})
         .eq("id", app_row["id"])
         .eq("status", "draft")
         .execute())
    except Exception as exc:
        log.error("sip-evidence-files JSONB delete failed",
                  extra={"user_id": user_id, "ref": req_id, "kind": kind,
                         "err": str(exc)})
        return _error(status.HTTP_500_INTERNAL_SERVER_ERROR, "metadata_delete_failed",
                      f"Could not remove attachment (ref {req_id}).")

    if target and isinstance(target, dict) and target.get("path"):
        with contextlib.suppress(Exception):
            admin.storage.from_(_BUCKET).remove([target["path"]])

    return {"ok": True, "kind": kind, "value": new_value}


_ = Request
