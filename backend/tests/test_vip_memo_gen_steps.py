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


class _Runs:
    def __init__(self):
        self.rows = {}

    def start(self, step, model, estimate_usd):
        rid = len(self.rows)
        self.rows[rid] = {"step": step, "model": model, "cost": estimate_usd, "ok": None}
        return rid

    def finish(self, run_id, model, usage, duration_ms, ok, error):
        self.rows[run_id].update(cost=usage.cost_usd, ok=ok, error=error)


    def steps(self):
        return [r["step"] for r in self.rows.values()]


def test_research_uses_web_plugin_and_caps_searches(calls):
    cfg = load_config()
    body = json.dumps({"market": [{"title": "T", "publisher": "P", "url": "https://a.com/x",
                                   "year": 2025, "claim": "$5B"}],
                       "competitors": [{"companies": [{"name": "Co", "url": "https://b.com"}]}]})
    calls["queue"].append(_res(body, annotations=[
        {"type": "url_citation", "url_citation": {"url": "https://c.com", "title": "C"}},
        {"type": "url_citation", "url_citation": {"url": "https://a.com/x"}}]))
    cb = _Runs()
    budget = Budget(1.0)
    out = research.run({"name": "X"}, cfg, budget, cb)
    c = calls["calls"][0]
    assert c["model"] == cfg.research_model
    assert c["plugins"] == [{"id": "web", "engine": "native", "max_results": cfg.max_searches}]
    assert c["zdr"] is False
    assert c["response_format"] == {"type": "json_object"}
    assert c["max_tokens"] == 6000
    keys = {(s["url"], s["section_key"]) for s in out.sources}
    assert keys == {("https://a.com/x", "market"), ("https://b.com", "competitors"),
                    ("https://c.com", "market")}
    assert cb.steps() == ["research"]
    assert budget.spent_usd == pytest.approx(0.01)


def test_research_failure_returns_empty(calls):
    calls["queue"].append(OpenRouterError("boom"))
    cb = _Runs()
    out = research.run({"name": "X"}, load_config(), Budget(1.0), cb)
    assert out.sources == [] and out.json_text == ""
    assert [(r["step"], r["ok"]) for r in cb.rows.values()] == [("research", False)]
    # budget failure too: no call at all
    out = research.run({"name": "X"}, load_config(), Budget(1.0, spent_usd=1.0), cb)
    assert out.sources == [] and len(calls["calls"]) == 1


def test_writer_valid_first_try(calls):
    data = json.loads(FAKE.read_text())
    data.update(version=1, prepared_by="evil", generated_at="1999")
    calls["queue"].append(_res(json.dumps(data)))
    cb = _Runs()
    memo = writer.write(MSGS, load_config(), Budget(1.0), cb)
    assert memo["version"] == 2
    assert memo["prepared_by"] == "ARTPARK VIP memo generator"
    assert memo["generated_at"] != "1999" and "T" in memo["generated_at"]
    assert len(calls["calls"]) == 1
    assert calls["calls"][0]["reasoning_effort"] == "medium"
    assert calls["calls"][0]["response_format"] == {"type": "json_object"}
    assert calls["calls"][0].get("zdr", True) is True
    assert cb.steps() == ["write"]


def test_one_repair_then_fail(calls):
    calls["queue"] += [_res('{"name": "x"}'), _res('{"name": "x"}')]
    cb = _Runs()
    budget = Budget(1.0)
    with pytest.raises(MemoValidationError):
        writer.write(MSGS, load_config(), budget, cb)
    assert len(calls["calls"]) == 2
    repair_msgs = calls["calls"][1]["messages"]
    assert repair_msgs[:2] == MSGS and repair_msgs[2]["role"] == "assistant"
    assert "Validation errors" in repair_msgs[3]["content"]
    assert cb.steps() == ["write", "repair"]
    assert budget.spent_usd == pytest.approx(0.02)


def test_repair_succeeds(calls):
    calls["queue"] += [_res("not json at all"), _res(FAKE.read_text())]
    memo = writer.write(MSGS, load_config(), Budget(1.0), _Runs())
    assert memo["version"] == 2 and len(calls["calls"]) == 2


def test_writer_checks_budget_before_call(calls):
    with pytest.raises(BudgetExceeded):
        writer.write(MSGS, load_config(), Budget(1.0, spent_usd=1.0), _Runs())
    assert calls["calls"] == []


def test_writer_unpriced_model_fails_closed(calls):
    cfg = load_config().__class__(**{**load_config().__dict__, "writer_model": "x/unknown"})
    with pytest.raises(KeyError):
        writer.write(MSGS, cfg, Budget(1.0), _Runs())
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


def test_research_estimate_includes_searches(calls):
    from app.services.vip_memo_gen.budget import estimate_cost

    cfg = load_config()
    base = estimate_cost(cfg.research_model, 1000, 6000)
    per = 0.01 + 15000 * 2.0 / 1e6
    assert research.estimate(cfg, 1000) == pytest.approx(base + cfg.max_searches * per)
    # a budget that covers tokens but not the searches makes no call
    out = research.run({"name": "X"}, cfg, Budget(base + 0.05), _Runs())
    assert out.sources == [] and calls["calls"] == []


def test_paid_call_rows_and_failure_costs(calls):
    runs = _Runs()
    calls["queue"] += [OpenRouterError("HTTP 400", status=400),
                       OpenRouterError("read timeout", maybe_billed=True)]
    b = Budget(1.0)
    with pytest.raises(OpenRouterError):
        writer.write(MSGS, load_config(), b, runs)
    with pytest.raises(OpenRouterError):
        writer.write(MSGS, load_config(), b, runs)
    first, second = runs.rows.values()
    assert first["ok"] is False and first["cost"] == 0
    assert second["ok"] is False and second["cost"] > 0  # may be billed: keeps the estimate
    assert b.spent_usd == pytest.approx(second["cost"])


def test_research_reraises_deadline(calls):
    from app.services.vip_memo_gen.budget import Deadline, DeadlineExceeded

    with pytest.raises(DeadlineExceeded):
        research.run({"name": "X"}, load_config(), Budget(1.0), _Runs(), Deadline(60_000))
    assert calls["calls"] == []


def test_deadline_call_timeout():
    from app.services.vip_memo_gen.budget import Deadline, DeadlineExceeded

    assert Deadline(None).call_timeout() == 600
    assert Deadline(900_000).call_timeout() == 600
    assert Deadline(300_000).call_timeout() == pytest.approx(255, abs=1)
    with pytest.raises(DeadlineExceeded):
        Deadline(119_000).call_timeout()


def test_writer_messages_embed_schema_once_outside_documents():
    from app.services.vip_memo_gen.prompts import render_writer_messages
    from app.services.vip_memo_gen.schema import writer_json_schema
    msgs = render_writer_messages("app", [("a.pdf", "text")], "{}")
    user = msgs[1]["content"]
    schema_text = json.dumps(writer_json_schema(), separators=(",", ":"))
    assert user.count("<schema>") == 1 and user.count("</schema>") == 1
    assert user.count(schema_text) == 1
    assert "The JSON must validate against this JSON Schema." in user
    assert user.index("<schema>") > user.index("</documents>")
    assert user.index("<schema>") > user.index("</research>")
