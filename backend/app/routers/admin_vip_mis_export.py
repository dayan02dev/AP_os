"""`GET /admin/platform/vip/mis/export` — spec §5.7's xlsx/csv MIS report.

A separate router file, not `admin_vip.py`: that router (spec §7's
verification queue + submissions matrix) is being built in parallel by
another phase of this same effort and is off-limits here. FastAPI mounts
routers independently, and two routers sharing a path PREFIX is completely
ordinary as long as their own routes don't collide — `/mis/export` collides
with neither `admin_vip.py`'s `/mis/matrix` nor its
`/mis/{application_id}/{kind}/{period_key}` (a 3-segment path; `export` is
a single literal segment, never captured by that pattern).

Read-only, so gated by the existing `view_all_apps` capability — the same
split spec §7 itself draws ("reads = view_all_apps; writes =
manage_vip_cohort"). No new capability is needed, so `rbac.py`/
`frontend/src/lib/rbac.js` need no change for this endpoint.

All business logic lives in `services.mis_export` (sheet building +
rendering) and reuses `services.admin_vip_query.fetch_mis_period`/
`fetch_mis_matrix` for data access (themselves thin wrappers over
`mis_query.period_bundle`) — this router is authorisation + thin dispatch,
matching `admin_platform.py`/`admin_vip.py`'s own shape.
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from fastapi.responses import Response

from ..rbac import require_capability
from ..services import admin_vip_query as vq
from ..services import mis_export

router = APIRouter(prefix="/admin/platform/vip/mis", tags=["admin-vip"])

_XLSX_MEDIA = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_CSV_MEDIA = "text/csv"


@router.get("/export", dependencies=[Depends(require_capability("view_all_apps"))])
async def export_mis(
    kind: Literal["monthly", "quarterly"],
    period: str,
    scope: Literal["startup", "cohort"] = "startup",
    format: Literal["xlsx", "csv"] = "xlsx",
    application_id: str | None = None,
) -> Response:
    """`scope=startup` requires `application_id` (whose period must exist,
    else 404 — surfaced by `fetch_mis_period` itself, not re-derived here).
    `scope=cohort` reads `fetch_mis_matrix(kind)` to find every startup that
    actually has a `(kind, period)` row and builds one bundle per startup —
    never `ensure_periods`-creates one on an admin's behalf (same rule
    `fetch_mis_matrix` itself documents: an admin GET must never
    side-effect-create a founder's period)."""
    if scope == "startup":
        if not application_id:
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"code": "application_id_required"},
            )
        bundles = [vq.fetch_mis_period(application_id, kind, period)]
    else:
        matrix = vq.fetch_mis_matrix(kind)
        app_ids = [s["application_id"] for s in matrix["startups"] if period in s["periods"]]
        bundles = [vq.fetch_mis_period(aid, kind, period) for aid in app_ids]

    sheets = mis_export.build_sheets(kind=kind, scope=scope, bundles=bundles)
    filename = f"vip-mis-{kind}-{period}-{scope}.{format}"
    disposition = {"Content-Disposition": f'attachment; filename="{filename}"'}

    if format == "csv":
        return Response(content=mis_export.render_csv(sheets), media_type=_CSV_MEDIA, headers=disposition)
    return Response(content=mis_export.render_xlsx(sheets), media_type=_XLSX_MEDIA, headers=disposition)
