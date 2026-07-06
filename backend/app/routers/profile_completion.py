"""Profile-completion request router.

Admin: POST /admin/profile-completion/send  (sample | gated cohort)
Public (token): GET /profile-completion/{token}, POST /profile-completion/{token}
"""

# NOTE: deliberately no `from __future__ import annotations` — FastAPI +
# pydantic 2 cannot resolve stringified `UploadFile | None` / `Annotated[...]`
# annotations, so keep runtime (non-stringified) type hints in this file.
# (See app/routers/support.py for the same note.)

import logging
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.exceptions import HTTPException
from pydantic import BaseModel
from slowapi.util import get_remote_address

from ..deps import get_current_user
from ..rbac import require_capability
from ..services import profile_completion_service as svc
from ..services.email_service import frontend_url, get_email_service
from ..supabase_client import get_admin_client
from ..utils.rate_limit import limiter

log = logging.getLogger(__name__)
router = APIRouter(tags=["profile-completion"])

_FORM_PATH = "/apply/profile-completion/"


class SendBody(BaseModel):
    mode: Literal["sample", "cohort"]
    sample_email: str | None = None
    limit: int | None = None
    dry_run: bool = False
    confirm: bool = False
    force: bool = False


def _applicant_display(client: Any, application_id: str) -> tuple[str, str]:
    try:
        rows = (client.table("tir_applications")
                .select("basic_full_name,display_seq").eq("id", application_id).limit(1).execute().data) or []
    except Exception:
        rows = []
    if not rows:
        return ("Applicant", "")
    r = rows[0]
    seq = r.get("display_seq")
    return (r.get("basic_full_name") or "Applicant", f"TIR-{seq}" if seq else "")


def _resolve_emails(client: Any, user_ids: list[str]) -> dict[str, str]:
    if not user_ids:
        return {}
    rows = (client.table("profiles").select("id,email").in_("id", list(set(user_ids))).execute().data) or []
    return {r["id"]: r.get("email") for r in rows if r.get("email")}


@router.post(
    "/admin/profile-completion/send",
    dependencies=[Depends(require_capability("manage_users"))],
)
async def send_requests(body: SendBody, user: dict = Depends(get_current_user)) -> dict:
    client = get_admin_client()
    es = get_email_service()

    if body.mode == "sample":
        if not body.sample_email:
            raise HTTPException(status_code=400, detail={"code": "sample_email_required"})
        token = svc.create_token(
            client, application_id=None, needs_resume=True, needs_linkedin=True,
            sent_to=body.sample_email, is_preview=True,
        )
        es.send_profile_completion_request(
            to=body.sample_email, applicant_name="Applicant",
            needs_resume=True, needs_linkedin=True,
            link_url=frontend_url(_FORM_PATH + token),
        )
        return {"mode": "sample", "sent": 1}

    if not body.confirm:
        raise HTTPException(status_code=400, detail={"code": "confirm_required"})
    cohort = svc.find_cohort(client, limit=body.limit)
    if body.dry_run:
        return {"mode": "cohort", "matched": len(cohort), "dry_run": True, "sent": 0}
    emails = _resolve_emails(client, [c["user_id"] for c in cohort])
    sent = skipped = failed = 0
    for c in cohort:
        addr = emails.get(c["user_id"])
        if not addr:
            skipped += 1
            continue
        if not body.force and svc.has_live_token(client, c["id"]):
            skipped += 1
            continue
        try:
            token = svc.create_token(
                client, application_id=c["id"], needs_resume=c["needs_resume"],
                needs_linkedin=c["needs_linkedin"], sent_to=addr, is_preview=False,
            )
            es.send_profile_completion_request(
                to=addr, applicant_name=c.get("basic_full_name") or "Applicant",
                needs_resume=c["needs_resume"], needs_linkedin=c["needs_linkedin"],
                link_url=frontend_url(_FORM_PATH + token),
            )
            sent += 1
        except Exception as exc:  # noqa: BLE001
            failed += 1
            log.warning("profile-completion send failed", extra={"app": c["id"], "err": str(exc)})
    return {"mode": "cohort", "matched": len(cohort), "sent": sent, "skipped": skipped, "failed": failed}


def _pc_key(request: Request) -> str:
    return f"profile-completion:{get_remote_address(request)}"


async def get_token_state(token: str) -> dict:
    client = get_admin_client()
    row = svc.fetch_token(client, token)
    if not row:
        return {"valid": False, "reason": "invalid"}
    state = svc.token_state(row)
    if state != "valid":
        return {"valid": False, "reason": state}
    if row.get("is_preview") or not row.get("application_id"):
        name, disp = "Applicant", "TIR — sample"
    else:
        name, disp = _applicant_display(client, row["application_id"])
    return {
        "valid": True,
        "needs_resume": bool(row.get("needs_resume")),
        "needs_linkedin": bool(row.get("needs_linkedin")),
        "needs_evidence": bool(row.get("needs_evidence")),
        "is_preview": bool(row.get("is_preview")),
        "applicant_name": name,
        "display_id": disp,
    }


@router.get("/profile-completion/{token}")
@limiter.limit("30/hour", key_func=_pc_key)
async def get_token_state_route(token: str, request: Request) -> dict:
    return await get_token_state(token)


async def submit_form(
    token: str,
    file: UploadFile | None = None,
    files: list[UploadFile] | None = None,
    linkedin_url: str | None = None,
) -> dict:
    client = get_admin_client()
    row = svc.fetch_token(client, token)
    if not row:
        raise HTTPException(status_code=404, detail={"code": "invalid"})
    state = svc.token_state(row)
    if state != "valid":
        raise HTTPException(status_code=410, detail={"code": state})

    if row.get("is_preview") or not row.get("application_id"):
        return {"ok": True, "preview": True}

    if row.get("needs_evidence"):
        ups = files or ([file] if file else [])
        if not ups:
            raise HTTPException(status_code=422, detail={"code": "nothing_provided"})
        app_rows = (client.table("tir_applications").select("id,user_id")
                    .eq("id", row["application_id"]).limit(1).execute().data) or []
        if not app_rows:
            raise HTTPException(status_code=404, detail={"code": "application_not_found"})
        owner = app_rows[0]["user_id"]
        payload = [{"bytes": await u.read(), "filename": u.filename, "mime": u.content_type} for u in ups]
        try:
            saved = svc.store_evidence_submission(
                client, application_id=row["application_id"], owner_user_id=owner, files=payload,
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail={"code": str(exc)}) from exc
        svc.mark_used(client, token)
        return {"ok": True, "saved": saved}

    if row.get("needs_resume") and file is None and not (linkedin_url or "").strip():
        raise HTTPException(status_code=422, detail={"code": "nothing_provided"})

    file_bytes = await file.read() if file is not None else None
    app_rows = (client.table("tir_applications").select("id,user_id")
                .eq("id", row["application_id"]).limit(1).execute().data) or []
    if not app_rows:
        raise HTTPException(status_code=404, detail={"code": "application_not_found"})
    owner = app_rows[0]["user_id"]
    try:
        saved = svc.store_submission(
            client, application_id=row["application_id"], owner_user_id=owner,
            file_bytes=file_bytes, filename=(file.filename if file else None),
            mime=(file.content_type if file else None), linkedin_url=linkedin_url,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail={"code": str(exc)}) from exc
    svc.mark_used(client, token)
    return {"ok": True, "saved": saved}


@router.post("/profile-completion/{token}")
@limiter.limit("10/hour", key_func=_pc_key)
async def submit_form_route(
    token: str,
    request: Request,
    file: UploadFile | None = File(None),
    files: list[UploadFile] | None = File(None),
    linkedin_url: str | None = Form(None),
) -> dict:
    return await submit_form(token, file=file, files=files, linkedin_url=linkedin_url)


class EvidenceSendBody(BaseModel):
    mode: Literal["sample", "list"]
    sample_email: str | None = None
    application_ids: list[str] | None = None
    dry_run: bool = False
    confirm: bool = False
    force: bool = False


@router.post(
    "/admin/evidence-recollection/send",
    dependencies=[Depends(require_capability("manage_users"))],
)
async def send_evidence_requests(body: EvidenceSendBody, user: dict = Depends(get_current_user)) -> dict:
    client = get_admin_client()
    es = get_email_service()

    if body.mode == "sample":
        if not body.sample_email:
            raise HTTPException(status_code=400, detail={"code": "sample_email_required"})
        token = svc.create_token(
            client, application_id=None, needs_resume=False, needs_linkedin=False,
            needs_evidence=True, sent_to=body.sample_email, is_preview=True,
        )
        es.send_evidence_recollection(
            to=body.sample_email, applicant_name="Applicant",
            display_id="TIR — sample", link_url=frontend_url(_FORM_PATH + token),
        )
        return {"mode": "sample", "sent": 1}

    if not body.application_ids:
        raise HTTPException(status_code=400, detail={"code": "application_ids_required"})
    if body.dry_run:
        return {"mode": "list", "matched": len(body.application_ids), "dry_run": True, "sent": 0}
    if not body.confirm:
        raise HTTPException(status_code=400, detail={"code": "confirm_required"})

    apps = (client.table("tir_applications").select("id,user_id,basic_full_name,display_seq")
            .in_("id", body.application_ids).execute().data) or []
    emails = _resolve_emails(client, [a["user_id"] for a in apps])
    sent = skipped = failed = 0
    for a in apps:
        addr = emails.get(a["user_id"])
        if not addr:
            skipped += 1
            continue
        if not body.force and svc.has_live_token(client, a["id"]):
            skipped += 1
            continue
        try:
            token = svc.create_token(
                client, application_id=a["id"], needs_resume=False, needs_linkedin=False,
                needs_evidence=True, sent_to=addr, is_preview=False,
            )
            seq = a.get("display_seq")
            es.send_evidence_recollection(
                to=addr, applicant_name=a.get("basic_full_name") or "Applicant",
                display_id=f"TIR-{seq}" if seq else "", link_url=frontend_url(_FORM_PATH + token),
            )
            sent += 1
        except Exception as exc:  # noqa: BLE001
            failed += 1
            log.warning("evidence send failed", extra={"app": a["id"], "err": str(exc)})
    return {"mode": "list", "matched": len(apps), "sent": sent, "skipped": skipped, "failed": failed}


# --- Direct-to-storage evidence upload (bypasses the ~6MB API payload cap) ---------------

class EvidenceUploadUrlBody(BaseModel):
    filename: str
    mime: str


class UploadedEvidenceFile(BaseModel):
    path: str
    name: str | None = None
    size: int | None = None
    mime: str


class EvidenceFinalizeBody(BaseModel):
    files: list[UploadedEvidenceFile]


def _load_evidence_token(client: Any, token: str) -> tuple[dict, str]:
    """Validate a real (non-preview) needs_evidence token; return (row, owner_user_id)."""
    row = svc.fetch_token(client, token)
    if not row:
        raise HTTPException(status_code=404, detail={"code": "invalid"})
    state = svc.token_state(row)
    if state != "valid":
        raise HTTPException(status_code=410, detail={"code": state})
    if not row.get("needs_evidence"):
        raise HTTPException(status_code=400, detail={"code": "not_evidence_token"})
    if row.get("is_preview") or not row.get("application_id"):
        raise HTTPException(status_code=400, detail={"code": "preview_no_storage"})
    app_rows = (client.table("tir_applications").select("id,user_id")
                .eq("id", row["application_id"]).limit(1).execute().data) or []
    if not app_rows:
        raise HTTPException(status_code=404, detail={"code": "application_not_found"})
    return row, app_rows[0]["user_id"]


async def evidence_upload_url(token: str, body: "EvidenceUploadUrlBody") -> dict:
    client = get_admin_client()
    _row, owner = _load_evidence_token(client, token)
    try:
        return svc.create_evidence_upload_url(
            client, owner_user_id=owner, filename=body.filename, mime=body.mime,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail={"code": str(exc)}) from exc


@router.post("/profile-completion/{token}/evidence-upload-url")
@limiter.limit("60/hour", key_func=_pc_key)
async def evidence_upload_url_route(token: str, request: Request, body: EvidenceUploadUrlBody) -> dict:
    """Mint a signed URL for the browser to PUT one file directly to storage."""
    return await evidence_upload_url(token, body)


async def evidence_finalize(token: str, body: "EvidenceFinalizeBody") -> dict:
    client = get_admin_client()
    row, owner = _load_evidence_token(client, token)
    try:
        saved = svc.finalize_evidence_submission(
            client, application_id=row["application_id"], owner_user_id=owner,
            uploaded=[f.model_dump() for f in body.files],
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail={"code": str(exc)}) from exc
    svc.mark_used(client, token)
    return {"ok": True, "saved": saved}


@router.post("/profile-completion/{token}/evidence-finalize")
@limiter.limit("20/hour", key_func=_pc_key)
async def evidence_finalize_route(token: str, request: Request, body: EvidenceFinalizeBody) -> dict:
    """Register the directly-uploaded files into evidence_files (prune dead + append)."""
    return await evidence_finalize(token, body)
