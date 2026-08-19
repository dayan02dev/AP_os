"""TIR post-onboarding Founder Portal endpoints (Wave 1).

Gate: the caller must own a TIR application whose status is 'offered' or
'onboarded'. Access is by ownership, not RBAC role — this is the applicant's
own data. All reads/writes go through the service-role admin client; the
router enforces application_id ↔ user_id ownership.
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi import status as http_status

from ..config import RESOURCE_ITEMS, settings
from ..deps import get_current_user
from ..models.founder import (
    ApproachIn,
    BomItemIn,
    BomItemPatch,
    EquipmentItemIn,
    EquipmentItemPatch,
    MouPreviewPdfRequest,
    MouPreviewRequest,
    MouSignRequest,
    ProcurementItemIn,
    ProcurementItemPatch,
    TeamMemberIn,
    TeamMemberPatch,
)
from ..services import agreements, founder_mou, founder_query
from ..supabase_client import get_admin_client

log = logging.getLogger(__name__)

router = APIRouter(prefix="/founder", tags=["founder"])

_ACCESS_STATUSES = ("offered", "onboarded")


class FounderContext(dict):
    """{'user_id', 'application_id', 'status', 'app'} — the caller's onboarded TIR app."""


async def require_founder_access(
    user: Annotated[dict, Depends(get_current_user)],
) -> FounderContext:
    """Resolve the caller's most-recent offered/onboarded TIR application.

    Two independent gates, both of which must pass:

      1. Soft-launch allow-list. While FOUNDER_PORTAL_ALLOWLIST is non-empty,
         only the listed emails may open the portal — even if an admin
         advances someone else's application to 'offered'. Clearing the env
         var opens the portal to every offered/onboarded founder, which is the
         intended end state; we keep it set during the soft launch.
      2. Ownership + status: the caller must own a TIR application whose
         status is 'offered' or 'onboarded'.

    403 founder_access_denied on either failure. The two cases return the same
    code deliberately — a non-allow-listed founder shouldn't be able to tell
    the portal exists.
    """
    if not settings.founder_portal_allows(user.get("email")):
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail={"code": "founder_access_denied"},
        )
    sb = get_admin_client()
    rows = (
        sb.table("tir_applications")
        .select("id,status,grant_amount,submitted_at")
        .eq("user_id", user["user_id"])
        .in_("status", list(_ACCESS_STATUSES))
        .order("submitted_at", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail={"code": "founder_access_denied"},
        )
    app = rows[0]
    return FounderContext(
        user_id=user["user_id"],
        application_id=app["id"],
        status=app["status"],
        app=app,
    )


def _project_name(app: dict) -> str:
    emb = app.get("ai_screening_project_name")
    if isinstance(emb, list) and emb:
        return emb[0].get("project_name") or ""
    if isinstance(emb, dict):
        return emb.get("project_name") or ""
    return ""


@router.get("/me")
async def get_me(ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    mou = founder_query.fetch_mou(ctx["application_id"])
    signed = mou is not None
    return {
        "status": ctx["status"],
        "application_id": ctx["application_id"],
        "grant_amount": float(ctx["app"].get("grant_amount") or 0),
        "project_name": _project_name(ctx["app"]),
        "mou_signed": signed,
        "locked": {
            "cohort": ctx["status"] != "onboarded",
            "dashboard": ctx["status"] != "onboarded",
        },
        "resources_available": {
            item: settings.resource_available(item) for item in RESOURCE_ITEMS
        },
    }


@router.get("/mou")
async def get_mou(ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    mou = founder_query.fetch_mou(ctx["application_id"])
    # Report the SIGNED ROW's own recorded version — never the current
    # constant. Bug fixed here: this used to always return
    # founder_mou.TEMPLATE_VERSION (whatever the code constant currently
    # says), so the one pre-existing tir-mou-v2 row would have silently
    # relabelled itself the instant this shipped. A row that HAS signed
    # keeps reporting exactly what it recorded at signing time, forever;
    # only when nothing has been signed yet do we show what's currently on
    # offer (current_template_version()), which is informational, not a
    # record of anything having happened.
    version = (mou or {}).get("template_version") or founder_mou.current_template_version()

    # A signature made before the agreements changed records slugs that no
    # longer appear in this track's list. Without saying so, the UI showed
    # "Agreements signed" above a row per document reading "Not part of what
    # you signed" — both statements true, together nonsense, and exactly the
    # one-message-two-causes shape this codebase keeps shipping. Name the
    # cause here rather than leaving the frontend to infer it from a pile of
    # per-document failures.
    signature_is_legacy = bool(mou) and agreements.is_legacy_signature(
        (mou or {}).get("template_version"), founder_mou.FOUNDER_TRACK
    )

    return {
        "template_version": version,
        # True when the founder HAS signed, but under a version predating
        # every agreement now on offer — so none of the current documents is
        # retrievable for them. Distinct from "not signed" and from "signed,
        # documents available".
        "signature_is_legacy": signature_is_legacy,
        # Same catalog pattern as the AIR surface: the field schema for
        # every agreement this track requires comes from the backend, so a
        # wording change needs no frontend deploy. An agreement absent from
        # this list (e.g. a track with none configured) renders no card at
        # all on the frontend — there is nothing here to mislabel.
        "agreements": agreements.agreements_for_track(founder_mou.FOUNDER_TRACK),
        "signed": mou is not None,
        "signed_at": (mou or {}).get("signed_at"),
        "signer_name": (mou or {}).get("signer_name"),
        # Server-owned checklist — the browser renders exactly what we send
        # here rather than holding its own copy of the wording.
        "acknowledgements": founder_mou.ACKNOWLEDGEMENTS,
        "accepted_acknowledgements": (mou or {}).get("acknowledgements") or [],
    }


def _signer_default(ctx: dict) -> str:
    # best-effort: profile full_name; falls back to empty (FE prefills).
    # No longer called from get_mou (the free-text `body` it used to prefill
    # is gone — the Facility/Collaboration Agreements substitute real
    # collaborator details instead), kept importable as a signer-name
    # prefill helper for the sign wizard.
    rows = (
        get_admin_client().table("profiles").select("full_name")
        .eq("id", ctx["user_id"]).limit(1).execute().data or []
    )
    return (rows[0].get("full_name") if rows else "") or ""


@router.post("/mou/preview")
async def preview_mou(
    payload: MouPreviewRequest,
    ctx: Annotated[dict, Depends(require_founder_access)],
) -> dict:
    """Render every agreement the founder's track requires from ONE set of
    1-3 collaborator details — never persisted, purely a read: the founder
    reviews this before signing. Shares agreements._resolve_blocks with the
    signed PDF (via render_preview_text/render_agreement_pdf) so preview
    and signed document can never diverge."""
    collaborators = [c.model_dump() for c in payload.collaborators]
    try:
        previews = [
            {
                "slug": meta["slug"],
                "name": meta["name"],
                "rendered_text": agreements.render_preview_text(collaborators, slug=meta["slug"]),
            }
            for meta in agreements.agreements_for_track(founder_mou.FOUNDER_TRACK)
        ]
    except ValueError as exc:
        # Defense in depth: the pydantic bound above already enforces 1-3
        # collaborators, but agreements.py has its own independent check —
        # if that ever disagrees with this model, fail as a normal 422
        # rather than an unhandled 500.
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "invalid_collaborators", "message": str(exc)},
        ) from exc
    return {"previews": previews}


@router.post("/mou/preview/pdf")
async def preview_mou_pdf(
    slug: str,
    payload: MouPreviewPdfRequest,
    ctx: Annotated[dict, Depends(require_founder_access)],
) -> Response:
    """The embedded document itself -- real PDF bytes for ONE agreement,
    built live from whatever the founder has typed (and, once they've
    reached the Sign step, whatever they've drawn) so far. This is what the
    frontend fetches as a blob and shows in an <iframe> on the Review and
    Sign steps -- never persisted, purely a read, called again on every
    debounced edit. Shares render_agreement_pdf with the signed path
    (agreements.py), so the preview can never diverge from what actually
    gets signed; the only difference is signature_png being absent (blank
    ruled line) until the founder has actually drawn one.
    """
    valid_slugs = {a["slug"] for a in agreements.agreements_for_track(founder_mou.FOUNDER_TRACK)}
    if slug not in valid_slugs:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail={"code": "unknown_agreement", "agreement": slug},
        )
    # Validated (and its own distinct error code) BEFORE the render call --
    # render_agreement_pdf's own ValueError catch below is for a
    # collaborator/template defect, not a malformed signature; decoding
    # here first keeps the two failure modes from being conflated into the
    # wrong code (see mouErrorCopy in FounderMou.jsx, which renders each
    # differently).
    if payload.signature_png:
        try:
            founder_mou.decode_signature_png(payload.signature_png)
        except ValueError as exc:
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"code": "invalid_signature", "message": str(exc)},
            ) from exc
    collaborators = [c.model_dump() for c in payload.collaborators]
    try:
        pdf = agreements.render_agreement_pdf(
            collaborators=collaborators,
            signer_name=payload.signer_name,
            date_str=datetime.now(UTC).strftime("%d %b %Y"),
            signature_png=payload.signature_png,
            accepted_acks=None,
            slug=slug,
            venture_name=payload.venture_name,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "invalid_collaborators", "message": str(exc)},
        ) from exc
    return Response(content=pdf, media_type="application/pdf")


@router.post("/mou/sign")
async def sign_mou(
    payload: MouSignRequest,
    ctx: Annotated[dict, Depends(require_founder_access)],
) -> dict:
    try:
        row = founder_mou.sign_and_onboard(
            application_id=ctx["application_id"],
            user_id=ctx["user_id"],
            signer_name=payload.signer_name,
            signature_png=payload.signature_png,
            collaborators=[c.model_dump() for c in payload.collaborators],
            acknowledgements=payload.acknowledgements,
            venture_name=payload.venture_name,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "invalid_signature", "message": str(exc)},
        ) from exc
    return {"signed": True, "signed_at": row["signed_at"], "status": "onboarded"}


@router.get("/mou/signed-url")
async def mou_signed_url(
    ctx: Annotated[dict, Depends(require_founder_access)],
    agreement: str | None = None,
) -> dict:
    """Download URL for a signed MOU document. `agreement` (optional,
    query param) selects which one — omitted (or the frontend's own default
    choice) gets the primary document, same shape as before this task;
    passing a specific slug (e.g. "collaboration-v1") gets that agreement's
    own PDF. This is how every agreement the track required becomes
    individually retrievable after signing."""
    valid_slugs = {a["slug"] for a in agreements.agreements_for_track(founder_mou.FOUNDER_TRACK)}
    if agreement is not None and agreement not in valid_slugs:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail={"code": "unknown_agreement", "agreement": agreement},
        )
    # Two distinct empty states, two distinct codes: nothing signed at all
    # (no row) vs. this particular agreement wasn't part of what was signed
    # (a row exists — e.g. the legacy tir-mou-v2 row, or a future track
    # whose required agreements changed — but never produced this slug's
    # PDF). Collapsing these into one 404 is exactly the kind of ambiguity
    # this project has shipped as a bug before.
    mou = founder_query.fetch_mou(ctx["application_id"])
    if mou is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail={"code": "mou_not_signed"},
        )
    if agreement is not None and agreement not in founder_mou.signed_agreement_slugs(mou):
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail={"code": "agreement_not_signed", "agreement": agreement},
        )
    url = founder_mou.signed_pdf_url(ctx["application_id"], agreement=agreement)
    if not url:
        # Data anomaly (a row with no path recorded) rather than a normal
        # not-yet-signed state — still surfaced as mou_not_signed since
        # there is, functionally, nothing to download.
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail={"code": "mou_not_signed"},
        )
    return {"url": url}


_DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


@router.get("/mou/source")
async def mou_source_docx(
    ctx: Annotated[dict, Depends(require_founder_access)],
    agreement: str,
) -> Response:
    """The ORIGINAL committed .docx for one of this track's agreements —
    exactly what was legally verified, served verbatim (never converted or
    regenerated) so a founder can read the source document itself, not just
    the rendered PDF. Same auth as every other /founder/mou* route.
    `agreement` is required — there is no meaningful "default" original
    document the way signed-url has a primary signed one."""
    valid_slugs = {a["slug"] for a in agreements.agreements_for_track(founder_mou.FOUNDER_TRACK)}
    if agreement not in valid_slugs:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail={"code": "unknown_agreement", "agreement": agreement},
        )
    path = agreements.source_docx_path(agreement)
    return Response(
        content=path.read_bytes(),
        media_type=_DOCX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{path.name}"'},
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


# ── Organization / team ───────────────────────────────────────────────────
@router.get("/team")
async def list_team(ctx: Annotated[dict, Depends(require_founder_access)]) -> list[dict]:
    return founder_query.fetch_team(ctx["application_id"])


@router.post("/team")
async def add_team(body: TeamMemberIn, ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    sb = get_admin_client()
    row = {**body.model_dump(), "application_id": ctx["application_id"]}
    return sb.table("founder_team_members").insert(row).execute().data[0]


@router.patch("/team/{row_id}")
async def edit_team(row_id: str, body: TeamMemberPatch,
                    ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    sb = get_admin_client()
    _owned_or_404(sb, "founder_team_members", row_id, ctx["application_id"])
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    return sb.table("founder_team_members").update(patch).eq("id", row_id).execute().data[0]


@router.delete("/team/{row_id}", status_code=http_status.HTTP_204_NO_CONTENT, response_model=None)
async def del_team(row_id: str, ctx: Annotated[dict, Depends(require_founder_access)]) -> None:
    sb = get_admin_client()
    _owned_or_404(sb, "founder_team_members", row_id, ctx["application_id"])
    sb.table("founder_team_members").delete().eq("id", row_id).execute()


# ── Approach (hats) — single upsert row ───────────────────────────────────
@router.get("/approach")
async def get_approach(ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    return founder_query.fetch_approach(ctx["application_id"])


@router.put("/approach")
async def put_approach(body: ApproachIn, ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    sb = get_admin_client()
    row = {**body.model_dump(), "application_id": ctx["application_id"]}
    return sb.table("founder_approach").upsert(row, on_conflict="application_id").execute().data[0]


# ── BOM ───────────────────────────────────────────────────────────────────
@router.post("/bom")
async def add_bom(body: BomItemIn, ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    sb = get_admin_client()
    return sb.table("founder_bom_items").insert(
        {**body.model_dump(), "application_id": ctx["application_id"]}).execute().data[0]


@router.patch("/bom/{row_id}")
async def edit_bom(row_id: str, body: BomItemPatch,
                   ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    sb = get_admin_client()
    _owned_or_404(sb, "founder_bom_items", row_id, ctx["application_id"])
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    return sb.table("founder_bom_items").update(patch).eq("id", row_id).execute().data[0]


@router.delete("/bom/{row_id}", status_code=http_status.HTTP_204_NO_CONTENT, response_model=None)
async def del_bom(row_id: str, ctx: Annotated[dict, Depends(require_founder_access)]) -> None:
    sb = get_admin_client()
    _owned_or_404(sb, "founder_bom_items", row_id, ctx["application_id"])
    sb.table("founder_bom_items").delete().eq("id", row_id).execute()


# ── Equipment ─────────────────────────────────────────────────────────────
@router.post("/equipment")
async def add_equipment(body: EquipmentItemIn, ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    sb = get_admin_client()
    return sb.table("founder_equipment_items").insert(
        {**body.model_dump(), "application_id": ctx["application_id"]}).execute().data[0]


@router.patch("/equipment/{row_id}")
async def edit_equipment(row_id: str, body: EquipmentItemPatch,
                         ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    sb = get_admin_client()
    _owned_or_404(sb, "founder_equipment_items", row_id, ctx["application_id"])
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    return sb.table("founder_equipment_items").update(patch).eq("id", row_id).execute().data[0]


@router.delete("/equipment/{row_id}", status_code=http_status.HTTP_204_NO_CONTENT, response_model=None)
async def del_equipment(row_id: str, ctx: Annotated[dict, Depends(require_founder_access)]) -> None:
    sb = get_admin_client()
    _owned_or_404(sb, "founder_equipment_items", row_id, ctx["application_id"])
    sb.table("founder_equipment_items").delete().eq("id", row_id).execute()


# ── Procurement ───────────────────────────────────────────────────────────
@router.post("/procurement")
async def add_proc(body: ProcurementItemIn, ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    sb = get_admin_client()
    return sb.table("founder_procurement_items").insert(
        {**body.model_dump(), "application_id": ctx["application_id"]}).execute().data[0]


@router.patch("/procurement/{row_id}")
async def edit_proc(row_id: str, body: ProcurementItemPatch,
                    ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    sb = get_admin_client()
    _owned_or_404(sb, "founder_procurement_items", row_id, ctx["application_id"])
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    return sb.table("founder_procurement_items").update(patch).eq("id", row_id).execute().data[0]


@router.delete("/procurement/{row_id}", status_code=http_status.HTTP_204_NO_CONTENT, response_model=None)
async def del_proc(row_id: str, ctx: Annotated[dict, Depends(require_founder_access)]) -> None:
    sb = get_admin_client()
    _owned_or_404(sb, "founder_procurement_items", row_id, ctx["application_id"])
    sb.table("founder_procurement_items").delete().eq("id", row_id).execute()


@router.get("/expense")
async def get_expense(ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    return founder_query.expense_bundle(
        ctx["application_id"], float(ctx["app"].get("grant_amount") or 0)
    )


@router.get("/dashboard")
async def get_dashboard(ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    mou_signed = founder_query.fetch_mou(ctx["application_id"]) is not None
    return founder_query.dashboard_bundle(
        ctx["application_id"], ctx["status"],
        float(ctx["app"].get("grant_amount") or 0), mou_signed,
    )
