"""MemoV2 schema contract: parses the fake fixture and both real pilots."""
import copy
import json
from pathlib import Path

import pytest
from app.services.vip_memo_gen.schema import (
    SECTION_KEYS,
    WHY_LABELS,
    MemoV2,
    MemoValidationError,
    memo_to_dict,
    parse_memo,
    writer_json_schema,
)

FAKE = Path(__file__).parent / "fixtures" / "vip_memo_v2_fake.json"
PILOT_DIR = Path(
    "/Users/apple/Desktop/Final_AP_os/.claude/worktrees/vip-memo-navigator/backend/app/data/vip_memo_v2"
)


def fake() -> dict:
    return json.loads(FAKE.read_text())


def test_constants():
    assert SECTION_KEYS == ("what", "why", "product", "tech", "competitors", "market",
                            "team", "milestones", "funds", "risks")
    assert WHY_LABELS == ("Today", "Getting worse", "Why others can't", "Hard to copy",
                          "Proof so far", "Plan B")


def test_parses_fake_fixture():
    m = parse_memo(fake())
    assert isinstance(m, MemoV2) and m.name


def test_parses_both_pilots():
    files = sorted(PILOT_DIR.glob("*.json")) if PILOT_DIR.is_dir() else []
    if len(files) < 2:
        pytest.skip("pilot memo files not present")
    for f in files:
        assert parse_memo(json.loads(f.read_text())).name


def test_roundtrip_is_stable():
    d = memo_to_dict(parse_memo(fake()))
    assert memo_to_dict(parse_memo(d)) == d


def test_infra_string_normalised_to_list():
    d = fake()
    d["sections"]["milestones"]["infra"] = "x"
    assert memo_to_dict(parse_memo(d))["sections"]["milestones"]["infra"] == ["x"]


def test_rejects_missing_section():
    d = fake()
    del d["sections"]["risks"]
    with pytest.raises(MemoValidationError) as e:
        parse_memo(d)
    assert any("risks" in msg for msg in e.value.messages)


def test_risk_card_shape():
    d = fake()
    d["sections"]["risks"]["rows"] = [{"risk": "r", "handled": "h"}]
    with pytest.raises(MemoValidationError):
        parse_memo(d)
    d["sections"]["risks"]["rows"] = [{"title": "t", "risk": "r", "handled": "h"}]
    out = memo_to_dict(parse_memo(d))
    assert out["sections"]["risks"]["rows"] == [{"title": "t", "risk": "r", "handled": "h"}]


def test_legacy_risk_pair_becomes_card():
    row = memo_to_dict(parse_memo(fake()))["sections"]["risks"]["rows"][0]
    assert row["title"] and row["risk"] == "Fake risk A" and row["handled"] == "Fake mitigant A"


def test_why_rows_use_known_labels():
    d = fake()
    d["sections"]["why"]["rows"][0][0] = "Foo"
    with pytest.raises(MemoValidationError):
        parse_memo(d)


def test_writer_schema_is_json_schema():
    s = writer_json_schema()
    assert s["type"] == "object" and "sections" in s["properties"]
    assert "$defs" not in s and "$ref" not in json.dumps(s)
    json.dumps(s)


def test_version_must_be_2():
    d = fake()
    d["version"] = "1"
    with pytest.raises(MemoValidationError):
        parse_memo(d)


def test_unknown_top_level_key_dropped_but_leaf_extras_kept():
    d = fake()
    d["bogus"] = 1
    assert "bogus" not in memo_to_dict(parse_memo(d))
    d = copy.deepcopy(fake())
    d["sections"]["tech"]["extra_leaf"] = "kept"
    assert memo_to_dict(parse_memo(d))["sections"]["tech"]["extra_leaf"] == "kept"


def test_version_serialises_as_int_and_schema_is_integer():
    d = fake()
    assert d["version"] in (2, "2")
    for v in (2, "2"):
        d["version"] = v
        out = memo_to_dict(parse_memo(d))["version"]
        assert out == 2 and type(out) is int
    assert writer_json_schema()["properties"]["version"]["type"] == "integer"
    assert "const" not in writer_json_schema()["properties"]["version"]


def test_malformed_legacy_risk_pair_is_validation_error():
    d = fake()
    d["sections"]["risks"]["rows"] = [[[["deep"]], "h"]]
    with pytest.raises(MemoValidationError):
        parse_memo(d)
