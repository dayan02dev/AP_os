"""OpenRouter calls for jury enrichment. `:online` variant = web-grounded."""
import os
import httpx

_URL = "https://openrouter.ai/api/v1/chat/completions"
MODEL = "google/gemini-2.5-flash"
MODEL_ONLINE = "google/gemini-2.5-flash:online"
_TIMEOUT = 90.0
_TEMP = 0.2


def _post(messages: list[dict], *, model: str = MODEL, json_mode: bool = False) -> str:
    payload = {"model": model, "messages": messages, "temperature": _TEMP}
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    resp = httpx.Client(timeout=_TIMEOUT).post(
        _URL, json=payload,
        headers={"Authorization": f"Bearer {os.getenv('OPENROUTER_API_KEY', '')}"})
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]
