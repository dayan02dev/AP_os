"""ARTPARK Innovation Readiness (AIR) assessment — VIP only.

Gate: require_founder_access resolves the caller's own application, then this
router rejects any non-VIP track. Ownership is therefore structural — a founder
can only ever address their own round, because the application id comes from
the gate rather than from the request.
"""
from __future__ import annotations

import contextlib
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi import status as http_status

from ..models.air import LeverAnswersIn
from ..services import air_catalog as cat
from ..services import air_query as aq
from ..services import air_scoring as sc
from ..supabase_client import get_admin_client
from .founder import require_founder_access

router = APIRouter(prefix="/founder/air", tags=["founder-air"])

# Evidence documents live in their own private bucket, separate from
# tir-founder-docs/vip's own MOU bucket — AIR qualifying documents are a
# distinct artefact class with their own retention/verification story.
BUCKET = "vip-founder-docs"


def require_vip(ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    """AIR is a VIP-programme instrument; TIR runs its own residency track."""
    if ctx["track"] != "sip":
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail={"code": "not_available_for_track"},
        )
    return ctx


def _label() -> str:
    return aq.current_round_label(datetime.now(UTC).date())


def _persist_claimed_rollups(assessment_id: str, bundle: dict) -> None:
    roll = bundle["rollups"]["claimed"]
    get_admin_client().table("vip_air_assessments").update({
        "overall_claimed": roll["overall"],
        "tech_claimed": roll["technology"],
        "comm_claimed": roll["commercial"],
        "updated_at": datetime.now(UTC).isoformat(),
    }).eq("id", assessment_id).execute()


@router.get("")
async def get_air(ctx: Annotated[dict, Depends(require_vip)]) -> dict:
    return aq.assessment_bundle(ctx["application_id"], _label())


@router.put("/levers/{lever}")
async def put_lever(
    lever: str,
    body: LeverAnswersIn,
    ctx: Annotated[dict, Depends(require_vip)],
) -> dict:
    if lever not in cat.LEVER_KEYS:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND,
                            detail={"code": "unknown_lever"})
    label = _label()
    rnd = aq.ensure_round(ctx["application_id"], label)
    if rnd["status"] != "draft":
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT,
                            detail={"code": "air_already_submitted"})

    # Option ids are only meaningful per (lever, question), which the request
    # model cannot know — so validate here rather than in pydantic.
    answers = {"q1": body.q1_option, "q2": body.q2_option, "q3": body.q3_option}
    for q_id, opt in answers.items():
        if opt and cat.level_for_option(lever, q_id, opt) is None:
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"code": "invalid_option", "question": q_id, "option": opt},
            )

    sb = get_admin_client()
    sb.table("vip_air_lever_scores").update({
        "q1_option": body.q1_option,
        "q2_option": body.q2_option,
        "q3_option": body.q3_option,
        "criteria_checked": body.criteria_checked,
        "claimed_level": sc.lever_level(lever, answers),
        "updated_at": datetime.now(UTC).isoformat(),
    }).eq("assessment_id", rnd["id"]).eq("lever", lever).execute()

    bundle = aq.assessment_bundle(ctx["application_id"], label)
    _persist_claimed_rollups(rnd["id"], bundle)
    return bundle


@router.post("/submit")
async def submit_air(ctx: Annotated[dict, Depends(require_vip)]) -> dict:
    label = _label()
    rnd = aq.ensure_round(ctx["application_id"], label)
    if rnd["status"] != "draft":
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT,
                            detail={"code": "air_already_submitted"})

    bundle = aq.assessment_bundle(ctx["application_id"], label)
    missing = [l["lever"] for l in bundle["levers"] if l["claimed_level"] is None]
    if missing:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "air_incomplete", "missing": missing},
        )

    roll = bundle["rollups"]["claimed"]
    get_admin_client().table("vip_air_assessments").update({
        "status": "submitted",
        "submitted_at": datetime.now(UTC).isoformat(),
        "overall_claimed": roll["overall"],
        "tech_claimed": roll["technology"],
        "comm_claimed": roll["commercial"],
    }).eq("id", rnd["id"]).execute()

    return aq.assessment_bundle(ctx["application_id"], label)


# ── Evidence — the qualifying document per lever/level ──────────────────────
# Mirrors founder_mou._upload: a thin, mockable wrapper around the storage
# client so tests never touch real storage. Kept at module level, named
# exactly `_upload`, because the test suite monkeypatches it there.
def _upload(path: str, data: bytes, content_type: str) -> None:
    sb = get_admin_client()
    sb.storage.from_(BUCKET).upload(
        path, data, {"content-type": content_type, "upsert": "true"}
    )


def _own_assessment_id(ctx: dict) -> str:
    """Resolve the caller's own round first — never trust a row id alone.

    ensure_round is convergent and cheap to call per-request (see
    air_query's module docstring), so re-resolving here on every
    delete/signed-url call is safe and keeps ownership structural rather
    than trusting the path-supplied row id.
    """
    rnd = aq.ensure_round(ctx["application_id"], _label())
    return rnd["id"]


def _owned_evidence_or_404(sb, row_id: str, assessment_id: str) -> dict:
    rows = (
        sb.table("vip_air_evidence").select("*").eq("id", row_id)
        .eq("assessment_id", assessment_id).limit(1).execute().data or []
    )
    if not rows:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND,
                            detail={"code": "not_found"})
    return rows[0]


@router.post("/evidence")
async def upload_evidence(
    ctx: Annotated[dict, Depends(require_vip)],
    file: UploadFile = File(...),
    lever: str = Form(...),
    air_level: int = Form(...),
) -> dict:
    # Reject before anything is written to storage or the table.
    if lever not in cat.LEVER_KEYS:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND,
                            detail={"code": "unknown_lever"})
    if not 1 <= air_level <= 9:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "invalid_level"},
        )
    # Stamped from the catalog, not taken from the request — the row
    # records what the framework required, not what the uploader claimed.
    doc_label = cat.required_document(lever, air_level)
    if doc_label is None:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "no_document_required"},
        )

    label = _label()
    rnd = aq.ensure_round(ctx["application_id"], label)

    data = await file.read()
    filename = file.filename or "evidence"
    # air/{application_id}/{lever}/{air_level}/{filename} — application id
    # keeps ventures from colliding, lever+level keep re-uploads for
    # different claims from colliding with each other.
    storage_path = f"air/{ctx['application_id']}/{lever}/{air_level}/{filename}"
    _upload(storage_path, data, file.content_type or "application/octet-stream")

    get_admin_client().table("vip_air_evidence").insert({
        "assessment_id": rnd["id"],
        "lever": lever,
        "air_level": air_level,
        "doc_label": doc_label,
        "storage_path": storage_path,
        "filename": filename,
        "size_bytes": len(data),
        "content_type": file.content_type,
    }).execute()

    return aq.assessment_bundle(ctx["application_id"], label)


@router.delete("/evidence/{row_id}", status_code=http_status.HTTP_204_NO_CONTENT, response_model=None)
async def delete_evidence(row_id: str, ctx: Annotated[dict, Depends(require_vip)]) -> None:
    sb = get_admin_client()
    row = _owned_evidence_or_404(sb, row_id, _own_assessment_id(ctx))
    sb.table("vip_air_evidence").delete().eq("id", row_id).execute()
    with contextlib.suppress(Exception):
        sb.storage.from_(BUCKET).remove([row["storage_path"]])


@router.get("/evidence/{row_id}/signed-url")
async def evidence_signed_url(row_id: str, ctx: Annotated[dict, Depends(require_vip)]) -> dict:
    sb = get_admin_client()
    row = _owned_evidence_or_404(sb, row_id, _own_assessment_id(ctx))
    signed = sb.storage.from_(BUCKET).create_signed_url(row["storage_path"], 300)
    url = signed.get("signedURL") or signed.get("signedUrl") or signed.get("url") \
        if isinstance(signed, dict) else signed
    return {"url": url}
