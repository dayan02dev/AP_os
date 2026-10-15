"""schema.salvage: fills, coerces and drops so a recognisable memo always parses."""
import copy
import json
from pathlib import Path

import pytest
from app.services.vip_memo_gen.schema import (
    SECTION_KEYS,
    WHY_LABELS,
    MemoValidationError,
    memo_to_dict,
    parse_memo,
    salvage,
)

FAKE = Path(__file__).parent / "fixtures" / "vip_memo_v2_fake.json"
TBC = "[To be confirmed]"


def fake() -> dict:
    return json.loads(FAKE.read_text())


def ok(d: dict) -> tuple[dict, list[str]]:
    out, notes = salvage(d)
    return memo_to_dict(parse_memo(out)), notes


def test_valid_memo_is_unchanged_and_has_no_notes():
    d = fake()
    out, notes = salvage(copy.deepcopy(d))
    assert notes == []
    assert memo_to_dict(parse_memo(out)) == memo_to_dict(parse_memo(d))


def test_salvage_does_not_mutate_input():
    d = fake()
    del d["snapshot"]
    before = copy.deepcopy(d)
    salvage(d)
    assert d == before


def test_heavily_malformed_but_recognisable_memo_salvages():
    d = fake()
    d["headline"] = 42
    d["in_short"] = ["a", "b"]
    d["plain"] = 7
    d["questions"] = "Only one question?"
    d["figures"] = "x"
    del d["snapshot"]["ask"]
    d["snapshot"]["sector"] = "Robotics"
    d["snapshot"]["stage"] = {"value": 4}
    del d["takeaways"]["risks"]
    d["sources"] = "Application"
    s = d["sections"]
    for k in ("product", "tech", "competitors", "market"):
        del s[k]
    s["what"]["paragraphs"] = "One paragraph."
    s["why"]["rows"] = [["today", "t"], ["GETTING WORSE!", "w"], ["Moon phase", "x"], ["Plan B"]]
    s["team"]["members"] = ["Wile Coyote", {"name": "Road Runner", "role": 3}]
    s["team"]["holders"] = [["Wile", "Founder", None, True]]
    s["milestones"]["rows"] = [["Q1", "Build", 5]]
    s["funds"]["total"] = 100
    s["risks"]["rows"] = [{"risk": "r", "handled": "h"}, ["risk two", "mitigant two"], "bare risk"]
    s["what"]["unknown_extra"] = {"kept": True}
    memo, notes = ok(d)
    assert memo["headline"] == "42" and memo["plain"] == "7"
    assert memo["in_short"] == "a b"
    assert memo["questions"] == ["Only one question?"]
    assert memo["snapshot"]["ask"]["value"] == TBC
    assert memo["snapshot"]["sector"]["value"] == "Robotics"
    assert memo["snapshot"]["stage"]["value"] == "4"
    assert memo["takeaways"]["risks"] == TBC
    assert set(memo["sources"]) >= set(SECTION_KEYS) and memo["sources"]["what"] == TBC
    sec = memo["sections"]
    assert sec["product"]["offers"] == [] and sec["tech"]["rows"] == []
    assert sec["competitors"]["groups"] == [] and sec["market"]["rows"] == []
    assert sec["market"]["total"] == TBC
    assert sec["what"]["paragraphs"] == ["One paragraph."]
    assert sec["why"]["rows"] == [["Today", "t"], ["Getting worse", "w"]]
    assert [m["name"] for m in sec["team"]["members"]] == ["Wile Coyote", "Road Runner"]
    assert sec["team"]["members"][1]["role"] == "3"
    assert sec["team"]["holders"][0][2] == ""
    assert sec["milestones"]["rows"] == [["Q1", "Build", "5"]]
    assert sec["funds"]["total"] == "100"
    assert [r["title"] for r in sec["risks"]["rows"]] == ["r", "risk two", "bare risk"]
    assert sec["risks"]["rows"][2]["handled"] == TBC
    assert sec["what"]["unknown_extra"] == {"kept": True}
    joined = " | ".join(notes)
    for path in ("headline", "snapshot.ask", "takeaways.risks", "sections.product",
                 "sections.why.rows[2]", "sections.why.rows[3]", "sections.risks.rows[0]"):
        assert path in joined, path


def test_notes_are_paths_never_values():
    d = fake()
    d["headline"] = 123456789
    d["sections"]["why"]["rows"] = [["SECRET-LABEL", "SECRET-TEXT"]]
    d["sections"]["tech"]["rows"] = "SECRET-CONTENT"
    _, notes = ok(d)
    joined = " ".join(notes)
    assert notes and "SECRET" not in joined and "123456789" not in joined


def test_bullets_coercions():
    d = fake()
    s = d["sections"]
    s["what"]["analogy"] = 3.5
    s["what"]["in_short"] = ["a", 2, ["lead", 1, ["deep", "er"]], None, {"x": 1}]
    s["product"]["note"] = None
    memo, _ = ok(d)
    assert memo["sections"]["what"]["analogy"] == "3.5"
    assert memo["sections"]["what"]["in_short"] == ["a", "2", ["lead", "1", "deep er"]]
    assert memo["sections"]["product"]["note"] == ""


def test_rows_coercions():
    d = fake()
    s = d["sections"]
    s["tech"]["rows"] = [["Label", 1], "bare string row", {"a": "x", "b": "y"}, 5]
    memo, notes = ok(d)
    assert memo["sections"]["tech"]["rows"] == [["Label", "1"], ["bare string row"], ["x", "y"]]
    assert any("sections.tech.rows[3]" in n for n in notes)


def test_rows_given_as_string_become_empty():
    d = fake()
    d["sections"]["milestones"]["rows"] = "Q1 build, Q2 sell"
    memo, notes = ok(d)
    assert memo["sections"]["milestones"]["rows"] == []
    assert any("sections.milestones.rows" in n for n in notes)


def test_why_label_mapping_is_case_and_punctuation_insensitive():
    d = fake()
    d["sections"]["why"]["rows"] = [[lab.upper().replace("'", "") + " :", "x"] for lab in WHY_LABELS]
    d["sections"]["why"]["rows"].append({"label": "proof so far", "text": "dict row"})
    memo, _ = ok(d)
    labels = [r[0] for r in memo["sections"]["why"]["rows"]]
    assert labels == list(WHY_LABELS) + ["Proof so far"]


def test_why_row_with_extra_cells_keeps_text_as_bullets():
    d = fake()
    d["sections"]["why"]["rows"] = [["Today", "a", "b"]]
    memo, _ = ok(d)
    assert memo["sections"]["why"]["rows"] == [["Today", ["a", "b"]]]


def test_market_rows_coerced():
    d = fake()
    d["sections"]["market"] = {"rows": [
        {"segment": "S", "slice_low_cr": "10", "slice_high_cr": "abc", "slice_label": 5},
        "not a row",
    ]}
    memo, notes = ok(d)
    row = memo["sections"]["market"]["rows"][0]
    assert row["slice_low_cr"] == 10 and row["slice_high_cr"] == 0 and row["slice_label"] == "5"
    assert len(memo["sections"]["market"]["rows"]) == 1
    assert memo["sections"]["market"]["total"] == TBC
    assert any("sections.market.rows[0].slice_high_cr" in n for n in notes)
    assert any("sections.market.rows[1]" in n for n in notes)


def test_section_given_as_list_or_string_is_wrapped():
    d = fake()
    d["sections"]["risks"] = [["r", "m"]]
    d["sections"]["what"] = "Just a paragraph."
    d["sections"]["competitors"] = [{"segment": "A", "rows": [["X", "y"]]}, {"rows": [["Z"]]}]
    memo, _ = ok(d)
    assert memo["sections"]["risks"]["rows"][0]["handled"] == "m"
    assert memo["sections"]["what"]["paragraphs"] == ["Just a paragraph."]
    assert memo["sections"]["competitors"]["groups"][1]["segment"] == TBC


def test_sections_at_top_level_are_lifted():
    d = fake()
    sections = d.pop("sections")
    d.update(sections)
    memo, notes = ok(d)
    assert memo["sections"]["tech"]["rows"] == sections["tech"]["rows"]
    assert any("sections" in n for n in notes)


def test_recommendation_verdict_mapped_or_dropped():
    d = fake()
    d["recommendation"] = {"verdict": "conditional approval", "summary": 1}
    memo, _ = ok(d)
    assert memo["recommendation"]["verdict"] == "CONDITIONAL APPROVAL"
    assert memo["recommendation"]["summary"] == "1"
    d["recommendation"] = {"verdict": "maybe?"}
    memo, notes = ok(d)
    assert "recommendation" not in memo and any("recommendation" in n for n in notes)


def test_name_number_coerced():
    d = fake()
    d["name"] = 3
    memo, _ = ok(d)
    assert memo["name"] == "3"


@pytest.mark.parametrize("name", [None, "", "   ", [], {}])
def test_hard_fail_empty_name(name):
    d = fake()
    if name is None:
        del d["name"]
    else:
        d["name"] = name
    with pytest.raises(MemoValidationError, match="name"):
        salvage(d)


def test_hard_fail_not_an_object():
    with pytest.raises(MemoValidationError, match="not a JSON object"):
        salvage(["x"])  # type: ignore[arg-type]


def test_five_missing_sections_salvage_six_hard_fail():
    d = fake()
    for k in SECTION_KEYS[:5]:
        del d["sections"][k]
    ok(d)
    del d["sections"][SECTION_KEYS[5]]
    with pytest.raises(MemoValidationError, match="sections"):
        salvage(d)


def test_hard_fail_no_sections_at_all():
    with pytest.raises(MemoValidationError):
        salvage({"name": "x"})


def test_salvaged_output_always_renders():
    from app.services import vip_memo_v2_export
    d = fake()
    for k in ("product", "tech", "market"):
        del d["sections"][k]
    del d["snapshot"]
    memo, _ = ok(d)
    data, media = vip_memo_v2_export.render(memo, "docx")
    assert data and media
