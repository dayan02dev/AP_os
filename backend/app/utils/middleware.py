"""ASGI middleware for request tracing + security headers.

Kept in utils/ rather than main.py so main.py's surface stays a clean
composition of pieces. Two middlewares live here:

  RequestContextMiddleware
    - Generates a UUID request_id (or honours X-Request-ID from the caller)
    - Populates the logging contextvars (request_id, path, method)
    - Logs request.start at INFO
    - Logs request.end at INFO (2xx/3xx), WARNING (4xx), ERROR (5xx) with
      duration_ms
    - Writes X-Request-ID on the response

  SecurityHeadersMiddleware
    - Sets nosniff, frame-deny, referrer-policy, permissions-policy on every
      response
    - Sets Strict-Transport-Security only when env is production (HSTS in dev
      is a footgun because it pins http→https locally for a year)
    - Strips the Server header
"""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.types import ASGIApp

from .logging import method_var, path_var, request_id_var

log = logging.getLogger("app.request")

_HEADER_REQUEST_ID = "X-Request-ID"


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Any:
        incoming = request.headers.get(_HEADER_REQUEST_ID)
        request_id = incoming if incoming and len(incoming) <= 64 else uuid.uuid4().hex[:16]

        rid_token = request_id_var.set(request_id)
        path_token = path_var.set(request.url.path)
        method_token = method_var.set(request.method)

        client_ip = request.client.host if request.client else None
        t0 = time.perf_counter()

        log.info(
            "request.start",
            extra={
                "event": "request.start",
                "method": request.method,
                "path": request.url.path,
                "client_ip": client_ip,
            },
        )

        response = None
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        finally:
            duration_ms = int((time.perf_counter() - t0) * 1000)
            if response is not None:
                response.headers[_HEADER_REQUEST_ID] = request_id
                # Defensive strip of Server header (starlette sets it to "uvicorn")
                if "server" in response.headers:
                    del response.headers["server"]

            if status_code >= 500:
                severity = logging.ERROR
            elif status_code >= 400:
                severity = logging.WARNING
            else:
                severity = logging.INFO

            log.log(
                severity,
                "request.end",
                extra={
                    "event": "request.end",
                    "method": request.method,
                    "path": request.url.path,
                    "status_code": status_code,
                    "duration_ms": duration_ms,
                },
            )

            # Reset contextvars so any post-middleware work doesn't inherit.
            request_id_var.reset(rid_token)
            path_var.reset(path_token)
            method_var.reset(method_token)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Set standard security headers on every response."""

    def __init__(self, app: ASGIApp, *, is_production: bool = False) -> None:
        super().__init__(app)
        self._is_production = is_production

    async def dispatch(self, request: Request, call_next) -> Any:
        response = await call_next(request)
        h = response.headers
        # Prevent MIME sniffing.
        h.setdefault("X-Content-Type-Options", "nosniff")
        # Disallow framing.
        h.setdefault("X-Frame-Options", "DENY")
        # Send origin+path only on same-origin, origin-only cross-origin.
        h.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        # Deny browser APIs we never need.
        h.setdefault(
            "Permissions-Policy",
            "camera=(), microphone=(), geolocation=()",
        )
        # HSTS only in production — a local-dev 1-year HSTS pin is painful
        # to undo in Chrome.
        if self._is_production:
            h.setdefault(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains",
            )
        # Strip the Server header (starlette/uvicorn sets "uvicorn").
        if "server" in h:
            del h["server"]
        return response
