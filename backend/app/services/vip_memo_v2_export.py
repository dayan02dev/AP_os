"""DOCX and PDF exporters for the VIP memo v2 ("Navigator") JSON.

Both renderers walk the same neutral block list built by ``build_blocks`` so
the two files always carry the same content in the same order:

  title → deal snapshot → what → why (5 points) → product → technology edge →
  competitive landscape → addressable market → founding team → milestones →
  use of funds → risks → IC recommendation → questions → IC Reviewer Notes
  (own page) → "Prepared by" line.

Format: navy/blue scheme, Arial (Helvetica in the PDF), US Letter, 0.8"
margins, "CONFIDENTIAL" header and page numbers on every page, section headers
with a bottom rule, tables with a navy header row and alternating shading.
"""
from __future__ import annotations

import io
from typing import Any
from xml.sax.saxutils import escape

TBC = "[To be confirmed]"
NAVY = "1F3864"
BLUE = "2E75B6"
ALT = "EEF3FA"
RULE = "B4C6E7"
BOX = "DEEAF6"
INK = "222222"
SOFT = "4A4A4A"

REVIEWER_AREAS = (
    ("Moats & Defensibility", "What would stop a well-funded competitor from copying this within two years?"),
    ("Red Flags", "Is anything in the application inconsistent, overstated or missing?"),
    ("Commercial Viability", "Will customers pay enough, soon enough, to sustain the business?"),
    ("Team Assessment", "Can this team execute the 12-month plan? What gaps exist?"),
    ("Funding & Structure", "Is the ask sized right, and is the instrument appropriate?"),
    ("Technical Validation", "How far has the core technology been independently proven?"),
    ("Go-to-Market Clarity", "Is the first customer segment and route to it specific and credible?"),
    ("IP & Entity Structure", "Who owns the IP, and is the entity clean for investment?"),
    ("Follow-on Fundability", "Will this company be able to raise its next round after the programme?"),
    ("Overall Verdict", "Approve, approve with conditions, or ask for more information — and why?"),
)

# why-row label → (sub-point title, index fallback)
_WHY_POINTS = (
    ("Status quo", ("today", "getting worse")),
    ("Competitor limitations", ("why others can't", "why others cant")),
    ("Barriers to entry", ("hard to copy",)),
    ("Traction & capital efficiency", ("proof so far",)),
    ("Pivot potential", ("plan b",)),
)


def _items(value: Any) -> list:
    """Bullet items (each a string or [lead, *sub-points]) from a string or list."""
    if isinstance(value, list):
        return [v for v in value if v not in (None, "", [])]
    return [] if value in (None, "") else [value]


def _s(value: Any) -> str:
    if value is None:
        return "—"
    if isinstance(value, list):  # bullet list → "• " lines (table cells, labels)
        lines = []
        for it in _items(value):
            if isinstance(it, list):
                lines.append(f"• {_s(it[0])}")
                lines += [f"  – {_s(x)}" for x in it[1:]]
            else:
                lines.append(f"• {_s(it)}")
        return "\n".join(lines) or "—"
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    text = str(value).strip()
    return text or "—"


def _d(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _l(value: Any) -> list:
    return value if isinstance(value, list) else []


def _row(value: Any, width: int) -> list[str]:
    cells = [_s(c) for c in _l(value)][:width]
    return cells + ["—"] * (width - len(cells))


def _why_points(rows: list) -> list[tuple[str, Any]]:
    """(title, text or bullet list) per sub-point; a list wins if any row has one."""
    by_label: dict[str, list] = {}
    for r in rows:
        cells = _l(r)
        if len(cells) >= 2:
            by_label.setdefault(str(cells[0]).strip().lower(), []).append(cells[1])
    points = []
    for title, labels in _WHY_POINTS:
        values = [v for lab in labels for v in by_label.get(lab, [])]
        if any(isinstance(v, list) for v in values):
            points.append((title, [i for v in values for i in _items(v)]))
        else:
            points.append((title, " ".join(_s(v) for v in values) if values else TBC))
    return points


def build_blocks(memo: dict[str, Any]) -> list[tuple]:
    """The memo as an ordered list of renderer-neutral blocks."""
    name = _s(memo.get("name")) if memo.get("name") else "This company"
    snap = _d(memo.get("snapshot"))
    sec = _d(memo.get("sections"))

    def sv(key: str, field: str = "value") -> str:
        item = snap.get(key)
        return _s(item.get(field)) if isinstance(item, dict) else _s(item)

    stage_raw = sv("stage")
    parts = [p.strip() for p in stage_raw.split("·")]
    trl, stage = (parts[0], " · ".join(parts[1:])) if len(parts) > 1 else ("—", stage_raw)

    b: list[tuple] = [("title", name, _s(memo.get("headline")) if memo.get("headline") else "")]

    def prose(value: Any, kind: str = "p", label: str | None = None) -> None:
        """A string as one paragraph; a list as bullets (under ``label`` if given)."""
        if isinstance(value, list):
            if _items(value):
                if label:
                    b.append(("label", label))
                b.append(("bullets", _items(value)))
        elif value:
            b.append(("lp", label, _s(value)) if label else (kind, _s(value)))

    b.append(("h1", "Deal snapshot"))
    b.append(("snapshot", [
        [("Stage", stage), ("Ask", sv("ask")), ("Duration", sv("ask", "note")), ("Instrument", sv("instrument"))],
        [("Sector", sv("sector")), ("TRL or stage", trl), ("Location", sv("location")), ("IC date", _s(snap.get("ic_date")))],
    ]))

    what = _d(sec.get("what"))
    b.append(("h1", "What does this company do?"))
    prose(memo.get("plain"))
    prose(_l(what.get("paragraphs")))
    prose(what.get("analogy"), label="Analogy")
    short = what.get("in_short") or memo.get("in_short")
    if short:
        b.append(("lp", "In short", _s(short)))

    b.append(("h1", "Why this solution matters"))
    for title, text in _why_points(_l(_d(sec.get("why")).get("rows"))):
        prose(text, label=title)

    product = _d(sec.get("product"))
    cols = [_s(c) for c in _l(product.get("columns"))] or ["Offer", "What the buyer gets", "Indicative price"]
    b.append(("h1", "The product"))
    b.append(("table", cols, [_row(o, len(cols)) for o in _l(product.get("offers"))], None))
    prose(product.get("note"), "note")

    b.append(("h1", "Technology edge"))
    tech = []
    for r in _l(_d(sec.get("tech")).get("rows")):
        label, value = (_l(r) + [None, None])[:2]
        tech.append([_s(label), *_items(value)] if isinstance(value, list) else f"{_s(label)}: {_s(value)}")
    b.append(("bullets", tech))

    comp = _d(sec.get("competitors"))
    b.append(("h1", "Competitive landscape"))
    for group in _l(comp.get("groups")):
        g = _d(group)
        b.append(("h2", _s(g.get("segment"))))
        b.append(("table", ["Competitor", "What they do", "Key limitation", f"{name} advantage"],
                  [_row(r, 4) for r in _l(g.get("rows"))], None))
    prose(comp.get("note"), "note")

    market = _d(sec.get("market"))
    rows = [[_s(_d(r).get("segment")), _s(_d(r).get("global_size")), _s(_d(r).get("slice_label")),
             _s(_d(r).get("rationale")), _s(_d(r).get("source"))] for r in _l(market.get("rows"))]
    rows.append(["Total", "", _s(market.get("total")), "", ""])
    b.append(("h1", "Addressable market"))
    b.append(("table", ["Segment", "Global size", "Realistic slice", "Rationale", "Source"], rows, "total"))
    prose(market.get("beachhead"), label="Beachhead")
    prose(market.get("tam_note"), "note")

    team = _d(sec.get("team"))
    b.append(("h1", "Founding team"))
    b.append(("table", ["Name", "Role", "Background"],
              [[_s(_d(m).get("name")), _s(_d(m).get("role")), _s(_d(m).get("background"))]
               for m in _l(team.get("members"))], None))
    holders = [[_s(h[0]), _s(h[1]), f"{_s(h[2])}%"] for h in (_row(x, 3) for x in _l(team.get("holders")))]
    if holders:
        b.append(("h2", "Cap table"))
        b.append(("table", ["Holder", "Type", "Equity"], holders, None))
    if _items(team.get("notes")):
        b.append(("bullets", _items(team["notes"])))
    if _l(team.get("confirm")):
        b.append(("lp", "To confirm with the founders", "; ".join(_s(c) for c in team["confirm"])))

    ms = _d(sec.get("milestones"))
    b.append(("h1", "Milestones"))
    b.append(("table", ["When", "Key deliverables", "Target / budget"], [_row(r, 3) for r in _l(ms.get("rows"))], None))
    prose(ms.get("infra"), label="Asks ARTPARK for")
    prose(ms.get("note"), "note")

    funds = _d(sec.get("funds"))
    frows = []
    for r in _l(funds.get("rows")):
        c = _row(r, 4)
        frows.append([c[0], c[3], f"{c[2]}%" if c[2] != "—" else "—", c[1]])
    frows.append(["Total", _s(funds.get("total")), "100%" if frows else "—", ""])
    b.append(("h1", "Use of funds"))
    b.append(("table", ["Category", "Amount", "%", "Key items"], frows, "total"))
    prose(funds.get("note"), "note")

    b.append(("h1", "Key risks & mitigants"))
    risks = []
    for r in _l(_d(sec.get("risks")).get("rows")):
        if isinstance(r, dict):  # {title, risk, handled}
            risk = _s(r.get("risk"))
            risks.append([f"{_s(r['title'])}\n{risk}" if r.get("title") else risk, _s(r.get("handled"))])
        else:
            risks.append(_row(r, 2))
    b.append(("table", ["Risk", "Mitigant"], risks, None))

    # The IC recommendation (memo["recommendation"]) is left out for now.

    b.append(("h1", "Questions for the founders"))
    b.append(("numbered", [_s(q) for q in _l(memo.get("questions"))]))

    b.append(("pagebreak",))
    b.append(("h1", "IC Reviewer Notes"))
    b.append(("reviewer_notes", REVIEWER_AREAS))
    b.append(("signature", ["Reviewer Name", "Date", "Signature"]))
    b.append(("footer_line", f"Prepared by: {_s(memo.get('prepared_by'))} | {_s(memo.get('generated_at'))}"))
    return b


# ─── DOCX ───────────────────────────────────────────────────────────────

def render_docx_v2(memo: dict[str, Any]) -> bytes:
    from docx import Document
    from docx.enum.table import WD_TABLE_ALIGNMENT
    from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Inches, Pt, RGBColor

    navy, blue, soft = RGBColor.from_string(NAVY), RGBColor.from_string(BLUE), RGBColor.from_string(SOFT)
    doc = Document()
    section = doc.sections[0]
    section.page_width, section.page_height = Inches(8.5), Inches(11)
    for side in ("top_margin", "bottom_margin", "left_margin", "right_margin"):
        setattr(section, side, Inches(0.8))
    normal = doc.styles["Normal"]
    normal.font.name = "Arial"
    normal.font.size = Pt(10)
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), "Arial")

    def run(par, text, bold=False, italic=False, color=None, size=None):
        r = par.add_run(text)
        r.bold, r.italic = bold, italic
        r.font.name = "Arial"
        if color is not None:
            r.font.color.rgb = color
        if size:
            r.font.size = Pt(size)
        return r

    def shade(cell, fill):
        tc_pr = cell._tc.get_or_add_tcPr()
        shd = OxmlElement("w:shd")
        shd.set(qn("w:val"), "clear")
        shd.set(qn("w:color"), "auto")
        shd.set(qn("w:fill"), fill)
        tc_pr.append(shd)

    def bottom_border(par, color=BLUE, size="8"):
        p_pr = par._p.get_or_add_pPr()
        bdr = OxmlElement("w:pBdr")
        bottom = OxmlElement("w:bottom")
        for k, v in (("w:val", "single"), ("w:sz", size), ("w:space", "1"), ("w:color", color)):
            bottom.set(qn(k), v)
        bdr.append(bottom)
        p_pr.append(bdr)

    def page_field(par):
        r = par.add_run()
        for tag, attr in (("w:fldChar", "begin"), ("w:instrText", None), ("w:fldChar", "end")):
            el = OxmlElement(tag)
            if attr:
                el.set(qn("w:fldCharType"), attr)
            else:
                el.set(qn("xml:space"), "preserve")
                el.text = "PAGE"
            r._r.append(el)

    head = section.header.paragraphs[0]
    head.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run(head, "CONFIDENTIAL", bold=True, color=navy, size=8)
    foot = section.footer.paragraphs[0]
    foot.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run(foot, "Page ", color=soft, size=8)
    page_field(foot)

    def table(header, rows, kind=None, widths=None):
        t = doc.add_table(rows=1, cols=len(header))
        t.style = "Table Grid"
        t.alignment = WD_TABLE_ALIGNMENT.CENTER
        for i, h in enumerate(header):
            cell = t.rows[0].cells[i]
            cell.text = ""
            run(cell.paragraphs[0], h, bold=True, color=RGBColor(0xFF, 0xFF, 0xFF), size=9)
            shade(cell, NAVY)
        for n, r in enumerate(rows):
            cells = t.add_row().cells
            is_total = kind == "total" and n == len(rows) - 1
            for i, v in enumerate(r):
                cells[i].text = ""
                run(cells[i].paragraphs[0], v, bold=is_total or i == 0, size=9)
                if is_total:
                    shade(cells[i], BOX)
                elif n % 2 == 1:
                    shade(cells[i], ALT)
        doc.add_paragraph()
        return t

    for block in build_blocks(memo):
        kind = block[0]
        if kind == "title":
            p = doc.add_paragraph()
            run(p, "CONFIDENTIAL · VIP INVESTMENT COMMITTEE MEMO", bold=True, color=blue, size=9)
            p = doc.add_paragraph()
            run(p, block[1], bold=True, color=navy, size=24)
            if block[2]:
                run(doc.add_paragraph(), block[2], italic=True, color=soft, size=12)
        elif kind == "h1":
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(14)
            p.paragraph_format.keep_with_next = True
            run(p, block[1], bold=True, color=navy, size=14)
            bottom_border(p)
        elif kind == "h2":
            p = doc.add_paragraph()
            p.paragraph_format.keep_with_next = True
            run(p, block[1], bold=True, color=blue, size=11)
        elif kind == "p":
            doc.add_paragraph(block[1])
        elif kind == "lp":
            p = doc.add_paragraph()
            run(p, f"{block[1]}: ", bold=True, color=navy)
            run(p, block[2])
        elif kind == "note":
            run(doc.add_paragraph(), block[1], italic=True, color=soft, size=9)
        elif kind == "label":
            p = doc.add_paragraph()
            p.paragraph_format.keep_with_next = True
            run(p, f"{block[1]}:", bold=True, color=navy)
        elif kind == "bullets":
            for item in block[1]:
                lead, subs = (item[0], item[1:]) if isinstance(item, list) else (item, [])
                doc.add_paragraph(_s(lead), style="List Bullet")
                for sub in subs:
                    doc.add_paragraph(_s(sub), style="List Bullet 2")
        elif kind == "numbered":
            for item in block[1]:
                doc.add_paragraph(item, style="List Number")
        elif kind == "snapshot":
            t = doc.add_table(rows=0, cols=4)
            t.style = "Table Grid"
            for group in block[1]:
                labels, values = t.add_row().cells, t.add_row().cells
                for i, (label, value) in enumerate(group):
                    labels[i].text = ""
                    run(labels[i].paragraphs[0], label.upper(), bold=True, color=RGBColor(0xFF, 0xFF, 0xFF), size=8)
                    shade(labels[i], NAVY)
                    values[i].text = ""
                    run(values[i].paragraphs[0], value, bold=True, size=10)
                    shade(values[i], ALT)
            doc.add_paragraph()
        elif kind == "table":
            table(block[1], block[2], block[3])
        elif kind == "pagebreak":
            doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
        elif kind == "reviewer_notes":
            for title, question in block[1]:
                p = doc.add_paragraph()
                p.paragraph_format.keep_with_next = True
                run(p, title, bold=True, color=navy, size=10.5)
                q = doc.add_paragraph()
                q.paragraph_format.keep_with_next = True
                run(q, question, italic=True, color=soft, size=9)
                for _ in range(3):
                    line = doc.add_paragraph()
                    bottom_border(line, color=RULE, size="4")
        elif kind == "signature":
            t = doc.add_table(rows=2, cols=len(block[1]))
            t.style = "Table Grid"
            for i, label in enumerate(block[1]):
                t.rows[0].cells[i].text = ""
                run(t.rows[0].cells[i].paragraphs[0], label, bold=True, color=RGBColor(0xFF, 0xFF, 0xFF), size=9)
                shade(t.rows[0].cells[i], NAVY)
                t.rows[1].cells[i].text = "\n"
            doc.add_paragraph()
        elif kind == "footer_line":
            run(doc.add_paragraph(), block[1], italic=True, color=soft, size=8)

    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()


# ─── PDF ────────────────────────────────────────────────────────────────

def render_pdf_v2(memo: dict[str, Any]) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import (
        KeepTogether, PageBreak, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
    )
    from reportlab.platypus.flowables import HRFlowable

    navy, blue, soft = colors.HexColor("#" + NAVY), colors.HexColor("#" + BLUE), colors.HexColor("#" + SOFT)
    alt, rule, box = colors.HexColor("#" + ALT), colors.HexColor("#" + RULE), colors.HexColor("#" + BOX)
    ink = colors.HexColor("#" + INK)
    margin = 0.8 * inch
    width = letter[0] - 2 * margin

    base = ParagraphStyle("v2body", fontName="Helvetica", fontSize=9.5, leading=13, textColor=ink, spaceAfter=5)
    st = {
        "kicker": ParagraphStyle("v2kicker", parent=base, fontName="Helvetica-Bold", fontSize=8.5, textColor=blue),
        "title": ParagraphStyle("v2title", parent=base, fontName="Helvetica-Bold", fontSize=24, leading=28, textColor=navy, spaceAfter=6),
        "one": ParagraphStyle("v2one", parent=base, fontName="Helvetica-Oblique", fontSize=12, leading=16, textColor=soft, spaceAfter=10),
        "h1": ParagraphStyle("v2h1", parent=base, fontName="Helvetica-Bold", fontSize=14, leading=18, textColor=navy, spaceBefore=12, spaceAfter=2),
        "h2": ParagraphStyle("v2h2", parent=base, fontName="Helvetica-Bold", fontSize=11, leading=14, textColor=blue, spaceBefore=6),
        "note": ParagraphStyle("v2note", parent=base, fontName="Helvetica-Oblique", fontSize=8.5, textColor=soft),
        "cell": ParagraphStyle("v2cell", parent=base, fontSize=8.5, leading=11, spaceAfter=0),
        "cellb": ParagraphStyle("v2cellb", parent=base, fontName="Helvetica-Bold", fontSize=8.5, leading=11, spaceAfter=0),
        "th": ParagraphStyle("v2th", parent=base, fontName="Helvetica-Bold", fontSize=8, leading=10, textColor=colors.white, spaceAfter=0),
        "area": ParagraphStyle("v2area", parent=base, fontName="Helvetica-Bold", fontSize=10, leading=12, textColor=navy, spaceBefore=4, spaceAfter=1),
        "bullet": ParagraphStyle("v2bullet", parent=base, leftIndent=12, firstLineIndent=-8, spaceAfter=3),
        "sub": ParagraphStyle("v2sub", parent=base, fontSize=9, leading=12, textColor=soft, leftIndent=26, firstLineIndent=-8, spaceAfter=2),
        "q": ParagraphStyle("v2q", parent=base, fontName="Helvetica-Oblique", fontSize=8.5, leading=10, textColor=soft, spaceAfter=0),
    }

    def P(text, style="body", bold_label=None):
        # Helvetica (a PDF base font) has no rupee glyph; spell it out.
        t = escape(str(text).replace("₹", "Rs ")).replace("\n", "<br/>")
        if bold_label:
            t = f'<font name="Helvetica-Bold" color="#{NAVY}">{escape(bold_label)}:</font> {t}'
        return Paragraph(t, base if style == "body" else st[style])

    def grid(header, rows, kind=None, col_widths=None):
        data = [[P(h, "th") for h in header]]
        for n, r in enumerate(rows):
            is_total = kind == "total" and n == len(rows) - 1
            data.append([P(v, "cellb" if (i == 0 or is_total) else "cell") for i, v in enumerate(r)])
        t = Table(data, colWidths=col_widths or [width / len(header)] * len(header), repeatRows=1)
        style = [
            ("BACKGROUND", (0, 0), (-1, 0), navy),
            ("GRID", (0, 0), (-1, -1), 0.4, rule),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]
        for n in range(len(rows)):
            if kind == "total" and n == len(rows) - 1:
                style.append(("BACKGROUND", (0, n + 1), (-1, n + 1), box))
            elif n % 2 == 1:
                style.append(("BACKGROUND", (0, n + 1), (-1, n + 1), alt))
        t.setStyle(TableStyle(style))
        return t

    def on_page(canvas, doc_):
        canvas.saveState()
        canvas.setFont("Helvetica-Bold", 8)
        canvas.setFillColor(navy)
        canvas.drawRightString(letter[0] - margin, letter[1] - 0.5 * inch, "CONFIDENTIAL")
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(soft)
        canvas.drawCentredString(letter[0] / 2, 0.45 * inch, f"Page {doc_.page}")
        canvas.restoreState()

    story: list = []
    pending_heading: list = []
    signature: list = []

    def add(*flowables):
        nonlocal pending_heading
        if pending_heading:
            story.append(KeepTogether(pending_heading + [flowables[0]]))
            story.extend(flowables[1:])
            pending_heading = []
        else:
            story.extend(flowables)

    for block in build_blocks(memo):
        kind = block[0]
        if kind == "title":
            add(P("CONFIDENTIAL · VIP INVESTMENT COMMITTEE MEMO", "kicker"), P(block[1], "title"))
            if block[2]:
                add(P(block[2], "one"))
        elif kind == "h1":
            pending_heading = [P(block[1], "h1"), HRFlowable(width="100%", thickness=1.2, color=blue, spaceAfter=6)]
        elif kind == "h2":
            if pending_heading:
                pending_heading.append(P(block[1], "h2"))
            else:
                pending_heading = [P(block[1], "h2")]
        elif kind == "p":
            add(P(block[1]))
        elif kind == "lp":
            add(P(block[2], bold_label=block[1]))
        elif kind == "note":
            add(P(block[1], "note"))
        elif kind == "label":
            pending_heading = pending_heading + [P(f"{block[1]}:", "area")]
        elif kind == "bullets":
            items = []
            for x in block[1]:
                lead, subs = (x[0], x[1:]) if isinstance(x, list) else (x, [])
                items.append(P(f"• {_s(lead)}", "bullet"))
                items.extend(P(f"– {_s(sub)}", "sub") for sub in subs)
            if items:
                add(*items)
        elif kind == "numbered":
            items = [P(f"{i + 1}. {x}") for i, x in enumerate(block[1])]
            if items:
                add(*items)
        elif kind == "snapshot":
            data, style = [], [("GRID", (0, 0), (-1, -1), 0.4, rule), ("VALIGN", (0, 0), (-1, -1), "TOP")]
            for g, group in enumerate(block[1]):
                data.append([P(label.upper(), "th") for label, _ in group])
                data.append([P(value, "cellb") for _, value in group])
                style.append(("BACKGROUND", (0, 2 * g), (-1, 2 * g), navy))
                style.append(("BACKGROUND", (0, 2 * g + 1), (-1, 2 * g + 1), alt))
            t = Table(data, colWidths=[width / 4] * 4)
            t.setStyle(TableStyle(style))
            add(t, Spacer(1, 6))
        elif kind == "table":
            add(grid(block[1], block[2], block[3]), Spacer(1, 6))
        elif kind == "pagebreak":
            story.append(PageBreak())
        elif kind == "reviewer_notes":
            for title, question in block[1]:
                lines = [HRFlowable(width="100%", thickness=0.5, color=rule, spaceBefore=9, spaceAfter=0) for _ in range(3)]
                add(KeepTogether([P(title, "area"), P(question, "q"), *lines]))
        elif kind == "signature":
            t = Table([[P(x, "th") for x in block[1]], ["", "", ""]],
                      colWidths=[width / 3] * 3, rowHeights=[None, 0.4 * inch])
            t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), navy), ("GRID", (0, 0), (-1, -1), 0.4, rule)]))
            signature = [Spacer(1, 8), t]
        elif kind == "footer_line":
            story.append(KeepTogether(signature + [Spacer(1, 6), P(block[1], "note")]))

    out = io.BytesIO()
    SimpleDocTemplate(
        out, pagesize=letter, leftMargin=margin, rightMargin=margin, topMargin=margin, bottomMargin=margin,
        title=f"{_s(memo.get('name'))} IC Memo",
    ).build(story, onFirstPage=on_page, onLaterPages=on_page)
    return out.getvalue()


DOCX_MEDIA = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def render(memo: dict[str, Any], fmt: str) -> tuple[bytes, str]:
    """(body, media type) for ``fmt`` in {"pdf", "docx"}."""
    if fmt == "docx":
        return render_docx_v2(memo), DOCX_MEDIA
    return render_pdf_v2(memo), "application/pdf"
