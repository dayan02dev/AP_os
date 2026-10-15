import json
from unittest.mock import patch

import httpx
import pytest
from app.services.vip_memo_gen import openrouter
from app.services.vip_memo_gen.budget import Budget, BudgetExceeded, estimate_cost
from app.services.vip_memo_gen.config import load_config

OPUS = "anthropic/claude-opus-5.5"


def _ok(usage=None, content="hi", annotations=None):
    msg = {"content": content}
    if annotations is not None:
        msg["annotations"] = annotations
    return {"choices": [{"message": msg}], "usage": {"cost": 0.01} if usage is None else usage}


def _transport(handler):
    return httpx.MockTransport(handler)


@pytest.fixture(autouse=True)
def _key(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "k")


def test_sends_provider_prefs_and_reasoning():
    seen = {}

    def h(req):
        seen["body"] = json.loads(req.content)
        seen["auth"] = req.headers["authorization"]
        return httpx.Response(200, json=_ok())

    openrouter.chat(OPUS, [{"role": "user", "content": "x"}], max_tokens=10,
                    reasoning_effort="medium", transport=_transport(h))
    b = seen["body"]
    assert b["provider"]["data_collection"] == "deny"
    assert b["provider"]["zdr"] is True
    assert b["provider"]["require_parameters"] is True
    assert b["reasoning"]["effort"] == "medium"
    assert b["max_tokens"] == 10
    assert seen["auth"] == "Bearer k"


def test_parses_usage_cost():
    usage = {"prompt_tokens": 100, "completion_tokens": 50, "cost": 0.123,
             "completion_tokens_details": {"reasoning_tokens": 20},
             "server_tool_use": {"web_search_requests": 3}}
    ann = [{"type": "url_citation", "url_citation": {"url": "u"}}]
    r = openrouter.chat(OPUS, [], max_tokens=1, transport=_transport(
        lambda req: httpx.Response(200, json=_ok(usage, annotations=ann))))
    assert r.usage.cost_usd == 0.123
    assert (r.usage.input_tokens, r.usage.output_tokens, r.usage.reasoning_tokens) == (100, 50, 20)
    assert r.usage.web_searches == 3
    assert r.annotations == ann


def test_cost_fallback_from_tokens():
    usage = {"prompt_tokens": 1_000_000, "completion_tokens": 100_000}
    r = openrouter.chat(OPUS, [], max_tokens=1, transport=_transport(
        lambda req: httpx.Response(200, json=_ok(usage))))
    assert r.usage.cost_usd == pytest.approx(4 + 2)
    assert r.usage.web_searches == 0
    assert r.annotations == []


def test_content_list_parts():
    parts = [{"type": "text", "text": "a"}, {"type": "text", "text": "b"}]
    r = openrouter.chat(OPUS, [], max_tokens=1, transport=_transport(
        lambda req: httpx.Response(200, json=_ok(content=parts))))
    assert r.text == "ab"


def test_retries_5xx_then_succeeds():
    calls = []

    def h(req):
        calls.append(1)
        return httpx.Response(503) if len(calls) < 3 else httpx.Response(200, json=_ok())

    with patch("app.services.vip_memo_gen.openrouter.time.sleep") as sl:
        r = openrouter.chat(OPUS, [], max_tokens=1, transport=_transport(h))
    assert r.text == "hi" and len(calls) == 3
    assert [c.args[0] for c in sl.call_args_list] == [2, 8]


def test_retries_exhausted_raises():
    with patch("app.services.vip_memo_gen.openrouter.time.sleep"), \
            pytest.raises(openrouter.OpenRouterError) as e:
        openrouter.chat(OPUS, [], max_tokens=1, transport=_transport(
            lambda req: httpx.Response(500)))
    assert e.value.status == 500


def test_4xx_raises_no_retry():
    calls = []

    def h(req):
        calls.append(1)
        return httpx.Response(400, json={"error": "bad"})

    with patch("app.services.vip_memo_gen.openrouter.time.sleep") as sl, \
            pytest.raises(openrouter.OpenRouterError) as e:
        openrouter.chat(OPUS, [], max_tokens=1, transport=_transport(h))
    assert e.value.status == 400 and len(calls) == 1 and not sl.called


def test_budget_blocks_over_ceiling():
    b = Budget(1.0, 0.9)
    b.check(0.1)
    with pytest.raises(BudgetExceeded):
        b.check(0.11)
    b.add(0.05)
    assert b.remaining == pytest.approx(0.05)


def test_estimate_cost_opus():
    assert estimate_cost(OPUS, 400_000, 10_000) == pytest.approx(0.6)


def test_load_config_defaults(monkeypatch):
    for k in ("VIP_MEMO_WRITER_MODEL", "VIP_MEMO_MAX_COST_USD", "VIP_MEMO_MAX_SEARCHES"):
        monkeypatch.delenv(k, raising=False)
    c = load_config()
    assert c.writer_model == OPUS and c.max_cost_usd == 1.0 and c.max_searches == 8


def test_unpriced_model_without_cost_raises():
    with pytest.raises(openrouter.OpenRouterError, match="x/unknown"):
        openrouter.chat("x/unknown", [], max_tokens=1, transport=_transport(
            lambda req: httpx.Response(200, json=_ok({"prompt_tokens": 1, "completion_tokens": 1}))))


def test_missing_usage_raises():
    for body in ({"choices": [{"message": {"content": "x"}}]}, _ok({})):
        with pytest.raises(openrouter.OpenRouterError, match="usage"):
            openrouter.chat(OPUS, [], max_tokens=1, transport=_transport(
                lambda req, b=body: httpx.Response(200, json=b)))


def test_read_timeout_not_retried():
    calls = []

    def h(req):
        calls.append(1)
        raise httpx.ReadTimeout("slow", request=req)

    with patch("app.services.vip_memo_gen.openrouter.time.sleep") as sl, \
            pytest.raises(openrouter.OpenRouterError):
        openrouter.chat(OPUS, [], max_tokens=1, transport=_transport(h))
    assert len(calls) == 1 and not sl.called


def test_connect_error_retried():
    calls = []

    def h(req):
        calls.append(1)
        if len(calls) < 2:
            raise httpx.ConnectError("down", request=req)
        return httpx.Response(200, json=_ok({"cost": 0.1}))

    with patch("app.services.vip_memo_gen.openrouter.time.sleep"):
        assert openrouter.chat(OPUS, [], max_tokens=1, transport=_transport(h)).text == "hi"
    assert len(calls) == 2


@pytest.mark.parametrize("var", ["VIP_MEMO_MAX_COST_USD", "VIP_MEMO_MAX_SEARCHES"])
def test_malformed_config_names_variable(monkeypatch, var):
    monkeypatch.setenv(var, "abc")
    with pytest.raises(ValueError, match=var):
        load_config()


def test_fallback_cost_counts_web_searches():
    usage = {"prompt_tokens": 1000, "completion_tokens": 100,
             "server_tool_use": {"web_search_requests": 3}}
    r = openrouter.chat("anthropic/claude-sonnet-5.5", [], max_tokens=1, transport=_transport(
        lambda req: httpx.Response(200, json=_ok(usage))))
    assert r.usage.web_searches == 3
    assert r.usage.cost_usd == pytest.approx((1000 * 2.0 + 100 * 10.0) / 1e6 + 3 * 0.01)


def test_maybe_billed_flags():
    def raise_timeout(req):
        raise httpx.ReadTimeout("slow", request=req)

    with pytest.raises(openrouter.OpenRouterError) as e:
        openrouter.chat(OPUS, [], max_tokens=1, transport=_transport(raise_timeout))
    assert e.value.maybe_billed
    with pytest.raises(openrouter.OpenRouterError) as e:
        openrouter.chat(OPUS, [], max_tokens=1, transport=_transport(
            lambda req: httpx.Response(200, json={"choices": [{"message": {}}]})))
    assert e.value.maybe_billed  # no usage: ran, cost unknown
    with pytest.raises(openrouter.OpenRouterError) as e:
        openrouter.chat(OPUS, [], max_tokens=1, transport=_transport(
            lambda req: httpx.Response(400, text="bad")))
    assert not e.value.maybe_billed and e.value.status == 400


@pytest.mark.parametrize("value", ["nan", "inf", "-inf", "0", "-1"])
def test_max_cost_must_be_finite_positive(monkeypatch, value):
    monkeypatch.setenv("VIP_MEMO_MAX_COST_USD", value)
    with pytest.raises(ValueError, match="VIP_MEMO_MAX_COST_USD"):
        load_config()


def test_max_searches_not_negative(monkeypatch):
    monkeypatch.setenv("VIP_MEMO_MAX_SEARCHES", "-1")
    with pytest.raises(ValueError, match="VIP_MEMO_MAX_SEARCHES"):
        load_config()
    monkeypatch.setenv("VIP_MEMO_MAX_SEARCHES", "0")
    assert load_config().max_searches == 0


def test_writer_max_tokens_default():
    assert load_config().writer_max_tokens == 20000
