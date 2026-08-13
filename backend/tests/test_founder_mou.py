"""MOU signing: PDF generation + ordered sign (PDF before status flip)."""
from __future__ import annotations

import base64

import pytest

from app.services import founder_mou


# a 1x1 transparent PNG
_PNG = "data:image/png;base64," + base64.b64encode(
    base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
    )
).decode()


def test_render_signed_pdf_returns_pdf_bytes():
    pdf = founder_mou.render_signed_pdf(
        founder_name="Priya Ramachandran", venture="Neonatal sepsis monitor",
        signer_name="Priya Ramachandran", date_str="2026-07-17", signature_png=_PNG,
    )
    assert pdf[:5] == b"%PDF-", "output must be a PDF"
    assert len(pdf) > 500


def test_decode_signature_png_strips_data_url():
    raw = founder_mou.decode_signature_png(_PNG)
    assert raw[:8] == b"\x89PNG\r\n\x1a\n"


def test_decode_signature_png_rejects_non_png():
    with pytest.raises(ValueError):
        founder_mou.decode_signature_png("data:image/gif;base64,AAAA")


def test_decode_signature_png_accepts_uppercase_mime():
    upper = _PNG.replace("image/png", "image/PNG")
    raw = founder_mou.decode_signature_png(upper)
    assert raw[:8] == b"\x89PNG\r\n\x1a\n"
