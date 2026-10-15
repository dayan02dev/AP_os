"""Store layer for generated VIP memos, against the hermetic fake Supabase."""
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.services.vip_memo_gen import store
from app.services.vip_memo_gen.schema import SECTION_KEYS, memo_to_dict, parse_memo
from tests.fixtures.fake_supabase import FakeSupabase

FAKE = Path(__file__).parent / "fixtures" / "vip_memo_v2_fake.json"
APP = "11111111-1111-1111-1111-111111111111"


def memo() -> dict:
    return memo_to_dict(parse_memo(json.loads(FAKE.read_text())))


def usage(cost=0.1):
    return SimpleNamespace(input_tokens=10, output_tokens=20, reasoning_tokens=5,
                           web_searches=1, cost_usd=cost)


def test_create_version_increments():
    c = FakeSupabase()
    a = store.create_memo_version(c, APP, "sip", None)
    b = store.create_memo_version(c, APP, "sip", "u1")
    assert (a["version"], b["version"]) == (1, 2)
    assert b["status"] == "queued" and b["is_current"] is False and b["triggered_by"] == "u1"
    other = store.create_memo_version(c, "22222222-2222-2222-2222-222222222222", "sip", None)
    assert other["version"] == 1


def test_persist_writes_sections_and_questions():
    c = FakeSupabase()
    row = store.create_memo_version(c, APP, "sip", None)
    m = memo()
    store.persist_memo(c, row["id"], m)
    got = store.get_memo(c, row["id"])
    assert got["status"] == "ready" and got["is_current"] is True
    assert got["memo_json"] == m
    assert got["rec_verdict"] == m["recommendation"]["verdict"]
    assert got["ask_value"] == m["snapshot"]["ask"]["value"]
    assert got["name"] == m["name"]
    secs = [s for s in c.tables["vip_memo_sections"] if s["memo_id"] == row["id"]]
    assert sorted(s["section_key"] for s in secs) == sorted(SECTION_KEYS)
    assert {s["section_key"]: s["position"] for s in secs} == {k: i for i, k in enumerate(SECTION_KEYS)}
    assert secs[0]["body"] == m["sections"][secs[0]["section_key"]]
    qs = [q for q in c.tables["vip_memo_questions"] if q["memo_id"] == row["id"]]
    assert [q["question"] for q in sorted(qs, key=lambda q: q["position"])] == m["questions"]


def test_persist_flips_current_to_new_version():
    c = FakeSupabase()
    a = store.create_memo_version(c, APP, "sip", None)
    store.persist_memo(c, a["id"], memo())
    b = store.create_memo_version(c, APP, "sip", None)
    store.persist_memo(c, b["id"], memo())
    assert store.get_memo(c, a["id"])["is_current"] is False
    assert store.current_ready(c, APP)["id"] == b["id"]
    assert [r["version"] for r in store.latest_for_app(c, APP)] == [2, 1]


def test_spent_usd_sums_runs():
    c = FakeSupabase()
    row = store.create_memo_version(c, APP, "sip", None)
    other = store.create_memo_version(c, APP, "sip", None)
    assert store.spent_usd(c, row["id"]) == 0.0
    store.record_run(c, row["id"], "research", "m", usage(0.25), 100, True, None)
    store.record_run(c, row["id"], "write", "m", usage(0.5), 200, False, "boom")
    store.record_run(c, other["id"], "write", "m", usage(9), 1, True, None)
    assert store.spent_usd(c, row["id"]) == pytest.approx(0.75)
    r = c.tables["vip_memo_runs"][1]
    assert (r["ok"], r["error"], r["web_searches"], r["duration_ms"]) == (False, "boom", 1, 200)


def test_current_ready_ignores_failed():
    c = FakeSupabase()
    a = store.create_memo_version(c, APP, "sip", None)
    store.persist_memo(c, a["id"], memo())
    b = store.create_memo_version(c, APP, "sip", None)
    store.set_status(c, b["id"], "failed", "bad json")
    assert store.current_ready(c, APP)["id"] == a["id"]
    assert store.get_memo(c, b["id"])["error"] == "bad json"
    store.set_status(c, a["id"], "failed")
    assert store.current_ready(c, APP) is None
    assert store.get_memo(c, "nope") is None


def test_record_export_hash():
    c = FakeSupabase()
    row = store.create_memo_version(c, APP, "sip", None)
    data = b"%PDF-fake"
    store.record_export(c, row["id"], "pdf", store.BUCKET, f"{APP}/{row['id']}.pdf", data)
    e = c.tables["vip_memo_exports"][0]
    assert (e["bytes"], e["sha256"], e["format"]) == (len(data), hashlib.sha256(data).hexdigest(), "pdf")
    assert store.BUCKET == "vip-memos"


def test_record_inputs_and_sources():
    c = FakeSupabase()
    row = store.create_memo_version(c, APP, "sip", None)
    store.record_inputs(c, row["id"], [
        SimpleNamespace(kind="file", bucket="b", path="p.pdf", mime="application/pdf",
                        method="pypdf", chars_used=10, truncated=False, skipped_reason=None)])
    store.record_inputs(c, row["id"], [])
    store.record_sources(c, row["id"], [{"section_key": "market", "title": "T", "url": "u"}])
    store.record_sources(c, row["id"], [])
    assert c.tables["vip_memo_inputs"][0]["method"] == "pypdf"
    assert c.tables["vip_memo_sources"][0]["memo_id"] == row["id"]


def test_finalize_cost_writes_sum_and_models():
    c = FakeSupabase()
    row = store.create_memo_version(c, APP, "sip", None)
    store.record_run(c, row["id"], "research", "m1", usage(0.25), 1, True, None)
    store.record_run(c, row["id"], "write", "m2", usage(0.5), 1, True, None)
    assert store.finalize_cost(c, row["id"], {"write": "m2"}) == pytest.approx(0.75)
    got = store.get_memo(c, row["id"])
    assert got["cost_usd"] == pytest.approx(0.75) and got["models"] == {"write": "m2"}


def test_make_current_refuses_non_ready():
    c = FakeSupabase()
    row = store.create_memo_version(c, APP, "sip", None)
    with pytest.raises(RuntimeError, match="must be ready"):
        c.rpc("vip_memo_make_current", {"p_memo_id": row["id"]}).execute()
    assert store.get_memo(c, row["id"])["is_current"] is False
