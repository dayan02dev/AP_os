"""Two verification tags replace the old "[To be confirmed]" placeholder."""
from app.services.vip_memo_gen.tags import FOUNDER, LEGACY, VERIFY, retag, tag_for


def test_tag_for_paths():
    assert tag_for(("sections", "market", "rows", 0, "global_size")) == VERIFY
    assert tag_for(("sections", "competitors", "groups", 0, "rows", 1, 2)) == VERIFY
    assert tag_for(("takeaways", "market")) == VERIFY
    assert tag_for(("sources", "competitors")) == VERIFY
    assert tag_for(("sections", "funds", "rows", 0, 3)) == FOUNDER
    assert tag_for(("snapshot", "ask", "value")) == FOUNDER
    assert tag_for(("sections", "team", "holders", 0, 2)) == FOUNDER
    assert tag_for(("questions", 0)) == FOUNDER


def test_why_others_cant_row_is_verify_other_why_rows_founder():
    memo = {"sections": {"why": {"rows": [
        ["Why others can't", f"Rivals {LEGACY}."],
        ["Proof so far", [LEGACY, ["lead", LEGACY]]],
    ]}}}
    out, n = retag(memo)
    rows = out["sections"]["why"]["rows"]
    assert rows[0] == ["Why others can't", f"Rivals {VERIFY}."]
    assert rows[1] == ["Proof so far", [FOUNDER, ["lead", FOUNDER]]]
    assert n == 3


def test_retag_replaces_embedded_and_leaves_input_untouched():
    memo = {
        "name": "X",
        "snapshot": {"ask": {"value": f"₹50 L {LEGACY}", "note": ""}},
        "sections": {"market": {"rows": [{"segment": "A", "global_size": LEGACY,
                                          "slice_low_cr": 0}], "total": LEGACY}},
        "questions": ["Plain to be confirmed prose stays"],
    }
    out, n = retag(memo)
    assert n == 3
    assert out["snapshot"]["ask"]["value"] == f"₹50 L {FOUNDER}"
    assert out["sections"]["market"]["rows"][0]["global_size"] == VERIFY
    assert out["sections"]["market"]["total"] == VERIFY
    assert out["questions"] == ["Plain to be confirmed prose stays"]
    assert memo["snapshot"]["ask"]["value"] == f"₹50 L {LEGACY}"  # copy, not in place
    assert out["sections"]["market"]["rows"][0]["slice_low_cr"] == 0


def test_retag_is_idempotent():
    out, _ = retag({"sections": {"market": {"total": LEGACY}}})
    again, n = retag(out)
    assert n == 0 and again == out
