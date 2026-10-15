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
    assert c["plugins"] == [{"id": "web", "engine": "exa", "max_results": 10}]
    assert c["zdr"] is False
    assert c["response_format"] == {"type": "json_object"}
    assert c["max_tokens"] == 8000
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


DOC_MSGS = [{"role": "system", "content": "s"}, {"role": "user", "content": "DOCUMENT-TEXT-XYZ"}]


def test_one_repair_then_fail(calls):
    calls["queue"] += [_res('{"name": "x", "headline": "RAW-1"}'), _res('{"name": "x", "headline": "RAW-2"}')]
    cb = _Runs()
    budget = Budget(1.0)
    with pytest.raises(MemoValidationError) as e:
        writer.write(DOC_MSGS, load_config(), budget, cb)
    assert len(calls["calls"]) == 2
    rep = calls["calls"][1]
    msgs = rep["messages"]
    assert [m["role"] for m in msgs] == ["system", "user"]
    assert msgs[0]["content"] == "You fix JSON. Return only the corrected JSON object."
    assert "Validation errors" in msgs[1]["content"] and "RAW-1" in msgs[1]["content"]
    assert "DOCUMENT-TEXT-XYZ" not in json.dumps(msgs)  # no source documents in the repair
    assert rep["reasoning_effort"] == "low"
    assert rep["max_tokens"] == load_config().writer_max_tokens
    assert rep["response_format"] == {"type": "json_object"}
    assert cb.steps() == ["write", "repair"]
    assert budget.spent_usd == pytest.approx(0.02)
    # the last raw model text (and the first) travel with the error for storage
    assert "RAW-2" in e.value.raw and "RAW-1" in e.value.raw_write
    assert e.value.messages


def test_writer_never_uses_json_schema_response_format(calls):
    calls["queue"] += [_res("not json"), _res(FAKE.read_text())]
    writer.write(MSGS, load_config(), Budget(1.0), _Runs())
    for c in calls["calls"]:
        assert c["response_format"] == {"type": "json_object"}
        assert "json_schema" not in json.dumps(c["response_format"])


def test_salvageable_output_needs_no_repair_and_reports_notes(calls):
    d = json.loads(FAKE.read_text())
    del d["sections"]["tech"]
    d["headline"] = 5
    calls["queue"].append(_res(json.dumps(d)))
    notes = []
    memo = writer.write(MSGS, load_config(), Budget(1.0), _Runs(), notes=notes)
    assert len(calls["calls"]) == 1
    assert memo["sections"]["tech"]["rows"] == [] and memo["headline"] == "5"
    assert any("sections.tech" in n for n in notes) and any("headline" in n for n in notes)


def test_repair_over_budget_keeps_raw(calls):
    calls["queue"].append(_res('{"name": "", "headline": "RAW-W"}', cost=0.0))
    cfg = load_config()
    # leave enough for the write estimate only: the repair (input = raw + errors) cannot fit
    from app.services.vip_memo_gen.budget import estimate_cost
    write_est = estimate_cost(cfg.writer_model, sum(len(m["content"]) for m in MSGS), cfg.writer_max_tokens)
    b = Budget(write_est + 0.0001)
    with pytest.raises(BudgetExceeded) as e:
        writer.write(MSGS, cfg, b, _Runs())
    assert len(calls["calls"]) == 1
    assert "RAW-W" in e.value.raw and e.value.messages


def test_repair_openrouter_error_keeps_raw(calls):
    calls["queue"] += [_res('{"name": ""}'), OpenRouterError("HTTP 500", status=500)]
    with pytest.raises(OpenRouterError) as e:
        writer.write(MSGS, load_config(), Budget(1.0), _Runs())
    assert e.value.raw == '{"name": ""}'


def test_truncated_but_salvageable_output_is_kept(calls):
    d = json.loads(FAKE.read_text())
    text = json.dumps(d)
    cut = text[: text.index('"risks": {"rows"', text.index('"sections"'))]
    r = _res(cut)
    r.finish_reason = "length"
    calls["queue"].append(r)
    notes = []
    memo = writer.write(MSGS, load_config(), Budget(1.0), _Runs(), notes=notes)
    assert len(calls["calls"]) == 1
    assert memo["sections"]["risks"]["rows"] == []
    assert notes[0] == "output truncated at max_tokens"


def test_validate_returns_memo_and_notes():
    memo, notes = writer.validate(FAKE.read_text())
    assert memo["version"] == 2 and notes == []
    with pytest.raises(MemoValidationError, match="not a JSON object"):
        writer.validate("[1, 2]")


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


def test_research_estimate_exa(calls):
    cfg = load_config()
    expected = 10 * 0.004 + ((1000 / 4 + 8000) * 2.0 + 8000 * 10.0) / 1e6
    assert research.estimate(cfg, 1000) == pytest.approx(expected)
    # a budget below the estimate makes no call
    out = research.run({"name": "X"}, cfg, Budget(0.01), _Runs())
    assert out.sources == [] and calls["calls"] == []


def test_research_estimate_native(calls):
    from app.services.vip_memo_gen.budget import estimate_cost

    cfg = load_config().__class__(**{**load_config().__dict__, "search_engine": "native"})
    base = estimate_cost(cfg.research_model, 1000, 8000)
    per = 0.01 + 15000 * 2.0 / 1e6
    assert research.estimate(cfg, 1000) == pytest.approx(base + cfg.max_searches * per)


def test_research_tolerates_json_fences(calls):
    body = '```json\n' + json.dumps({"market": [{"title": "T", "url": "https://a.com/x"}],
                                      "competitors": []}) + '\n```'
    calls["queue"].append(_res(body))
    out = research.run({"name": "X"}, load_config(), Budget(1.0), _Runs())
    assert [s["url"] for s in out.sources] == ["https://a.com/x"]


def _bad():
    d = json.loads(FAKE.read_text())
    d["name"] = ""
    d["sections"]["tech"]["rows"] = "SECRET-CONTENT"
    return json.dumps(d)


def test_writer_logs_paths_not_content_and_reports_them(calls, caplog):
    import logging
    calls["queue"] += [_res(_bad()), _res(_bad())]
    with (caplog.at_level(logging.WARNING, logger="app.services.vip_memo_gen.writer"),
          pytest.raises(MemoValidationError) as e):
        writer.write(MSGS, load_config(), Budget(1.0), _Runs())
    assert len(calls["calls"]) == 2
    assert str(e.value).startswith("validation: ")
    assert "name" in str(e.value)
    assert "SECRET-CONTENT" not in str(e.value) + caplog.text
    assert "name" in caplog.text
    assert len([r for r in caplog.records if r.levelname == "WARNING"]) == 2


def test_writer_truncated_output_is_obvious_and_skips_repair(calls):
    r = _res('{"version": 2, "name": "X", "sections": {"te')
    r.finish_reason = "length"
    calls["queue"].append(r)
    with pytest.raises(MemoValidationError, match="output truncated at max_tokens"):
        writer.write(MSGS, load_config(), Budget(1.0), _Runs())
    assert len(calls["calls"]) == 1


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
