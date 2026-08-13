"""Residency journey endpoints: the Approach 6-step wizard's experiments +
workplan + mentor review, the mentor pod, the residency dashboard rollup,
and the BOM/equipment -> procurement sync.

Same ownership model as founder.py: every route depends on
require_founder_access (caller owns an offered/onboarded TIR application);
all reads/writes are scoped to that application_id via the service-role
client, which the router enforces (not RLS).
"""
from __future__ import annotations

import logging
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status

from .founder import _project_name, require_founder_access
from ..models.founder_journey import (
    ExperimentIn,
    ExperimentPatch,
    ReviewSubmitIn,
    TaskIn,
    TaskPatch,
)
from ..services import founder_journey_query as fjq
from ..services import founder_query as fq
from ..services.founder_mentors import MENTORS
from ..supabase_client import get_admin_client

log = logging.getLogger(__name__)

router = APIRouter(prefix="/founder", tags=["founder-journey"])

# The mentor pod's primary mentor + her review quote when a plan is
# advanced to 'approved'. Transcribed verbatim from the Review step
# (TIR Onboarding.dc.html, isApproved block) — the mockup shows this after a
# simulated ~2.6s "Awaiting mentor review" wait; here the frontend calls
# /review/advance after that same delay.
_APPROVED_BY = "Dr. Anitha Krishnan"
_MENTOR_QUOTE = (
    "Strong prioritisation — the shadow deployment is the right first bet. "
    "Tighten the success metric on EXP 02 to a single AUROC threshold and "
    "you're clear to run. Budget looks reasonable. Kicking off the clock."
)


def _owned_or_404(sb, table: str, row_id: str, application_id: str) -> dict:
    rows = (
        sb.table(table).select("*").eq("id", row_id)
        .eq("application_id", application_id).limit(1).execute().data or []
    )
    if not rows:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND,
                            detail={"code": "not_found"})
    return rows[0]


# ── Experiments (Approach step 2) ──────────────────────────────────────────
@router.get("/experiments")
async def list_experiments(ctx: Annotated[dict, Depends(require_founder_access)]) -> list[dict]:
    return fjq.fetch_experiments(ctx["application_id"])


@router.post("/experiments")
async def add_experiment(body: ExperimentIn,
                         ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    sb = get_admin_client()
    application_id = ctx["application_id"]
    existing = fjq.fetch_experiments(application_id)
    row = {
        **body.model_dump(),
        "application_id": application_id,
        "sort_order": body.sort_order or len(existing),
    }
    return sb.table("founder_experiments").insert(row).execute().data[0]


@router.patch("/experiments/{row_id}")
async def edit_experiment(row_id: str, body: ExperimentPatch,
                          ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    sb = get_admin_client()
    _owned_or_404(sb, "founder_experiments", row_id, ctx["application_id"])
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    return sb.table("founder_experiments").update(patch).eq("id", row_id).execute().data[0]


@router.delete("/experiments/{row_id}", status_code=http_status.HTTP_204_NO_CONTENT, response_model=None)
async def del_experiment(row_id: str, ctx: Annotated[dict, Depends(require_founder_access)]) -> None:
    sb = get_admin_client()
    _owned_or_404(sb, "founder_experiments", row_id, ctx["application_id"])
    sb.table("founder_experiments").delete().eq("id", row_id).execute()


# ── Tasks (Approach step 3 · Workplan) ─────────────────────────────────────
@router.get("/tasks")
async def list_tasks(ctx: Annotated[dict, Depends(require_founder_access)]) -> list[dict]:
    return fjq.fetch_tasks(ctx["application_id"])


@router.post("/tasks")
async def add_task(body: TaskIn, ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    sb = get_admin_client()
    application_id = ctx["application_id"]
    existing = fjq.fetch_tasks(application_id)
    row = {
        **body.model_dump(),
        "application_id": application_id,
        "sort_order": body.sort_order or len(existing),
    }
    return sb.table("founder_tasks").insert(row).execute().data[0]


@router.patch("/tasks/{row_id}")
async def edit_task(row_id: str, body: TaskPatch,
                    ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    sb = get_admin_client()
    _owned_or_404(sb, "founder_tasks", row_id, ctx["application_id"])
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    return sb.table("founder_tasks").update(patch).eq("id", row_id).execute().data[0]


@router.delete("/tasks/{row_id}", status_code=http_status.HTTP_204_NO_CONTENT, response_model=None)
async def del_task(row_id: str, ctx: Annotated[dict, Depends(require_founder_access)]) -> None:
    sb = get_admin_client()
    _owned_or_404(sb, "founder_tasks", row_id, ctx["application_id"])
    sb.table("founder_tasks").delete().eq("id", row_id).execute()


# ── Mentor review (Approach step 5) ────────────────────────────────────────
@router.get("/review")
async def get_review(ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    return fjq.fetch_review(ctx["application_id"])


@router.post("/review/submit")
async def submit_review(ctx: Annotated[dict, Depends(require_founder_access)],
                        body: ReviewSubmitIn = ReviewSubmitIn()) -> dict:
    sb = get_admin_client()
    row = {
        "application_id": ctx["application_id"],
        "status": "pending",
        "approved_by": None,
        "approved_on": None,
        "mentor_comment": None,
    }
    return sb.table("founder_review").upsert(row, on_conflict="application_id").execute().data[0]


@router.post("/review/advance")
async def advance_review(ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    sb = get_admin_client()
    application_id = ctx["application_id"]
    current = fjq.fetch_review(application_id)
    if current.get("status") != "pending":
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail={"code": "review_not_pending"},
        )
    row = {
        "application_id": application_id,
        "status": "approved",
        "approved_by": _APPROVED_BY,
        "approved_on": date.today().strftime("%d %b %Y"),
        "mentor_comment": _MENTOR_QUOTE,
    }
    return sb.table("founder_review").upsert(row, on_conflict="application_id").execute().data[0]


# ── Mentor pod (Approach step 1) ───────────────────────────────────────────
@router.get("/mentors")
async def get_mentors(ctx: Annotated[dict, Depends(require_founder_access)]) -> list[dict]:
    return MENTORS


# ── Residency dashboard ─────────────────────────────────────────────────────
@router.get("/residency")
async def get_residency(ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    team = fq.fetch_team(ctx["application_id"])
    team_names = [t["name"] for t in team if t.get("name")]
    return fjq.residency_bundle(ctx["application_id"], _project_name(ctx["app"]), team_names)


# ── Procurement sync (Expense tab "Sync from BOM & equipment") ─────────────
@router.post("/procurement/sync")
async def sync_procurement(ctx: Annotated[dict, Depends(require_founder_access)]) -> list[dict]:
    return fjq.sync_procurement(ctx["application_id"])
