"""Market refresh: re-research + re-write only sections.market of a memo."""
import copy
import json
from pathlib import Path

import pytest
from app.services.vip_memo_gen import market, openrouter
from app.services.vip_memo_gen.budget import Budget
from app.services.vip_memo_gen.config import load_config
from app.services.vip_memo_gen.openrouter import LlmResult, ModelRefusal, Usage
from app.services.vip_memo_gen.schema import MemoValidationError
from app.services.vip_memo_gen.tags import FOUNDER, LEGACY, VERIFY, retag

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "vip_memo_v2_fake.json").read_text())

RESEARCH = json.dumps({"market": [
    {"segment": "Warehouse robots", "scope": "global", "figure": "$4.2B", "year": 2025,
     "publisher": "Mordor Intelligence", "title": "Warehouse Robotics", "url": "https://m.com/r"},
    {"segment": "Me", "url": "https://www.linkedin.com/in/me", "figure": "CEO"},
]})

WRITTEN = json.dumps({
    "market": {
        "rows": [{"segment": "Warehouse robots", "global_size": "$4.2B (2025, global)",
                  "slice_low_cr": 10, "slice_high_cr": 40, "slice_label": "~₹10–40 Cr/yr",
                  "rationale": ["India ~6% of $4.2B ≈ ₹2,200 Cr at USD 1 = ₹88.", "AI estimate."],
                  "source": "Mordor Intelligence, 2025"},
                 {"segment": "Cold chain", "global_size": VERIFY, "slice_low_cr": "2",
                  "slice_high_cr": 5, "slice_label": "~₹2–5 Cr/yr", "rationale": "Bottom-up.",
                  "source": "AI estimate from application data"}],
        "total": "₹12–45 Cr/yr by about year 5 (USD 1 = ₹88)",
        "beachhead": ["Warehouse robots: shortest sales cycle."],
        "tam_note": "",
    },
    "takeaway": "Realistic ₹12–45 Cr/yr.",
    "source": "Research (Mordor 2025); application",
})


def _res(text, cost=0.01):
    return LlmResult(text, [], Usage(cost_usd=cost), "m")


class _Runs:
    def __init__(self):
        self.steps = []

    def start(self, step, model, estimate_usd):
        self.steps.append(step)
        return len(self.steps)

    def finish(self, *a, **k):
        pass


@pytest.fixture
def calls(monkeypatch):
    log = {"calls": [], "queue": []}

    def fake_chat(model, messages, **kw):
        log["calls"].append({"model": model, "messages": messages, **kw})
        item = log["queue"].pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    monkeypatch.setattr(openrouter, "chat", fake_chat)
    return log


def _memo():
    memo = copy.deepcopy(FIXTURE)
    memo["snapshot"]["ask"]["value"] = LEGACY
    memo["recommendation"] = {"verdict": "APPROVE", "summary": "secret"}
    return memo


def test_refresh_replaces_only_market_and_retags(calls):
    calls["queue"] += [_res(RESEARCH), _res(WRITTEN)]
    memo = _memo()
    runs = _Runs()
    out = market.refresh(memo, "Problem: x", load_config(), Budget(0.6), runs)

    m = out.memo["sections"]["market"]
    assert [r["segment"] for r in m["rows"]] == ["Warehouse robots", "Cold chain"]
    assert m["rows"][1]["slice_low_cr"] == 2.0  # numeric string coerced
    assert out.memo["takeaways"]["market"] == "Realistic ₹12–45 Cr/yr."
    assert out.memo["sources"]["market"] == "Research (Mordor 2025); application"
    tagged, _ = retag(memo)
    for k in ("what", "team", "funds", "competitors"):
        assert out.memo["sections"][k] == tagged["sections"][k]
    assert out.memo["snapshot"]["ask"]["value"] == FOUNDER   # whole memo retagged
    assert memo["sections"]["market"] == FIXTURE["sections"]["market"]  # input untouched
    assert runs.steps == ["market_research", "market_write"]
    assert [s["url"] for s in out.sources] == ["https://m.com/r"]  # social dropped


def test_refresh_research_call_and_writer_context(calls):
    calls["queue"] += [_res(RESEARCH), _res(WRITTEN)]
    cfg = load_config()
    market.refresh(_memo(), "Problem: x", cfg, Budget(0.6), _Runs())
    research_call, write_call = calls["calls"]
    assert research_call["plugins"][0]["max_results"] == market.MARKET_SEARCHES
    assert "Customer segments" in research_call["messages"][0]["content"]
    assert write_call["model"] == cfg.writer_model
    assert write_call["max_tokens"] == market.MARKET_MAX_TOKENS
    user = write_call["messages"][1]["content"]
    assert "Mordor Intelligence" in user and "<memo>" in user
    assert "secret" not in user  # the internal recommendation never reaches the model
    assert "USD 1 = ₹88" in user


def test_refresh_falls_back_on_refusal(calls):
    calls["queue"] += [_res(RESEARCH), ModelRefusal("no"), _res(WRITTEN)]
    cfg = load_config()
    out = market.refresh(_memo(), "", cfg, Budget(0.6), _Runs())
    assert calls["calls"][2]["model"] == cfg.fallback_model
    assert out.writer == cfg.fallback_model


def test_refresh_raises_when_no_rows(calls):
    calls["queue"] += [_res(RESEARCH), _res(json.dumps({"market": {"rows": []}}))]
    with pytest.raises(MemoValidationError):
        market.refresh(_memo(), "", load_config(), Budget(0.6), _Runs())


def test_profile_uses_memo_segments_without_placeholders():
    memo = _memo()
    memo["sections"]["market"]["rows"] = [{"segment": "A"}, {"segment": LEGACY}]
    memo["sections"]["competitors"]["groups"] = [{"segment": "B", "rows": []}, {"segment": "A", "rows": []}]
    p = market.profile_from_memo(memo)
    assert p["segments"] == ["A", "B"]
    assert p["name"] == memo["name"]
