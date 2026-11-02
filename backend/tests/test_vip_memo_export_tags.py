"""VIP memo PDF/DOCX export: verification tags are display-mapped like the
web memo (VipNavigatorMemo.jsx). Founder tags ("[Needs founder verification]",
legacy "[To be confirmed]") print as "To Verify"; AI cross-check tags are
dropped (a value that was only that tag prints "—"). Stored memo data and the
generation prompts/tags are untouched."""
from __future__ import annotations

import copy

from app.services import vip_memo_v2, vip_memo_v2_export
from app.services.vip_memo_gen.tags import FOUNDER, LEGACY, VERIFY

from tests.test_vip_memo_v2 import FIXTURE, _both_texts


def _tagged_memo() -> dict:
    memo = copy.deepcopy(FIXTURE)
    memo["snapshot"]["ask"]["value"] = f"₹50 L {FOUNDER}"
    memo["snapshot"]["ic_date"] = LEGACY
    memo["sections"]["market"]["total"] = VERIFY
    memo["sections"]["market"]["rows"][0]["global_size"] = f"$4.2B {VERIFY}"
    memo["sections"]["funds"]["rows"][0][2] = LEGACY
    memo["questions"] = [f"What is the burn? {FOUNDER}"]
    return memo


def _strings(node):
    if isinstance(node, str):
        yield node
    elif isinstance(node, list | tuple):
        for n in node:
            yield from _strings(n)


def test_blocks_show_to_verify_and_drop_ai_cross_check():
    memo = _tagged_memo()
    before = copy.deepcopy(memo)
    blocks = vip_memo_v2_export.build_blocks(memo)
    text = "\n".join(_strings(blocks))
    for tag in (FOUNDER, LEGACY, VERIFY):
        assert tag not in text
    assert "₹50 L To Verify" in text
    assert "What is the burn? To Verify" in text
    assert "$4.2B" in text and "$4.2B " not in text.replace("$4.2B (", "")
    snap = next(b for b in blocks if b[0] == "snapshot")
    assert ("IC date", "To Verify") in snap[1][1]
    funds = next(b for b in blocks if b[0] == "table" and b[1][0] == "Category")
    assert funds[2][0][2] == "To Verify"
    i = blocks.index(("h1", "Addressable market"))
    total = next(b for b in blocks[i:] if b[0] == "lp" and b[1] == "Realistic opportunity, per year")
    assert total[2] == "—"
    assert memo == before  # display only: the memo dict is not rewritten


def test_pdf_and_docx_print_to_verify():
    for text in _both_texts(_tagged_memo()):
        assert "To Verify" in text
        assert "Needs founder verification" not in text
        assert "Needs AI cross-verification" not in text
        assert "To be confirmed" not in text


def test_download_renders_live_instead_of_stale_stored_export(monkeypatch):
    """Stored exports were rendered with the raw tags; downloads render now."""
    monkeypatch.setattr(vip_memo_v2, "stored_export", lambda *_a, **_k: b"%PDF-stale-raw-tags")
    body, media = vip_memo_v2.export_for("memo-1", _tagged_memo(), "pdf")
    assert body.startswith(b"%PDF-") and body != b"%PDF-stale-raw-tags"
    assert media == "application/pdf"
