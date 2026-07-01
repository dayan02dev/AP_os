"""BaseAgent: OpenRouter chat call + optional disk cache + self-correct loop.

Subclasses provide `system_prompt`, `_build_user_message(**ctx)`, and
optionally `parse()`/`validate()`/`mock_result()`. `run()` calls the model,
validates, and — while validation fails — feeds the failures back and retries
up to MAX_CORRECT_ROUNDS, keeping the best-effort (fewest-failures) result.

Reads OPENROUTER_API_KEY from the environment (the worker Lambda may run with
its own env, so this module does NOT import app.config).
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

import httpx

log = logging.getLogger(__name__)


class BaseAgent:
    name: str = "base"
    MAX_CORRECT_ROUNDS: int = 3
    _URL = "https://openrouter.ai/api/v1/chat/completions"
    _MODEL = "google/gemini-2.5-flash"
    _TIMEOUT = 60.0
    _json_mode: bool = False  # subclasses that need JSON output set True

    def __init__(self, *, cache_dir: Path | None = None) -> None:
        self._temp = 0.2
        self._cache_dir = cache_dir

    # ── hooks ──────────────────────────────────────────────────────────
    @property
    def system_prompt(self) -> str:
        raise NotImplementedError

    def _build_user_message(self, **ctx: Any) -> str:
        raise NotImplementedError

    def parse(self, raw: str) -> Any:
        return raw

    def validate(self, result: Any) -> list[str]:
        return []

    def _correction_message(self, failures: list[str]) -> str:
        issue = failures[0] if failures else "output invalid"
        return f"{issue}. Fix it and return only the corrected output."

    def mock_result(self) -> Any:
        raise NotImplementedError

    # ── OpenRouter ─────────────────────────────────────────────────────
    def _call_api(self, messages: list[dict]) -> str:
        api_key = os.getenv("OPENROUTER_API_KEY", "")
        payload: dict[str, Any] = {
            "model": self._MODEL,
            "messages": messages,
            "temperature": self._temp,
        }
        if self._json_mode:
            payload["response_format"] = {"type": "json_object"}
        with httpx.Client(timeout=self._TIMEOUT) as client:
            resp = client.post(
                self._URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]

    # ── disk cache (used by backfill; disabled in the live worker) ──────
    def _cache_path(self, app_id: str) -> Path | None:
        if not self._cache_dir:
            return None
        return self._cache_dir / f"{self.name}_{app_id}.json"

    def _cache_read(self, app_id: str) -> Any:
        p = self._cache_path(app_id)
        if p and p.exists():
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                return None
        return None

    def _cache_write(self, app_id: str, result: Any) -> None:
        p = self._cache_path(app_id)
        if p is None:
            return
        p.parent.mkdir(parents=True, exist_ok=True)
        try:
            p.write_text(json.dumps(result), encoding="utf-8")
        except (OSError, TypeError):
            pass

    # ── run loop ───────────────────────────────────────────────────────
    def run(
        self,
        app_id: str,
        *,
        mock: bool = False,
        no_cache: bool = False,
        **ctx: Any,
    ) -> tuple[Any, str]:
        """Return (result, flags_str). flags_str is "" when valid."""
        if mock:
            result = self.mock_result()
            return result, "; ".join(self.validate(result))

        if not no_cache:
            cached = self._cache_read(app_id)
            if cached is not None:
                return cached, "; ".join(self.validate(cached))

        messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": self._build_user_message(**ctx)},
        ]
        best_result: Any = None
        best_failures: list[str] | None = None

        for round_num in range(self.MAX_CORRECT_ROUNDS + 1):
            raw = self._call_api(messages)
            result = self.parse(raw)
            failures = self.validate(result)
            if best_failures is None or len(failures) < len(best_failures):
                best_result, best_failures = result, failures
            if not failures:
                break
            if round_num < self.MAX_CORRECT_ROUNDS:
                messages = messages + [
                    {"role": "assistant", "content": raw},
                    {"role": "user", "content": self._correction_message(failures)},
                ]

        if not no_cache:
            self._cache_write(app_id, best_result)
        return best_result, "; ".join(best_failures or [])
