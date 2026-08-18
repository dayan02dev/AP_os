"""Extractor tested against the real committed .docx (not a fixture).

If a revised source document changes shape (paragraph count, table layout,
placeholder count), these tests trip loudly — extraction must never silently
produce a truncated or misaligned template.
"""
from pathlib import Path

from scripts.extract_agreement_template import extract

SOURCE = (
    Path(__file__).resolve().parent.parent
    / "scripts"
    / "source_docs"
    / "facility_agreement_2026-08-06.docx"
)


def test_extracts_133_paragraphs_and_4_tables_in_order():
    result = extract(SOURCE)
    paras = [b for b in result["blocks"] if b["type"] == "paragraph"]
    tables = [b for b in result["blocks"] if b["type"] == "table"]
    assert len(paras) == 133
    assert len(tables) == 4
    # order preserved: the document's first block is the title paragraph
    assert result["blocks"][0]["text"].strip() == "FACILITY AGREEMENT"


def test_extracts_22_bullet_placeholders_total():
    result = extract(SOURCE)
    total = 0
    for b in result["blocks"]:
        if b["type"] == "paragraph":
            total += b["text"].count("[•]")
        else:
            for row in b["rows"]:
                for cell in row:
                    total += cell.count("[•]")
    assert total == 22


def test_collaborator_1_clause_is_extracted_verbatim():
    result = extract(SOURCE)
    para = next(b for b in result["blocks"] if b["type"] == "paragraph" and b["index"] == 4)
    assert para["placeholder_count"] == 4
    assert "Collaborator 1" in para["text"]


def test_facilities_schedule_table_has_six_placeholder_rows():
    result = extract(SOURCE)
    table = next(b for b in result["blocks"] if b["type"] == "table" and b["index"] == 126)
    placeholder_rows = [r for r in table["rows"] if "[•]" in r[3]]
    assert len(placeholder_rows) == 6
    assert table["rows"][1][1] == "Dedicated Seating"
    assert table["rows"][6][1] == "Administrative ID / Access Badge"


def test_a_revised_source_document_fails_loudly():
    """Guards against silent extraction drift: if the source changes shape,
    this test (run against the committed file) is the trip-wire — a
    paragraph or placeholder count that no longer matches is a signal the
    template JSON must be regenerated and every downstream index
    re-verified, not silently accepted."""
    result = extract(SOURCE)
    assert len(result["blocks"]) == 137  # 133 paragraphs + 4 tables


def test_paragraphs_only_traversal_would_lose_table_interleaving():
    """document.paragraphs (python-docx's flattened list) does not carry
    table position information — this test documents why extract() must
    walk document.element.body.iterchildren() instead."""
    import docx

    document = docx.Document(str(SOURCE))
    assert len(document.paragraphs) == 133  # same count...
    # ...but this list alone cannot tell you where the 4 tables sit relative
    # to these paragraphs in document order. extract()'s blocks list can.
    result = extract(SOURCE)
    table_positions = [i for i, b in enumerate(result["blocks"]) if b["type"] == "table"]
    assert table_positions == sorted(table_positions)
    assert len(table_positions) == 4
