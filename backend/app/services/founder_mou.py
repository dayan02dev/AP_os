"""MOU signed-PDF generation + sign orchestration.

sign_and_onboard() ordering is deliberate: upload signature → generate + upload
the signed PDF → insert founder_mou → ONLY THEN flip status offered→onboarded.
A storage/PDF failure raises before the status changes, so there is never a
half-onboarded application.
"""
from __future__ import annotations

import base64
import io
import logging
from datetime import UTC, datetime
from pathlib import Path

from fastapi import HTTPException
from fastapi import status as http_status

from ..supabase_client import get_admin_client
from . import state_machine

log = logging.getLogger(__name__)

BUCKET = "tir-founder-docs"
# Bumped from v1 when the four residency acknowledgements became a required
# part of signing. The version is stored on every founder_mou row, so rows
# signed under v1 remain identifiable as "signed without acknowledgements".
TEMPLATE_VERSION = "tir-mou-v2"
_TEMPLATE_PATH = Path(__file__).resolve().parent.parent / "templates" / "mou" / "tir_mou.txt"

# ── Residency acknowledgements ────────────────────────────────────────────
# The four points every TIR founder must tick before the MOU can be signed.
# This list is the SINGLE source of truth: the sign endpoint validates against
# it, GET /mou serves it to the browser (the frontend renders whatever the
# server sends rather than keeping its own copy), and render_signed_pdf()
# stamps the accepted text into the signed PDF so the document itself records
# exactly what was agreed. Adding an item here makes it immediately required.
ACKNOWLEDGEMENTS: list[dict[str, str]] = [
    {
        "id": "full_time_presence",
        "text": (
            "I acknowledge that ARTPARK Technology in Residence is a full time "
            "program requiring me to be full time present at ARTPARK campus "
            "unless agreed prior to application."
        ),
    },
    {
        "id": "first_right_of_refusal",
        "text": (
            "I acknowledge that ARTPARK Residency program provides ARTPARK the "
            "first right of refusal to investment at incubation / first "
            "investment."
        ),
    },
    {
        "id": "expense_account_procurement",
        "text": (
            "I acknowledge that ARTPARK Residency program is an expense account "
            "requiring us to work with ARTPARK procurement team for expensing "
            "and managing it. At no point shall money be paid out to any "
            "accounts related to the company or any associated related parties."
        ),
    },
    {
        "id": "additional_funding_equity",
        "text": (
            "I acknowledge that post the initial 25L as part of the incubation "
            "support any additional funding required to complete the 6-month "
            "residency shall attract equity allocation to ARTPARK at the "
            "incubation stage as agreed upon in the onboarding agreement."
        ),
    },
]

REQUIRED_ACK_IDS: tuple[str, ...] = tuple(a["id"] for a in ACKNOWLEDGEMENTS)


def missing_acknowledgements(accepted: list[str] | None) -> list[str]:
    """Required ack ids the caller did NOT accept, in canonical order."""
    got = {str(a) for a in (accepted or [])}
    return [i for i in REQUIRED_ACK_IDS if i not in got]


def acknowledgement_text(ack_id: str) -> str:
    for a in ACKNOWLEDGEMENTS:
        if a["id"] == ack_id:
            return a["text"]
    return ack_id


def load_template() -> str:
    return _TEMPLATE_PATH.read_text(encoding="utf-8")


def render_body(founder_name: str, venture: str, date_str: str) -> str:
    return load_template().format(
        founder_name=founder_name or "", venture=venture or "", date=date_str or ""
    )


def decode_signature_png(data_url: str) -> bytes:
    """Accept a PNG data URL (or bare base64) and return raw PNG bytes."""
    payload = data_url
    if data_url.startswith("data:"):
        header, _, b64 = data_url.partition(",")
        if "image/png" not in header.lower():
            raise ValueError("signature must be a PNG data URL")
        payload = b64
    raw = base64.b64decode(payload)
    if raw[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("decoded signature is not a PNG")
    return raw


def render_signed_pdf(
    *, founder_name: str, venture: str, signer_name: str, date_str: str, signature_png: str,
    accepted_acks: list[str] | None = None,
) -> bytes:
    """Compose the MOU text + embedded signature image into a PDF (reportlab)."""
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfgen import canvas

    raw_png = decode_signature_png(signature_png)
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    width, height = A4
    x = 20 * mm
    y = height - 25 * mm

    c.setFont("Helvetica-Bold", 13)
    for line in _wrap(render_body(founder_name, venture, date_str), 95):
        if y < 45 * mm:
            c.showPage()
            y = height - 25 * mm
            c.setFont("Helvetica", 9.5)
        c.setFont("Helvetica-Bold", 13) if line.strip().startswith("MEMORANDUM") else c.setFont("Helvetica", 9.5)
        c.drawString(x, y, line)
        y -= 5.4 * mm

    # acknowledgements — stamped into the document so the signed PDF records
    # exactly which points were accepted, not just that some were.
    if accepted_acks:
        y -= 4 * mm
        if y < 70 * mm:
            c.showPage()
            y = height - 25 * mm
        c.setFont("Helvetica-Bold", 9.5)
        c.drawString(x, y, "Acknowledged by the Innovator:")
        y -= 6 * mm
        c.setFont("Helvetica", 8.5)
        for ack_id in accepted_acks:
            for i, line in enumerate(_wrap(acknowledgement_text(ack_id), 100)):
                if y < 45 * mm:
                    c.showPage()
                    y = height - 25 * mm
                    c.setFont("Helvetica", 8.5)
                c.drawString(x + (0 if i else 0) + 4 * mm, y, ("[x] " if i == 0 else "    ") + line)
                y -= 4.6 * mm
            y -= 1.5 * mm

    # signature image
    y -= 6 * mm
    c.setFont("Helvetica", 8)
    c.drawString(x, y, "Signature:")
    try:
        img = ImageReader(io.BytesIO(raw_png))
        c.drawImage(img, x + 22 * mm, y - 14 * mm, width=55 * mm, height=18 * mm,
                    preserveAspectRatio=True, mask="auto")
    except Exception:  # noqa: BLE001 — never fail the PDF over an image glitch
        log.warning("mou: signature image draw failed", exc_info=True)
    c.showPage()
    c.save()
    return buf.getvalue()


def _wrap(text: str, width: int) -> list[str]:
    out: list[str] = []
    for para in text.splitlines():
        if not para.strip():
            out.append("")
            continue
        words, line = para.split(), ""
        for w in words:
            if len(line) + len(w) + 1 > width:
                out.append(line)
                line = w
            else:
                line = f"{line} {w}".strip()
        out.append(line)
    return out


def _upload(path: str, data: bytes, content_type: str) -> None:
    sb = get_admin_client()
    sb.storage.from_(BUCKET).upload(
        path, data, {"content-type": content_type, "upsert": "true"}
    )


def sign_and_onboard(*, application_id: str, user_id: str, track: str,
                     signer_name: str, founder_name: str, venture: str,
                     signature_png: str,
                     acknowledgements: list[str] | None = None) -> dict:
    """Idempotent MOU sign. Returns the founder_mou row. 409 if already signed.

    Every acknowledgement in ACKNOWLEDGEMENTS must be accepted — checked here
    (not only in the request model) so the rule holds for any future caller,
    and checked BEFORE the already-signed lookup would matter for writes.
    """
    missing = missing_acknowledgements(acknowledgements)
    if missing:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "acknowledgements_required", "missing": missing},
        )
    accepted = list(REQUIRED_ACK_IDS)

    sb = get_admin_client()
    existing = (
        sb.table("founder_mou").select("*")
        .eq("application_id", application_id).eq("track", track)
        .limit(1).execute().data or []
    )
    if existing:
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail={"code": "mou_already_signed"},
        )

    date_str = datetime.now(UTC).strftime("%d %b %Y")
    sig_path = f"{track}/{application_id}/mou/signature.png"
    pdf_path = f"{track}/{application_id}/mou/signed.pdf"

    # 1) storage FIRST (raises before any status change)
    _upload(sig_path, decode_signature_png(signature_png), "image/png")
    pdf = render_signed_pdf(
        founder_name=founder_name, venture=venture, signer_name=signer_name,
        date_str=date_str, signature_png=signature_png, accepted_acks=accepted,
    )
    _upload(pdf_path, pdf, "application/pdf")

    # 2) record
    row = {
        "application_id": application_id,
        "track": track,
        "signer_name": signer_name,
        "signed_at": datetime.now(UTC).isoformat(),
        "signature_image_path": sig_path,
        "signed_pdf_path": pdf_path,
        "template_version": TEMPLATE_VERSION,
        "acknowledgements": accepted,
    }
    try:
        sb.table("founder_mou").insert(row).execute()
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001 — unique-violation on concurrent double-submit
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail={"code": "mou_already_signed"},
        ) from exc

    # 3) flip status only if still 'offered' (idempotent for already-onboarded apps)
    table = "tir_applications" if track == "tir" else "sip_applications"
    current = (
        sb.table(table).select("status")
        .eq("id", application_id).limit(1).execute().data or []
    )
    if current and current[0].get("status") == "offered":
        state_machine.apply_status_change(
            application_id, track, to_status="onboarded",
            changed_by=user_id, reason="MOU signed",
        )
    return row


def signed_pdf_url(application_id: str, track: str) -> str | None:
    sb = get_admin_client()
    rows = (
        sb.table("founder_mou").select("signed_pdf_path")
        .eq("application_id", application_id).eq("track", track)
        .limit(1).execute().data or []
    )
    if not rows or not rows[0].get("signed_pdf_path"):
        return None
    signed = sb.storage.from_(BUCKET).create_signed_url(rows[0]["signed_pdf_path"], 300)
    if isinstance(signed, dict):
        return signed.get("signedURL") or signed.get("signedUrl") or signed.get("url")
    return signed
