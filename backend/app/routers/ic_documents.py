"""Investment Committee (IC) documents — admin "Jury VIP Selected" section.

    GET  /admin/platform/ic-documents?track=sip                 list current docs
    POST /admin/platform/ic-documents/{track}/{id}              upload the IC PDF
    POST /admin/platform/ic-documents/{track}/{id}/signature    upload the signed PDF
    GET  /admin/platform/ic-documents/{track}/{id}/file         120s signed URL

All four are gated by ``manage_ic_documents`` (admin + leadership).

The signature is drawn/typed in the browser and stamped into the PDF client-side
(pdf-lib), so this router receives an already-stamped PDF and stores it as the
signed copy of the current document. The *identity* of the signer is NOT taken
from the request body — ``signed_by``/``signer_email`` come from the caller's
JWT, so a client cannot claim to be somebody else. ``signer_name`` is the typed
display name that appears on the stamp.

Uploading a new IC PDF supersedes the previous document (``superseded_at``)
rather than deleting it — the old object stays in storage as the audit trail.

There is intentionally no application-status guard: the Final Gate moves an app
out of ``jury_review``, and the IC document may be uploaded or signed after that.
"""
# NOTE: no `from __future__ import annotations` — FastAPI + pydantic 2 cannot
# resolve stringified deps (same constraint as routers/mentors.py & jury.py).

import logging
import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi import status as http_status

from ..deps import get_current_user
from ..rbac import require_capability
from ..services.audit import actor_role_of, write_audit
from ..supabase_client import get_admin_client

log = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/platform/ic-documents", tags=["ic-documents"])

_BUCKET = "ic-documents"
_MAX_BYTES = 10 * 1024 * 1024
_PDF_MIME = "application/pdf"


def _error(status_code: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


async def _read_pdf(file: UploadFile) -> bytes:
    """Validate + read an uploaded PDF. Rejects non-PDF, empty and oversized."""
    mime = (file.content_type or "").lower().split(";")[0].strip()
    if mime != _PDF_MIME:
        raise _error(http_status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "unsupported_media",
                     f"Only PDF files are accepted (got {mime or 'unknown'}).")
    data = await file.read()
    if not data:
        raise _error(http_status.HTTP_400_BAD_REQUEST, "empty_file", "The file is empty.")
    if len(data) > _MAX_BYTES:
        raise _error(http_status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "too_large",
                     f"File exceeds {_MAX_BYTES // (1024 * 1024)} MiB.")
    # Cheap magic-byte check so a renamed .docx can't sail through on MIME alone.
    if not data.startswith(b"%PDF"):
        raise _error(http_status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "unsupported_media",
                     "That file is not a valid PDF.")
    return data


def _table(track: str) -> str:
    return "tir_applications" if track == "tir" else "sip_applications"


def _resolve_native_track(sb: Any, track: str, application_id: str) -> str:
    """Return the track whose table actually holds this application.

    Under the track-move overlay the admin UI shows an app's EFFECTIVE track
    (``moved_to_track`` wins), so the caller may hand us "sip" for a row that
    still lives in ``tir_applications``. Every IC document is keyed by the
    NATIVE track — the one that matches where the application row is — so the
    key stays stable if the app is moved again later. Checks the supplied track
    first, then the other one; 404 if neither has it.
    """
    for candidate in (track, "sip" if track == "tir" else "tir"):
        try:
            rows = (sb.table(_table(candidate)).select("id")
                    .eq("id", application_id).limit(1).execute().data) or []
        except Exception as exc:
            log.warning("ic_documents: application lookup failed",
                        extra={"application_id": application_id,
                               "track": candidate, "err": str(exc)})
            raise _error(http_status.HTTP_502_BAD_GATEWAY, "lookup_failed",
                         "Couldn't verify the application. Try again.") from exc
        if rows:
            return candidate
    raise _error(http_status.HTTP_404_NOT_FOUND, "application_not_found",
                 "No such application.")


def _fetch_current(sb: Any, track: str, application_id: str) -> dict | None:
    """The one non-superseded IC document for this application, if any."""
    try:
        rows = (sb.table("ic_documents").select("*")
                .eq("application_id", application_id)
                .eq("application_track", track)
                .is_("superseded_at", None)
                .execute().data) or []
    except Exception as exc:
        log.warning("ic_documents: current fetch failed",
                    extra={"application_id": application_id, "track": track, "err": str(exc)})
        return None
    # Re-filter in Python: the hermetic fake honors .eq/.is_ but prod is the
    # authority, and a belt-and-braces filter costs nothing.
    rows = [r for r in rows
            if r.get("application_id") == application_id
            and r.get("application_track") == track
            and r.get("superseded_at") is None]
    return rows[0] if rows else None


def _public_doc(row: dict | None) -> dict | None:
    """Shape one row for the admin UI (no storage internals beyond the paths,
    which the signed-url endpoint validates against the row anyway)."""
    if not row:
        return None
    return {
        "id":              row.get("id"),
        "application_id":  row.get("application_id"),
        "track":           row.get("application_track"),
        "file_name":       row.get("file_name"),
        "size_bytes":      row.get("size_bytes"),
        "uploaded_at":     row.get("uploaded_at"),
        "uploaded_by":     row.get("uploaded_by"),
        "signed":          bool(row.get("signed_storage_path")),
        "signed_at":       row.get("signed_at"),
        "signer_name":     row.get("signer_name"),
        "signer_email":    row.get("signer_email"),
        "signed_file_name": row.get("signed_file_name"),
    }


@router.get("", dependencies=[Depends(require_capability("manage_ic_documents"))])
async def list_ic_documents(track: str | None = Query(default=None)) -> dict[str, Any]:
    """Every current IC document, optionally narrowed to one track.

    Degrades to an empty list rather than 500-ing, so a data problem can never
    blank the whole Jury VIP screen.
    """
    sb = get_admin_client()
    try:
        q = sb.table("ic_documents").select("*").is_("superseded_at", None)
        if track:
            q = q.eq("application_track", track)
        rows = q.execute().data or []
    except Exception as exc:
        log.warning("ic_documents: list failed", extra={"track": track, "err": str(exc)})
        return {"documents": []}
    rows = [r for r in rows if r.get("superseded_at") is None
            and (not track or r.get("application_track") == track)]
    return {"documents": [_public_doc(r) for r in rows]}


@router.post("/{track}/{application_id}",
             status_code=http_status.HTTP_201_CREATED,
             dependencies=[Depends(require_capability("manage_ic_documents"))])
async def upload_ic_document(
    track: Literal["tir", "sip"],
    application_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Upload (or replace) the IC PDF for one application.

    Replacing supersedes the previous row — its storage object is left in place
    as the audit artefact, and its signature travels with it into history.
    """
    sb = get_admin_client()
    track = _resolve_native_track(sb, track, application_id)
    data = await _read_pdf(file)

    doc_id = str(uuid.uuid4())
    storage_path = f"{track}/{application_id}/{doc_id}.pdf"
    try:
        sb.storage.from_(_BUCKET).upload(
            path=storage_path, file=data, file_options={"content-type": _PDF_MIME})
    except Exception as exc:
        log.error("ic_documents: storage upload failed",
                  extra={"application_id": application_id, "track": track, "err": str(exc)})
        raise _error(http_status.HTTP_502_BAD_GATEWAY, "storage_upload_failed",
                     "Storage upload failed. Try again.") from exc

    now = datetime.now(UTC).isoformat()
    # Supersede the outgoing document BEFORE inserting the new one, so the
    # partial-unique index can never see two current rows.
    previous = _fetch_current(sb, track, application_id)
    if previous:
        try:
            sb.table("ic_documents").update({"superseded_at": now, "updated_at": now}) \
                .eq("id", previous["id"]).execute()
        except Exception as exc:
            log.error("ic_documents: supersede failed",
                      extra={"application_id": application_id, "err": str(exc)})
            raise _error(http_status.HTTP_502_BAD_GATEWAY, "supersede_failed",
                         "Couldn't replace the existing document. Try again.") from exc

    row = {
        "id": doc_id,
        "application_id": application_id,
        "application_track": track,
        "bucket": _BUCKET,
        "storage_path": storage_path,
        "file_name": file.filename or f"IC-{application_id[:8]}.pdf",
        "size_bytes": len(data),
        "uploaded_by": user["user_id"],
        "uploaded_at": now,
        "created_at": now,
        "updated_at": now,
    }
    try:
        sb.table("ic_documents").insert(row).execute()
    except Exception as exc:
        log.error("ic_documents: insert failed",
                  extra={"application_id": application_id, "err": str(exc)})
        raise _error(http_status.HTTP_502_BAD_GATEWAY, "record_failed",
                     "The file uploaded but couldn't be recorded. Try again.") from exc

    write_audit(
        actor_user_id=user["user_id"],
        actor_role=actor_role_of(user),
        action_type="ic_document_uploaded",
        target_table="ic_documents",
        target_id=doc_id,
        after={"application_id": application_id, "track": track,
               "file_name": row["file_name"], "size_bytes": len(data),
               "replaced_previous": bool(previous)},
    )
    return {"document": _public_doc(row)}


@router.post("/{track}/{application_id}/signature",
             dependencies=[Depends(require_capability("manage_ic_documents"))])
async def sign_ic_document(
    track: Literal["tir", "sip"],
    application_id: str,
    file: UploadFile = File(...),
    signer_name: str = Form(...),
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Attach the signed copy of the current IC document.

    ``file`` is the browser-stamped PDF. The signer's identity is taken from the
    authenticated caller — never from the payload — so the recorded signature is
    always attributable. Re-signing overwrites the previous signed copy.
    """
    name = (signer_name or "").strip()
    if not name:
        raise _error(http_status.HTTP_422_UNPROCESSABLE_ENTITY, "signer_name_required",
                     "Type the signer's name to sign.")
    if len(name) > 200:
        raise _error(http_status.HTTP_422_UNPROCESSABLE_ENTITY, "signer_name_too_long",
                     "Signer name must be 200 characters or fewer.")

    sb = get_admin_client()
    track = _resolve_native_track(sb, track, application_id)
    current = _fetch_current(sb, track, application_id)
    if not current:
        raise _error(http_status.HTTP_409_CONFLICT, "no_ic_document",
                     "Upload the IC document before signing it.")
    data = await _read_pdf(file)

    signed_path = f"{track}/{application_id}/{current['id']}-signed.pdf"
    try:
        sb.storage.from_(_BUCKET).upload(
            path=signed_path, file=data,
            # A re-sign writes the same key, so the upload must overwrite.
            file_options={"content-type": _PDF_MIME, "upsert": "true"})
    except Exception as exc:
        log.error("ic_documents: signed upload failed",
                  extra={"application_id": application_id, "track": track, "err": str(exc)})
        raise _error(http_status.HTTP_502_BAD_GATEWAY, "storage_upload_failed",
                     "Storage upload failed. Try again.") from exc

    now = datetime.now(UTC).isoformat()
    patch = {
        "signed_storage_path": signed_path,
        "signed_file_name": file.filename or f"IC-{application_id[:8]}-signed.pdf",
        "signed_size_bytes": len(data),
        "signed_by": user["user_id"],
        "signer_name": name,
        "signer_email": user.get("email"),
        "signed_at": now,
        "updated_at": now,
    }
    try:
        sb.table("ic_documents").update(patch).eq("id", current["id"]).execute()
    except Exception as exc:
        log.error("ic_documents: signature record failed",
                  extra={"application_id": application_id, "err": str(exc)})
        raise _error(http_status.HTTP_502_BAD_GATEWAY, "record_failed",
                     "The signature uploaded but couldn't be recorded. Try again.") from exc

    write_audit(
        actor_user_id=user["user_id"],
        actor_role=actor_role_of(user),
        action_type="ic_document_signed",
        target_table="ic_documents",
        target_id=current["id"],
        after={"application_id": application_id, "track": track,
               "signer_name": name, "signer_email": user.get("email"),
               "signed_at": now},
    )
    return {"document": _public_doc({**current, **patch})}


@router.get("/{track}/{application_id}/file",
            dependencies=[Depends(require_capability("manage_ic_documents"))])
async def get_ic_document_url(
    track: Literal["tir", "sip"],
    application_id: str,
    variant: Literal["original", "signed"] = Query(default="original"),
) -> dict[str, Any]:
    """Short-lived (120s) signed URL for the original or the signed copy.

    The path is read off the document row — never taken from the caller — so
    there is nothing to traverse or enumerate.
    """
    sb = get_admin_client()
    current = (_fetch_current(sb, track, application_id)
               # Tolerate an effective-track caller: the doc is keyed by native.
               or _fetch_current(sb, "sip" if track == "tir" else "tir", application_id))
    if not current:
        raise _error(http_status.HTTP_404_NOT_FOUND, "not_found", "No IC document.")
    path = current.get("signed_storage_path") if variant == "signed" else current.get("storage_path")
    if not path:
        raise _error(http_status.HTTP_404_NOT_FOUND, "variant_not_available",
                     "This IC document has not been signed yet."
                     if variant == "signed" else "No stored file for this document.")
    try:
        signed = sb.storage.from_(current.get("bucket") or _BUCKET).create_signed_url(path, 120)
        url = None
        if isinstance(signed, dict):
            url = signed.get("signedURL") or signed.get("signedUrl") or signed.get("url")
        if not url:
            raise RuntimeError("no signed url")
        return {"url": url, "expires_in": 120, "variant": variant}
    except HTTPException:
        raise
    except Exception as exc:
        msg = str(exc).lower()
        if "not_found" in msg or "not found" in msg:
            raise _error(http_status.HTTP_404_NOT_FOUND, "file_not_available",
                         "The stored file is no longer available.") from exc
        log.warning("ic_documents: signed-url generation failed",
                    extra={"application_id": application_id, "track": track})
        raise _error(http_status.HTTP_502_BAD_GATEWAY, "signed_url_failed",
                     "Couldn't produce a download link. Try again.") from exc
