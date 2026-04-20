"""Structured JSON logging with per-request tracing and PII redaction.

Every log line is a single JSON object so CloudWatch Logs Insights (Phase 9)
can parse them directly — no ingestion rules needed. Extra fields passed via
`logger.info("msg", extra={"foo": 1})` are merged into the top-level object.

Request tracing:
  A middleware in main.py sets `request_id` / `user_id` / `path` / `method`
  on a contextvar at the start of each request. Every log produced during
  that request automatically carries those fields. This lets you grep
  CloudWatch for `request_id=<x>` and get the full trace of what happened.

Redaction:
  JWTs (eyJ…), Authorization headers, email-like strings, and phone-like
  strings are scrubbed from every log message — applies to both the `msg`
  text and any string values in `extra`. Redaction is conservative: it's
  better to over-redact in dev than leak PII in a prod stack trace.
"""

from __future__ import annotations

import contextvars
import json
import logging
import re
import sys
from datetime import UTC, datetime
from typing import Any

# ─── Request context (populated by middleware in main.py) ──────────
# Using contextvars so the values survive async hops without explicit passing.
request_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "request_id", default=None
)
user_id_var: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "user_id", default=None
)
path_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("path", default=None)
method_var: contextvars.ContextVar[str | None] = contextvars.ContextVar("method", default=None)


# ─── Redaction patterns ────────────────────────────────────────────
# Tight enough to catch real leaks, loose enough not to mask harmless tokens
# like user IDs. If something is ambiguous we err toward redacting.
_JWT_RE = re.compile(r"eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_.\-]+")
_AUTH_HEADER_RE = re.compile(r"(?i)\b(authorization\s*[:=]\s*)(bearer\s+)?\S+")
_EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
# Phone: 7–15 digits, optional leading +, optional separators. Tighter than
# the app's own phone validator to minimise false positives.
_PHONE_RE = re.compile(r"(?<!\d)\+?\d[\d\s\-().]{6,18}\d(?!\d)")

_REDACTED = "[REDACTED]"

# Fields we know contain sensitive data — scrub wholesale rather than
# pattern-match the value.
_REDACTED_EXTRA_KEYS = frozenset({
    "access_token", "refresh_token", "token", "password", "authorization",
    "cookie", "api_key", "secret", "service_role_key",
})

# Logger names whose modules produce high-volume noise we don't need.
_QUIET_LOGGERS = ("uvicorn.access",)


def _redact_str(s: str) -> str:
    if not s:
        return s
    s = _AUTH_HEADER_RE.sub(r"\1" + _REDACTED, s)
    s = _JWT_RE.sub(_REDACTED, s)
    s = _EMAIL_RE.sub(_REDACTED, s)
    s = _PHONE_RE.sub(_REDACTED, s)
    return s


def _redact_value(key: str, value: Any) -> Any:
    if key.lower() in _REDACTED_EXTRA_KEYS:
        return _REDACTED
    if isinstance(value, str):
        return _redact_str(value)
    if isinstance(value, dict):
        return {k: _redact_value(k, v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_redact_value(key, v) for v in value]
    return value


_RESERVED = {
    "args", "asctime", "created", "exc_info", "exc_text", "filename", "funcName",
    "levelname", "levelno", "lineno", "message", "module", "msecs", "msg", "name",
    "pathname", "process", "processName", "relativeCreated", "stack_info",
    "thread", "threadName", "taskName", "color_message",
}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        log: dict[str, Any] = {
            "ts": datetime.now(UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "msg": _redact_str(record.getMessage()),
        }

        # Request-scope context from contextvars. Only set when present so the
        # JSON stays compact for startup / background logs.
        if (rid := request_id_var.get()) is not None:
            log["request_id"] = rid
        if (uid := user_id_var.get()) is not None:
            log["user_id"] = uid
        if (path := path_var.get()) is not None:
            log["path"] = path
        if (method := method_var.get()) is not None:
            log["method"] = method

        if record.exc_info:
            log["exc"] = _redact_str(self.formatException(record.exc_info))

        # Merge any fields passed via `extra={...}` on the log call.
        for key, val in record.__dict__.items():
            if key in _RESERVED or key.startswith("_"):
                continue
            if key in log:
                continue
            try:
                json.dumps(val)
                log[key] = _redact_value(key, val)
            except (TypeError, ValueError):
                log[key] = repr(val)

        return json.dumps(log, default=str)


def configure_logging(level: str = "INFO") -> None:
    """Install the JSON formatter on the root logger.

    Idempotent: clears existing handlers first, so calling twice is safe.
    Also quiets uvicorn's default access-log formatter so its output matches.
    """
    root = logging.getLogger()
    for h in list(root.handlers):
        root.removeHandler(h)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root.addHandler(handler)
    root.setLevel(level.upper())

    # uvicorn attaches its own stream handlers; wipe them so we don't get
    # double-logging with different formats. Our own request.start/end
    # events in the middleware give us the info we need.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        lg = logging.getLogger(name)
        lg.handlers.clear()
        lg.propagate = True

    # Silence the access-log spam — we log request.end ourselves.
    for name in _QUIET_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)
