"""OpenRouter chat client with usage/cost accounting for the memo generator."""
from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

URL = "https://openrouter.ai/api/v1/chat/completions"
PROVIDER_PREFS = {"data_collection": "deny", "zdr": True, "require_parameters": True}
# USD per million tokens: (input, output)
PRICES: dict[str, tuple[float, float]] = {
    "anthropic/claude-opus-5.5": (4.0, 20.0),
    "anthropic/claude-sonnet-5.5": (2.0, 10.0),
    "anthropic/claude-haiku-5.5": (0.10, 0.50),
}
_BACKOFF = (2, 8)


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0
    reasoning_tokens: int = 0
    web_searches: int = 0
    cost_usd: float = 0.0


@dataclass
class LlmResult:
    text: str
    annotations: list[dict]
    usage: Usage
    model: str
    raw: dict = field(default_factory=dict)


class OpenRouterError(RuntimeError):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


def _text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            p.get("text", "") if isinstance(p, dict) else str(p) for p in content
            if not isinstance(p, dict) or p.get("type", "text") == "text"
        )
    return ""


def _parse(model: str, data: dict) -> LlmResult:
    try:
        msg = data["choices"][0]["message"]
    except (KeyError, IndexError, TypeError) as e:
        raise OpenRouterError(f"malformed OpenRouter response: {e}") from e
    u = data.get("usage") or {}
    inp = int(u.get("prompt_tokens") or 0)
    out = int(u.get("completion_tokens") or 0)
    cost = u.get("cost")
    if cost is None:
        pin, pout = PRICES.get(model, (0.0, 0.0))
        cost = (inp * pin + out * pout) / 1_000_000
    usage = Usage(
        input_tokens=inp,
        output_tokens=out,
        reasoning_tokens=int((u.get("completion_tokens_details") or {}).get("reasoning_tokens") or 0),
        web_searches=int((u.get("server_tool_use") or {}).get("web_search_requests") or 0),
        cost_usd=float(cost),
    )
    return LlmResult(_text(msg.get("content")), msg.get("annotations") or [], usage,
                     data.get("model") or model, data)


def chat(
    model: str,
    messages: list[dict],
    *,
    max_tokens: int,
    reasoning_effort: str | None = None,
    response_format: dict | None = None,
    plugins: list[dict] | None = None,
    timeout: float = 600.0,
    transport: httpx.BaseTransport | None = None,
) -> LlmResult:
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "provider": dict(PROVIDER_PREFS),
    }
    if reasoning_effort:
        payload["reasoning"] = {"effort": reasoning_effort}
    if response_format:
        payload["response_format"] = response_format
    if plugins:
        payload["plugins"] = plugins
    headers = {
        "Authorization": f"Bearer {os.getenv('OPENROUTER_API_KEY', '')}",
        "Content-Type": "application/json",
    }
    last: OpenRouterError | None = None
    with httpx.Client(timeout=timeout, transport=transport) as client:
        for attempt in range(len(_BACKOFF) + 1):
            try:
                resp = client.post(URL, headers=headers, json=payload)
            except httpx.TransportError as e:
                last = OpenRouterError(f"connection error: {e}")
            else:
                if resp.status_code < 400:
                    try:
                        data = resp.json()
                    except ValueError as e:
                        raise OpenRouterError("non-JSON OpenRouter response") from e
                    return _parse(model, data)
                err = OpenRouterError(
                    f"OpenRouter HTTP {resp.status_code}: {resp.text[:300]}", resp.status_code)
                if resp.status_code != 429 and resp.status_code < 500:
                    raise err
                last = err
            if attempt < len(_BACKOFF):
                time.sleep(_BACKOFF[attempt])
    assert last is not None
    raise last
