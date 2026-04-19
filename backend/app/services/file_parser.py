"""Resume text extraction.

Given raw upload bytes + MIME type, return plain UTF-8 text suitable for
feeding to the LLM. Truncation is enforced here so we never ship more than
~15k chars to OpenRouter — Gemini Flash is cheap but unbounded input blows
the latency budget.

Supported:
  - application/pdf                                           (pypdf)
  - application/vnd.openxmlformats-officedocument.wordprocessingml.document
                                                              (python-docx)

Explicitly unsupported:
  - application/msword (legacy .doc) — requires antiword/textract, not worth
    the binary dep at our scale.
"""

from __future__ import annotations

import io

from docx import Document
from pypdf import PdfReader

PDF_MIME = "application/pdf"
DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
DOC_MIME = "application/msword"


class UnsupportedFileType(ValueError):
    """Raised when the uploaded file's MIME type has no text extractor."""


def _extract_pdf(file_bytes: bytes) -> str:
    reader = PdfReader(io.BytesIO(file_bytes))
    pages = []
    for page in reader.pages:
        text = page.extract_text() or ""
        if text.strip():
            pages.append(text)
    return "\n".join(pages)


def _extract_docx(file_bytes: bytes) -> str:
    doc = Document(io.BytesIO(file_bytes))
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())


def extract_text(file_bytes: bytes, mime_type: str, max_chars: int = 15000) -> str:
    if not file_bytes:
        raise ValueError("file is empty")

    mime = (mime_type or "").lower().strip()
    try:
        if mime == PDF_MIME:
            text = _extract_pdf(file_bytes)
        elif mime == DOCX_MIME:
            text = _extract_docx(file_bytes)
        elif mime == DOC_MIME:
            raise UnsupportedFileType(
                "Legacy .doc files are not supported — please save as .docx or PDF."
            )
        else:
            raise UnsupportedFileType(f"MIME type {mime!r} is not supported.")
    except UnsupportedFileType:
        raise
    except Exception as exc:
        raise ValueError(f"could not extract text: {exc}") from exc

    text = text.strip()
    if not text:
        raise ValueError("no text could be extracted from the file")

    if len(text) > max_chars:
        text = text[:max_chars].rstrip() + "\n[TRUNCATED]"
    return text
