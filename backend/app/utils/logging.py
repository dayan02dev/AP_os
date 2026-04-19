"""Structured JSON logging.

Every log line is a single JSON object so CloudWatch Logs Insights (in prod)
can parse them directly. Extra fields passed via `logger.info("...", extra={...})`
are merged into the top-level object.
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import UTC, datetime
from typing import Any

_RESERVED = {
    "args", "asctime", "created", "exc_info", "exc_text", "filename", "funcName",
    "levelname", "levelno", "lineno", "message", "module", "msecs", "msg", "name",
    "pathname", "process", "processName", "relativeCreated", "stack_info",
    "thread", "threadName", "taskName",
}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        log: dict[str, Any] = {
            "ts": datetime.now(UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if record.exc_info:
            log["exc"] = self.formatException(record.exc_info)

        # Merge any fields passed via `extra={...}` on the log call.
        for key, val in record.__dict__.items():
            if key not in _RESERVED and not key.startswith("_"):
                # Only include JSON-serialisable extras; fall back to repr.
                try:
                    json.dumps(val)
                    log[key] = val
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
    # double-logging with different formats.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        lg = logging.getLogger(name)
        lg.handlers.clear()
        lg.propagate = True
