"""Tests for utils/logging.py — redaction + structured format + contextvars."""

from __future__ import annotations

import json
import logging
from io import StringIO

import pytest

from app.utils.logging import (
    JsonFormatter,
    _redact_str,
    _redact_value,
    configure_logging,
    request_id_var,
    user_id_var,
)


# ─── Redaction primitives ──────────────────────────────────────────

def test_redact_jwt():
    token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload_blob.sig_blob"
    assert token not in _redact_str(f"auth failed with token={token}")


def test_redact_authorization_header():
    # "authorization: Bearer <anything>" should be scrubbed.
    out = _redact_str("Authorization: Bearer s3cretvalue")
    assert "s3cretvalue" not in out
    assert "[REDACTED]" in out


def test_redact_email():
    assert "alice@example.com" not in _redact_str("user alice@example.com just signed up")


def test_redact_phone():
    out = _redact_str("call +91 98765 43210 if lost")
    assert "98765" not in out


def test_redact_value_sensitive_key():
    assert _redact_value("access_token", "eyJ.whatever.sig") == "[REDACTED]"
    assert _redact_value("password", "hunter2") == "[REDACTED]"
    assert _redact_value("api_key", "k_123") == "[REDACTED]"


def test_redact_value_passes_through_innocuous():
    assert _redact_value("user_id", "abc-123") == "abc-123"
    assert _redact_value("count", 7) == 7


def test_redact_value_recurses_into_dicts():
    nested = {"headers": {"authorization": "Bearer x", "other": "plain"}}
    out = _redact_value("headers", nested["headers"])
    assert out["authorization"] == "[REDACTED]"
    assert out["other"] == "plain"


# ─── JsonFormatter ─────────────────────────────────────────────────

def _format_record(**kwargs) -> dict:
    rec = logging.LogRecord(
        name=kwargs.get("name", "test"),
        level=logging.INFO,
        pathname="x.py",
        lineno=1,
        msg=kwargs.get("msg", "hello"),
        args=(),
        exc_info=None,
    )
    for k, v in kwargs.get("extra", {}).items():
        setattr(rec, k, v)
    return json.loads(JsonFormatter().format(rec))


def test_json_formatter_emits_valid_json():
    data = _format_record(msg="ping")
    assert data["msg"] == "ping"
    assert data["level"] == "INFO"
    assert "ts" in data


def test_json_formatter_merges_extra_fields():
    data = _format_record(msg="req", extra={"route": "/health", "duration_ms": 12})
    assert data["route"] == "/health"
    assert data["duration_ms"] == 12


def test_json_formatter_redacts_extra_sensitive_key():
    data = _format_record(msg="ok", extra={"access_token": "eyJ.body.sig"})
    assert data["access_token"] == "[REDACTED]"


def test_json_formatter_redacts_msg():
    data = _format_record(msg="user alice@example.com logged in")
    assert "alice@example.com" not in data["msg"]


def test_json_formatter_includes_contextvars():
    tok1 = request_id_var.set("req-xyz")
    tok2 = user_id_var.set("user-42")
    try:
        data = _format_record(msg="hi")
        assert data["request_id"] == "req-xyz"
        assert data["user_id"] == "user-42"
    finally:
        request_id_var.reset(tok1)
        user_id_var.reset(tok2)


def test_json_formatter_non_serialisable_extra():
    class Weird:
        def __repr__(self):
            return "<weird>"
    data = _format_record(msg="hi", extra={"obj": Weird()})
    assert data["obj"] == "<weird>"


# ─── configure_logging ─────────────────────────────────────────────

def test_configure_logging_idempotent():
    configure_logging("INFO")
    configure_logging("INFO")  # must not double-install handlers
    root = logging.getLogger()
    # Exactly one handler that emits our JsonFormatter output.
    assert len(root.handlers) == 1
    assert isinstance(root.handlers[0].formatter, JsonFormatter)


def test_configure_logging_sets_level():
    configure_logging("DEBUG")
    assert logging.getLogger().level == logging.DEBUG
    configure_logging("INFO")  # reset


@pytest.fixture(autouse=True)
def _reset_logging_state():
    """Ensure logging state is stable across tests."""
    yield
    configure_logging("INFO")
