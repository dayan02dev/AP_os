"""Mechanical .docx -> JSON template extractor.

Run BY A HUMAN when a new agreement .docx arrives; the output is committed
to the repo and is what the runtime loads (app/services/agreements.py never
opens a .docx — the production Lambda has no Word file on disk).

This script has NO knowledge of what any field means: it does not know which
[.] is a founder's name versus ARTPARK's insurance limit. That interpretation
belongs entirely to app/services/agreements.py, which reads the committed
JSON for a specific agreement slug. Keeping this generic is what makes it
reusable for the Collaboration Agreement (or any future agreement) later.

Body children are walked via document.element.body.iterchildren() rather
than the higher-level document.paragraphs / document.tables properties.
Those flattened lists lose each table's position relative to the
surrounding paragraphs -- walking the raw body XML in order is the only way
to preserve real document order when paragraphs and tables interleave.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import docx
from docx.table import Table
from docx.text.paragraph import Paragraph


def extract(docx_path: Path) -> dict:
    """Walk a .docx's body in document order and return a JSON-serializable
    template: an ordered list of paragraph/table blocks. [.] markers and
    table cell text are preserved verbatim -- no substitution happens here.
    """
    document = docx.Document(str(docx_path))
    blocks: list[dict] = []
    for i, child in enumerate(document.element.body.iterchildren()):
        tag = child.tag.split("}")[-1]
        if tag == "p":
            para = Paragraph(child, document)
            text = para.text
            blocks.append(
                {
                    "type": "paragraph",
                    "index": i,
                    "style": para.style.name if para.style else None,
                    "text": text,
                    "placeholder_count": text.count("[•]"),
                }
            )
        elif tag == "tbl":
            table = Table(child, document)
            blocks.append(
                {
                    "type": "table",
                    "index": i,
                    "rows": [[cell.text for cell in row.cells] for row in table.rows],
                }
            )
        # any other body-level tag (e.g. sectPr) carries no template content
        # and is intentionally skipped -- it is not a paragraph or a table.
    return {"slug": None, "source_file": docx_path.name, "blocks": blocks}


def main(argv: list[str]) -> None:
    if len(argv) < 2:
        raise SystemExit(
            "usage: extract_agreement_template.py <in.docx> <out.json> [slug]"
        )
    in_path, out_path = Path(argv[0]), Path(argv[1])
    slug = argv[2] if len(argv) > 2 else None
    result = extract(in_path)
    if slug:
        result["slug"] = slug
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {out_path} ({len(result['blocks'])} blocks)")


if __name__ == "__main__":
    main(sys.argv[1:])
