import json
from pathlib import Path

import pytest

from app.services.vip_memo_gen import openrouter, research, writer
from app.services.vip_memo_gen.budget import Budget, BudgetExceeded
from app.services.vip_memo_gen.config import load_config
from app.services.vip_memo_gen.openrouter import LlmResult, OpenRouterError, Usage
from app.services.vip_memo_gen.schema import MemoValidationError

FAKE = Path(__file__).parent / "fixtures" / "vip_memo_v2_fake.json"
MSGS = [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}]


def _res(text, cost=0.01, annotations=None):
    return LlmResult(text, annotations or [], Usage(cost_usd=cost), "m")


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


def _usage_log():
    seen = []
    return seen, lambda step, r, ms: seen.append((step, r, ms))


def test_research_uses_web_plugin_and_caps_searches(calls):
    cfg = load_config()
    body = json.dumps({"market": [{"title": "T", "publisher": "P", "url": "https://a.com/x",
                                   "year": 2025, "claim": "$5B"}],
                       "competitors": [{"companies": [{"name": "Co", "url": "https://b.com"}]}]})
    calls["queue"].append(_res(body, annotations=[
        {"type": "url_citation", "url_citation": {"url": "https://c.com", "title": "C"}},
        {"type": "url_citation", "url_citation": {"url": "https://a.com/x"}}]))
    seen, cb = _usage_log()
    budget = Budget(1.0)
    out = research.run({"name": "X"}, cfg, budget, cb)
    c = calls["calls"][0]
    assert c["model"] == cfg.research_model
    assert c["plugins"] == [{"id": "web", "engine": "native", "max_results": cfg.max_searches}]
    assert c["response_format"] == {"type": "json_object"}
    assert c["max_tokens"] == 6000
    keys = {(s["url"], s["section_key"]) for s in out.sources}
    assert keys == {("https://a.com/x", "market"), ("https://b.com", "competitors"),
                    ("https://c.com", "market")}
    assert [s[0] for s in seen] == ["research"]
    assert budget.spent_usd == pytest.approx(0.01)


def test_research_failure_returns_empty(calls):
    calls["queue"].append(OpenRouterError("boom"))
    seen, cb = _usage_log()
    out = research.run({"name": "X"}, load_config(), Budget(1.0), cb)
    assert out.sources == [] and out.json_text == ""
    # budget failure too: no call at all
    out = research.run({"name": "X"}, load_config(), Budget(1.0, spent_usd=1.0), cb)
    assert out.sources == [] and len(calls["calls"]) == 1


def test_writer_valid_first_try(calls):
    data = json.loads(FAKE.read_text())
    data.update(version=1, prepared_by="evil", generated_at="1999")
    calls["queue"].append(_res(json.dumps(data)))
    seen, cb = _usage_log()
    memo = writer.write(MSGS, load_config(), Budget(1.0), cb)
    assert memo["version"] == 2
    assert memo["prepared_by"] == "ARTPARK VIP memo generator"
    assert memo["generated_at"] != "1999" and "T" in memo["generated_at"]
    assert len(calls["calls"]) == 1
    assert calls["calls"][0]["reasoning_effort"] == "medium"
    assert calls["calls"][0]["response_format"]["json_schema"]["name"] == "vip_memo_v2"
    assert [s[0] for s in seen] == ["write"]


def test_one_repair_then_fail(calls):
    calls["queue"] += [_res('{"name": "x"}'), _res('{"name": "x"}')]
    seen, cb = _usage_log()
    budget = Budget(1.0)
    with pytest.raises(MemoValidationError):
        writer.write(MSGS, load_config(), budget, cb)
    assert len(calls["calls"]) == 2
    repair_msgs = calls["calls"][1]["messages"]
    assert repair_msgs[:2] == MSGS and repair_msgs[2]["role"] == "assistant"
    assert "Validation errors" in repair_msgs[3]["content"]
    assert [s[0] for s in seen] == ["write", "repair"]
    assert budget.spent_usd == pytest.approx(0.02)


def test_repair_succeeds(calls):
    calls["queue"] += [_res("not json at all"), _res(FAKE.read_text())]
    memo = writer.write(MSGS, load_config(), Budget(1.0), lambda *a: None)
    assert memo["version"] == 2 and len(calls["calls"]) == 2


def test_writer_checks_budget_before_call(calls):
    with pytest.raises(BudgetExceeded):
        writer.write(MSGS, load_config(), Budget(1.0, spent_usd=1.0), lambda *a: None)
    assert calls["calls"] == []


def test_writer_unpriced_model_fails_closed(calls):
    cfg = load_config().__class__(**{**load_config().__dict__, "writer_model": "x/unknown"})
    with pytest.raises(KeyError):
        writer.write(MSGS, cfg, Budget(1.0), lambda *a: None)
    assert calls["calls"] == []


def test_profile_has_no_file_text():
    block = ("Organisation: Acme <b>Robotics</b>\n\nProblem: Farms\nlose crops.\n\n"
             "Solution: " + "x" * 500 + "\n\nTRL: 6\n\nCore technology: drones")
    docs = [("deck.pdf", "SECRET-FILE-TEXT")]
    p = research.profile_from_application(block, docs)
    assert set(p) == {"name", "one_liner", "sector", "segments", "geography"}
    assert "SECRET-FILE-TEXT" not in json.dumps(p)
    assert p["name"] == "Acme bRobotics/b"
    assert "\n" not in p["segments"][0] and p["segments"][0] == "Farms lose crops."
    assert len(p["one_liner"]) <= 300
    assert all("<" not in str(v) and ">" not in str(v) for v in p.values())
