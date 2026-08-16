"""Admin "VIP cohort" verification surface (spec §7).

Two screens' worth of endpoints under `/admin/platform/vip`: the AIR
verification queue (list -> per-round detail -> per-lever verify / bulk
confirm-all) and the MIS submissions matrix (list -> per-period read-only
render -> reopen). All business logic lives in
`services.admin_vip_query`; this router is authorisation + thin dispatch,
matching `admin_platform.py`'s own shape.

Authorisation split (spec §7): every READ is gated by the existing
`view_all_apps` capability — the same one `admin_platform.py`'s pipeline
reads already use; every WRITE (verify, confirm-all, reopen) is gated by
the new `manage_vip_cohort` capability, granted only to `admin` +
`leadership` in both `rbac.py` and `frontend/src/lib/rbac.js` — those two
files are hand-synced and must change together (this repo's own core
domain invariant).
"""
from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from ..deps import get_current_user
from ..rbac import require_capability
from ..services import admin_vip_query as vq
from ..services.audit import actor_role_of

router = APIRouter(prefix="/admin/platform/vip", tags=["admin-vip"])


# ── AIR verification queue ───────────────────────────────────────────────

@router.get("/air/queue", dependencies=[Depends(require_capability("view_all_apps"))])
async def get_air_queue() -> dict[str, Any]:
    """Every lever still awaiting verification, across every submitted VIP
    AIR round: rows of (startup, lever, claimed level, submitted-at)."""
    return vq.fetch_air_queue()


@router.get(
    "/air/assessments/{assessment_id}",
    dependencies=[Depends(require_capability("view_all_apps"))],
)
async def get_air_assessment(assessment_id: str) -> dict[str, Any]:
    """One round's three answers per lever, ticked criteria, and evidence
    behind a signed URL (spec §7: "opening a lever")."""
    return vq.fetch_assessment_detail(assessment_id)


class VerifyLeverBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    verified_level: int = Field(..., ge=1, le=9)
    verifier_note: str | None = Field(default=None, max_length=2000)


@router.post(
    "/air/assessments/{assessment_id}/levers/{lever}/verify",
    dependencies=[Depends(require_capability("manage_vip_cohort"))],
)
async def verify_lever(
    assessment_id: str, lever: str, body: VerifyLeverBody,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Confirm a lever at its claimed level, or downgrade it with a note."""
    return vq.verify_lever(
        assessment_id=assessment_id, lever=lever,
        verified_level=body.verified_level, verifier_note=body.verifier_note,
        actor_user_id=user["user_id"], actor_role=actor_role_of(user),
    )


@router.post(
    "/air/assessments/{assessment_id}/confirm-all",
    dependencies=[Depends(require_capability("manage_vip_cohort"))],
)
async def confirm_all_levers(
    assessment_id: str, user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Confirm every lever of an assessment at its own claimed level — the
    common case (spec §7)."""
    return vq.confirm_all_at_claimed(
        assessment_id=assessment_id,
        actor_user_id=user["user_id"], actor_role=actor_role_of(user),
    )


# ── MIS submissions ──────────────────────────────────────────────────────

@router.get("/mis/matrix", dependencies=[Depends(require_capability("view_all_apps"))])
async def get_mis_matrix(kind: Literal["monthly", "quarterly"]) -> dict[str, Any]:
    """Startups × periods with status, for one calendar kind at a time."""
    return vq.fetch_mis_matrix(kind)


@router.get(
    "/mis/{application_id}/{kind}/{period_key}",
    dependencies=[Depends(require_capability("view_all_apps"))],
)
async def get_mis_period(
    application_id: str, kind: Literal["monthly", "quarterly"], period_key: str,
) -> dict[str, Any]:
    """Read-only render of one period."""
    return vq.fetch_mis_period(application_id, kind, period_key)


@router.post(
    "/mis/{application_id}/{kind}/{period_key}/reopen",
    dependencies=[Depends(require_capability("manage_vip_cohort"))],
)
async def reopen_mis_period(
    application_id: str, kind: Literal["monthly", "quarterly"], period_key: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Return a submitted period to draft for correction."""
    return vq.reopen_period(
        application_id=application_id, kind=kind, period_key=period_key,
        actor_user_id=user["user_id"], actor_role=actor_role_of(user),
    )
