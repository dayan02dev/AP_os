"""Multi-format text extraction for VIP memo inputs. Never raises."""
from __future__ import annotations

import io
import logging
from dataclasses import dataclass

log = logging.getLogger(__name__)

# Priority order (highest first) and relative weights for budget_texts.
PRIORITY = ["deck", "template", "traction", "milestones", "cap_table", "patents", "cv"]
_WEIGHTS = {"deck": 4, "template": 3, "traction": 3, "milestones": 2, "cap_table": 2, "patents": 1, "cv": 1}

_SCANNED_PDF_CHARS_PER_PAGE = 200
_XLSX_MAX_ROWS = 200
_LEGACY = {"doc", "ppt", "xls"}


@dataclass
class Extracted:
    text: str
    method: str
    needs_transcription: bool = False
    skipped_reason: str | None = None


def _ext(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def _pdf(data: bytes) -> Extracted:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    pages = [(p.extract_text() or "") for p in reader.pages]
    text = "\n\n".join(pages).strip()
    total = sum(len(p.strip()) for p in pages)
    scanned = not pages or total / len(pages) < _SCANNED_PDF_CHARS_PER_PAGE
    return Extracted(text, "pypdf", needs_transcription=scanned)


def _docx(data: bytes) -> Extracted:
    import docx

    d = docx.Document(io.BytesIO(data))
    parts = [p.text for p in d.paragraphs if p.text.strip()]
    for table in d.tables:
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells]
            if any(cells):
                parts.append("\t".join(cells))
    return Extracted("\n".join(parts), "python-docx")


def _pptx(data: bytes) -> Extracted:
    from pptx import Presentation

    prs = Presentation(io.BytesIO(data))
    out: list[str] = []
    for i, slide in enumerate(prs.slides, start=1):
        lines: list[str] = []
        title = slide.shapes.title.text_frame.text.strip() if slide.shapes.title is not None else ""
        if title:
            lines.append(title)
        for shape in slide.shapes:
            if shape.has_text_frame and shape is not slide.shapes.title:
                t = shape.text_frame.text.strip()
                if t:
                    lines.append(t)
            elif getattr(shape, "has_table", False) and shape.has_table:
                for row in shape.table.rows:
                    lines.append("\t".join(c.text.strip() for c in row.cells))
        if slide.has_notes_slide:
            notes = slide.notes_slide.notes_text_frame.text.strip()
            if notes:
                lines.append(f"Notes: {notes}")
        out.append(f"Slide {i}: " + "\n".join(lines))
    return Extracted("\n\n".join(out), "python-pptx")


def _xlsx(data: bytes) -> Extracted:
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    try:
        parts: list[str] = []
        for ws in wb.worksheets:
            parts.append(f"Sheet: {ws.title}")
            for n, row in enumerate(ws.iter_rows(values_only=True)):
                if n >= _XLSX_MAX_ROWS:
                    break
                cells = ["" if v is None else str(v) for v in row]
                if any(c.strip() for c in cells):
                    parts.append("\t".join(cells))
    finally:
        wb.close()
    return Extracted("\n".join(parts), "openpyxl")


def extract_any(data: bytes, mime: str, filename: str) -> Extracted:
    ext = _ext(filename or "")
    mime = (mime or "").lower()
    try:
        if ext in _LEGACY:
            return Extracted("", "none", skipped_reason="unsupported_legacy_format")
        if ext == "pdf" or mime == "application/pdf":
            return _pdf(data)
        if ext == "docx" or mime.endswith("wordprocessingml.document"):
            return _docx(data)
        if ext == "pptx" or mime.endswith("presentationml.presentation"):
            return _pptx(data)
        if ext == "xlsx" or mime.endswith("spreadsheetml.sheet"):
            return _xlsx(data)
        if ext in ("csv", "txt") or mime in ("text/csv", "text/plain"):
            return Extracted(data.decode("utf-8", errors="replace"), "text")
        if ext in ("png", "jpg", "jpeg") or mime in ("image/png", "image/jpeg"):
            return Extracted("", "image", needs_transcription=True)
        return Extracted("", "none", skipped_reason="unsupported_type")
    except Exception:
        log.warning("vip_memo_gen extract failed", extra={"file_ext": ext}, exc_info=True)
        return Extracted("", "none", skipped_reason="extract_error")


def budget_texts(items, total_chars: int = 60000):
    """Allocate ``total_chars`` across files by priority; unused share rolls on.

    Returns ``[(ref, text, truncated)]`` in priority order.
    """
    def rank(kind: str) -> int:
        return PRIORITY.index(kind) if kind in PRIORITY else len(PRIORITY)

    ordered = sorted(items, key=lambda it: rank(it[0].kind))  # stable
    remaining = total_chars
    out = []
    for idx, (ref, text) in enumerate(ordered):
        weight = _WEIGHTS.get(ref.kind, 1)
        rest = sum(_WEIGHTS.get(r.kind, 1) for r, _ in ordered[idx:])
        share = remaining * weight // rest
        used = text[:share]
        remaining -= len(used)
        out.append((ref, used, len(used) < len(text)))
    return out
