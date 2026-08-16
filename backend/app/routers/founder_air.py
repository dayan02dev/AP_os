"""ARTPARK Innovation Readiness (AIR) assessment — VIP only.

Gate: require_founder_access resolves the caller's own application, then this
router rejects any non-VIP track. Ownership is therefore structural — a founder
can only ever address their own round, because the application id comes from
the gate rather than from the request.
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status

from ..models.air import LeverAnswersIn
from ..services import air_catalog as cat
from ..services import air_query as aq
from ..services import air_scoring as sc
from ..supabase_client import get_admin_client
from .founder import require_founder_access

router = APIRouter(prefix="/founder/air", tags=["founder-air"])


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
