"""Juror portal (v2): queue, content, signed-url. No scoring, no consensus.

Every endpoint is guarded by ``require_capability("view_assigned_jury_apps")``.
Selections endpoints (GET mine / PUT set-replace exactly-3) are added in a
follow-up task — this module intentionally leaves that seam.
"""
# NOTE: no `from __future__ import annotations` — FastAPI + pydantic 2 cannot
# resolve stringified deps (same constraint as routers/mentors.py & jury_invites.py).

import logging
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi import status as http_status

from ..deps import get_current_user
from ..rbac import require_capability
from ..services import applications_query, jury_query
from ..supabase_client import get_admin_client

log = logging.getLogger(__name__)

router = APIRouter(prefix="/jury", tags=["jury"])


@router.get("/queue", dependencies=[Depends(require_capability("view_assigned_jury_apps"))])
async def get_jury_queue(user: dict = Depends(get_current_user)) -> list[dict]:
    """Canonical jury queue — one record per assignment, with pick flags."""
    return jury_query.fetch_jury_queue(user["user_id"])


@router.get("/applications/{track}/{application_id}/content",
            dependencies=[Depends(require_capability("view_assigned_jury_apps"))])
async def get_application_content(
    track: Literal["tir", "sip"],
    application_id: str,
    user: dict = Depends(get_current_user),
) -> dict:
    """Full presenter payload — 404 (not 403) when unassigned (anti-enumeration,
    same as the reviewer content endpoint)."""
    result = jury_query.fetch_jury_content(user["user_id"], track, application_id)
    if result is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND,
                            detail={"code": "not_found"})
    return result


@router.get("/applications/{track}/{application_id}/files/signed-url",
            dependencies=[Depends(require_capability("view_assigned_jury_apps"))])
async def get_signed_file_url(
    track: Literal["tir", "sip"],
    application_id: str,
    storage_path: str = Query(..., min_length=1),
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Short-lived signed URL for one of an ASSIGNED application's files.

    Ported verbatim from the reviewer signed-URL endpoint, with the reviewer
    assignment check swapped for the jury one: authorisation = a matching
    ``jury_query.fetch_application_for_juror`` (None → 404) plus a path
    allow-list rebuilt from the application's own file fields (incl. résumé).
    404 (not 403) on unassigned / unknown path — no enumeration. Path traversal
    rejected. TTL 120s.
    """
    if ".." in storage_path:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail={"code": "invalid_storage_path"},
        )
    payload = jury_query.fetch_application_for_juror(user["user_id"], track, application_id)
    if payload is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND,
                            detail={"code": "not_found"})
    app_row = payload["application"]
    allowed = applications_query.collect_application_file_paths(track, app_row)
    resume_file = applications_query.resolve_resume_file(track, app_row)
    if resume_file:
        allowed[resume_file["storage_path"]] = resume_file["bucket"]
    bucket = allowed.get(storage_path)
    if bucket is None:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND,
                            detail={"code": "file_not_found"})
    try:
        signed = (get_admin_client()
                  .storage.from_(bucket)
                  .create_signed_url(storage_path, 120))
        url = None
        if isinstance(signed, dict):
            url = signed.get("signedURL") or signed.get("signedUrl") or signed.get("url")
        if not url:
            raise RuntimeError("no signed url")
        return {"url": url, "expires_in": 120}
    except HTTPException:
        raise
    except Exception as exc:
        msg = str(exc).lower()
        if "not_found" in msg or "not found" in msg:
            raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND,
                                detail={"code": "file_not_available"}) from exc
        log.warning("jury signed-url generation failed",
                    extra={"application_id": application_id, "track": track})
        raise HTTPException(status_code=http_status.HTTP_502_BAD_GATEWAY,
                            detail={"code": "signed_url_failed"}) from exc
