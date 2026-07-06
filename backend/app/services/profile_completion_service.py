"""Profile-completion request: token mint/validate, cohort query, and the
form-submission writes (résumé to storage + tir_applications.{resume_file_id,
linkedin_url}). Pure-ish: every function takes a supabase client so it is
unit-testable with a fake.
"""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from app.services import sqs_publisher

_TOKEN_TABLE = "profile_completion_tokens"
_TTL_HOURS = 72
_BUCKET = "tir-resumes"
_MAX_UPLOAD_BYTES = 10 * 1024 * 1024
_MIME_TO_EXT = {
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/msword": "doc",
}

_EVIDENCE_BUCKET = "tir-evidence-files"
_EVIDENCE_MIME_TO_EXT = {"application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png"}
_EVIDENCE_MAX_BYTES = 10 * 1024 * 1024


def _now() -> datetime:
    return datetime.now(timezone.utc)


def compute_needs(app_row: dict) -> tuple[bool, bool]:
    """(needs_resume, needs_linkedin) from a tir_applications row."""
    needs_resume = not app_row.get("resume_file_id")
    needs_linkedin = not (app_row.get("linkedin_url") or "").strip()
    return needs_resume, needs_linkedin


def create_token(
    client: Any,
    *,
    application_id: str | None,
    needs_resume: bool,
    needs_linkedin: bool,
    needs_evidence: bool = False,
    sent_to: str | None,
    is_preview: bool = False,
) -> str:
    token = secrets.token_urlsafe(32)
    client.table(_TOKEN_TABLE).insert({
        "application_id": application_id,
        "application_track": "tir",
        "token": token,
        "needs_resume": needs_resume,
        "needs_linkedin": needs_linkedin,
        "needs_evidence": needs_evidence,
        "is_preview": is_preview,
        "sent_to": sent_to,
        "expires_at": (_now() + timedelta(hours=_TTL_HOURS)).isoformat(),
    }).execute()
    return token


def fetch_token(client: Any, token: str) -> dict | None:
    rows = (client.table(_TOKEN_TABLE).select("*").eq("token", token).limit(1).execute().data) or []
    return rows[0] if rows else None


def token_state(row: dict) -> str:
    """'valid' | 'used' | 'expired'."""
    if row.get("used_at"):
        return "used"
    try:
        exp = datetime.fromisoformat(str(row["expires_at"]))
    except (KeyError, ValueError):
        return "expired"
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    return "valid" if exp > _now() else "expired"


def has_live_token(client: Any, application_id: str) -> bool:
    """True if an unused, unexpired token already exists for this app (dedupe)."""
    rows = (client.table(_TOKEN_TABLE).select("*").eq("application_id", application_id).execute().data) or []
    return any(token_state(r) == "valid" for r in rows)


def mark_used(client: Any, token: str) -> None:
    client.table(_TOKEN_TABLE).update({"used_at": _now().isoformat()}).eq("token", token).execute()


def store_submission(
    client: Any,
    *,
    application_id: str,
    owner_user_id: str,
    file_bytes: bytes | None,
    filename: str | None,
    mime: str | None,
    linkedin_url: str | None,
) -> dict:
    """Upload résumé (if any) + set resume_file_id + linkedin_url on the app.
    Returns {resume: bool, linkedin: bool}. Raises ValueError on a bad file."""
    saved = {"resume": False, "linkedin": False}
    app_patch: dict[str, Any] = {}

    if file_bytes:
        m = (mime or "").lower()
        if m not in _MIME_TO_EXT:
            raise ValueError(f"unsupported_mime:{m}")
        if len(file_bytes) > _MAX_UPLOAD_BYTES:
            raise ValueError("file_too_large")
        ext = _MIME_TO_EXT[m]
        storage_path = f"{owner_user_id}/{uuid.uuid4()}.{ext}"
        client.storage.from_(_BUCKET).upload(
            path=storage_path, file=file_bytes, file_options={"content-type": m},
        )
        ins = client.table("tir_resume_uploads").insert({
            "user_id": owner_user_id,
            "storage_path": storage_path,
            "original_filename": filename or f"resume.{ext}",
            "file_size_bytes": len(file_bytes),
            "mime_type": m,
            "parse_status": "pending",
        }).execute()
        resume_id = (ins.data or [{}])[0].get("id")
        app_patch["resume_file_id"] = resume_id
        saved["resume"] = True

    if linkedin_url and linkedin_url.strip():
        url = linkedin_url.strip()
        if not url.lower().startswith(("http://", "https://")):
            url = "https://" + url
        app_patch["linkedin_url"] = url
        saved["linkedin"] = True

    if app_patch:
        client.table("tir_applications").update(app_patch).eq("id", application_id).execute()

    # A résumé arrived for an already-submitted app (profile-completion link) —
    # enqueue an async, TIR-only founder-check. Best-effort: never blocks the form.
    if saved["resume"]:
        sqs_publisher.publish_founder_check(application_id, "tir")

    return saved


def _bytes_exist(client: Any, bucket: str, path: str) -> bool:
    """True if the object's bytes serve. Conservative: unknown/error -> True
    (never prune a file we can't confirm is missing)."""
    try:
        s = client.storage.from_(bucket).create_signed_url(path, 120)
        url = s.get("signedURL") or s.get("signedUrl") or s.get("url")
        if not url:
            return True
        if url.startswith("/"):
            import os as _os
            url = _os.environ["SUPABASE_URL"] + url
        return httpx.get(url, headers={"Range": "bytes=0-0"}, timeout=20).status_code in (200, 206)
    except Exception:
        return True


def store_evidence_submission(
    client: Any,
    *,
    application_id: str,
    owner_user_id: str,
    files: list[dict],
    exists_fn=_bytes_exist,
) -> dict:
    """Upload each evidence file, then rebuild evidence_files = (existing whose
    bytes still resolve) + (new). Prunes dead entries. Raises ValueError on a bad file."""
    new_entries = []
    for f in files:
        m = (f.get("mime") or "").lower()
        if m not in _EVIDENCE_MIME_TO_EXT:
            raise ValueError(f"unsupported_mime:{m}")
        data = f["bytes"]
        if len(data) > _EVIDENCE_MAX_BYTES:
            raise ValueError("file_too_large")
        ext = _EVIDENCE_MIME_TO_EXT[m]
        fid = str(uuid.uuid4())
        path = f"{owner_user_id}/evidence/{fid}.{ext}"
        client.storage.from_(_EVIDENCE_BUCKET).upload(
            path=path, file=data, file_options={"content-type": m})
        new_entries.append({"file_uuid": fid, "path": path,
            "name": f.get("filename") or f"evidence-{fid[:8]}.{ext}",
            "size": len(data), "mime": m, "uploaded_at": _now().isoformat()})

    rows = (client.table("tir_applications").select("id,evidence_files")
            .eq("id", application_id).limit(1).execute().data) or []
    existing = list((rows[0].get("evidence_files") if rows else None) or [])
    kept = [e for e in existing if isinstance(e, dict) and e.get("path")
            and exists_fn(_EVIDENCE_BUCKET, e["path"])]
    pruned = len(existing) - len(kept)
    client.table("tir_applications").update(
        {"evidence_files": [*kept, *new_entries]}).eq("id", application_id).execute()
    return {"added": len(new_entries), "pruned": pruned, "kept": len(kept)}


# Applicants no longer in consideration — never nudged to complete a profile.
_EXCLUDED_STATUSES = {"rejected", "withdrawn"}


def find_cohort(client: Any, *, limit: int | None = None) -> list[dict]:
    """Submitted TIR apps missing résumé and/or LinkedIn, with needs flags +
    the fields needed to email them. Excludes rejected/withdrawn applicants.
    Filters/needs computed in Python."""
    rows = (
        client.table("tir_applications")
        .select("id,user_id,basic_full_name,display_seq,resume_file_id,linkedin_url,submitted_at,status")
        .not_.is_("submitted_at", "null")
        .execute()
        .data
    ) or []
    out = []
    for r in rows:
        if r.get("status") in _EXCLUDED_STATUSES:
            continue
        nr, nl = compute_needs(r)
        if nr or nl:
            out.append({**r, "needs_resume": nr, "needs_linkedin": nl})
    out.sort(key=lambda r: r.get("display_seq") or 0)
    return out[:limit] if limit else out
