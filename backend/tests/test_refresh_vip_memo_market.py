"""Backfill script: retag and market refresh of stored memos (hermetic)."""
import copy
import json
from pathlib import Path

from app.services.vip_memo_gen import market, store
from scripts import refresh_vip_memo_market as script

from tests.fixtures.fake_supabase import FakeSupabase

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "vip_memo_v2_fake.json").read_text())
APP = "55555555-5555-5555-5555-555555555555"


def _client(memo):
    c = FakeSupabase({"sip_applications": [{"id": APP, "status": "evaluated"}]})
    row = store.create_memo_version(c, APP, "sip", None)
    store.persist_memo(c, row["id"], memo)
    return c, store.get_memo(c, row["id"])


def _legacy_memo():
    memo = copy.deepcopy(FIXTURE)
    memo["snapshot"]["ask"]["value"] = "[To be confirmed]"
    memo["sections"]["market"]["total"] = "[To be confirmed]"
    return memo


def test_retag_rewrites_memo_and_section_rows(monkeypatch):
    exported = []
    monkeypatch.setattr(script, "_export", lambda c, mid, app, memo: exported.append(mid))
    c, row = _client(_legacy_memo())
    assert script._retag_one(c, row, apply=True) == "retagged=7"
    saved = store.get_memo(c, row["id"])
    assert "[To be confirmed]" not in json.dumps(saved["memo_json"])
    assert saved["ask_value"] == "[Needs founder verification]"
    body = [s for s in c.tables["vip_memo_sections"] if s["section_key"] == "market"][0]["body"]
    assert body["total"] == "[Needs AI cross-verification]"
    assert saved["is_current"] is True and saved["status"] == "ready"
    assert exported == [row["id"]]


def test_retag_dry_run_writes_nothing(monkeypatch):
    monkeypatch.setattr(script, "_export", lambda *a: (_ for _ in ()).throw(AssertionError))
    c, row = _client(_legacy_memo())
    assert script._retag_one(c, row, apply=False) == "retagged=7"
    assert "[To be confirmed]" in json.dumps(store.get_memo(c, row["id"])["memo_json"])


def test_market_refresh_saves_in_place(monkeypatch):
    monkeypatch.setattr(script, "_export", lambda *a: None)
    new = copy.deepcopy(FIXTURE)
    new["sections"]["market"]["rows"][0]["slice_high_cr"] = 99
    monkeypatch.setattr(market, "refresh", lambda memo, block, cfg, budget, runs:
                        market.MarketResult(new, [{"section_key": "market", "url": "https://r.com"}],
                                            [], "w/model"))
    c, row = _client(_legacy_memo())
    msg = script._market_one(c, row, apply=True)
    assert msg.startswith("market no_size")
    saved = store.get_memo(c, row["id"])
    assert saved["version"] == row["version"] and saved["is_current"] is True
    assert saved["memo_json"]["sections"]["market"]["rows"][0]["slice_high_cr"] == 99
    assert saved["models"]["market_writer"] == "w/model"
    assert c.tables["vip_memo_sources"][-1]["url"] == "https://r.com"
