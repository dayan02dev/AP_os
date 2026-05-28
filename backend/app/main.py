"""FastAPI app entrypoint.

Wires together (in middleware order, outermost → innermost):

  SecurityHeadersMiddleware   every response gets CSP-lite, nosniff, HSTS (prod)
  CORSMiddleware              strict allow-list (settings.frontend_origins)
  SlowAPIMiddleware           60/min/IP default + per-route overrides
  RequestContextMiddleware    request_id contextvar + request.start/.end logs
  (app routes)

Plus:
  - Structured JSON logging (utils/logging.py)
  - Sentry init if SENTRY_DSN is set (drops 4xx, attaches user.id + request_id)
  - Mangum handler for AWS Lambda (Phase 9)

Local run:
    uvicorn app.main:app --reload --port 8000
"""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from .config import settings
from .routers import (
    admin,
    admin_users,
    ai_screening,
    application_templates,
    applications,
    auth,
    evidence_files,
    health,
    leadership,
    leadership_actions,
    milestone_files,
    resume,
    reviewer,
    sip_application_templates,
    sip_applications,
    sip_evidence_files,
    sip_milestone_files,
    sip_resume,
    support,
    waitlist,
)
from .utils.logging import configure_logging, request_id_var
from .utils.middleware import RequestContextMiddleware, SecurityHeadersMiddleware
from .utils.rate_limit import limiter

# ─── Logging ────────────────────────────────────────────────────
configure_logging(level=settings.log_level)
log = logging.getLogger(__name__)

# ─── Sentry (optional) ──────────────────────────────────────────
# Drops 4xx errors because those are usually user input mistakes, not bugs
# worth paging on. Attaches user.id via deps.get_current_user and request_id
# from the logging contextvar so every Sentry event is filterable.
def _sentry_before_send(event, hint):
    # Drop HTTPException-driven 4xx events; let 5xx + uncaught exceptions through.
    exc_info = hint.get("exc_info") if hint else None
    if exc_info:
        exc = exc_info[1]
        from fastapi import HTTPException

        if isinstance(exc, HTTPException) and 400 <= exc.status_code < 500:
            return None
    # Tag with request_id if available.
    rid = request_id_var.get()
    if rid and "tags" in event:
        event["tags"]["request_id"] = rid
    elif rid:
        event["tags"] = {"request_id": rid}
    return event


if settings.sentry_dsn:
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.starlette import StarletteIntegration

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.env,
        release=settings.app_version,
        integrations=[StarletteIntegration(), FastApiIntegration()],
        traces_sample_rate=0.1,
        profiles_sample_rate=0.1,
        before_send=_sentry_before_send,
    )
    log.info("sentry initialised", extra={"env": settings.env, "version": settings.app_version})
else:
    log.info("sentry disabled (SENTRY_DSN not set)")

# ─── App ────────────────────────────────────────────────────────
app = FastAPI(
    title="ARTPARK TIR API",
    version=settings.app_version,
    # Disable the OpenAPI UI in production — the docs surface is nonzero
    # attack area; we'll serve it through admin auth later if needed.
    docs_url="/docs" if not settings.is_production else None,
    redoc_url=None,
    openapi_url="/openapi.json" if not settings.is_production else None,
)

# Middleware is applied bottom-up: last registered = outermost. Register in
# the order we want them to wrap (innermost first):
#   innermost) Request context — we want it INSIDE rate-limit so the limiter
#              doesn't attribute 429s to unknown request_ids.
#   then    ) Rate limiting
#   then    ) CORS (needs to run before security headers so preflight works)
#   outer  ) Security headers

# Rate limiting — attach the limiter + 429 handler + middleware.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(RequestContextMiddleware)
app.add_middleware(SlowAPIMiddleware)

# CORS — strict allow-list. `allow_credentials=True` forbids the `*` origin
# anyway; we enumerate exact origins from settings.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.frontend_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    expose_headers=["X-Request-ID"],
    max_age=600,
)

# Security headers — last registered = outermost, so every response gets them.
app.add_middleware(
    SecurityHeadersMiddleware,
    is_production=settings.is_production,
)

# ─── Routers ────────────────────────────────────────────────────
app.include_router(health.router)
app.include_router(auth.router)
# TIR track
app.include_router(applications.router)
app.include_router(milestone_files.router)
app.include_router(evidence_files.router)
app.include_router(resume.router)
app.include_router(application_templates.router)
# SIP track
app.include_router(sip_applications.router)
app.include_router(sip_milestone_files.router)
app.include_router(sip_evidence_files.router)
app.include_router(sip_resume.router)
app.include_router(sip_application_templates.router)
# Shared
app.include_router(support.router)
app.include_router(waitlist.router)
app.include_router(admin.router)
app.include_router(admin_users.router)
app.include_router(ai_screening.router)
app.include_router(leadership.router)
app.include_router(leadership_actions.router)
app.include_router(reviewer.router)

log.info(
    "app ready",
    extra={
        "env": settings.env,
        "version": settings.app_version,
        "cors_origins": settings.frontend_origins,
        "rate_limit_default": settings.rate_limit_default,
        "sentry": bool(settings.sentry_dsn),
    },
)

# ─── Lambda adapter (Phase 9) ───────────────────────────────────
try:
    from mangum import Mangum

    handler = Mangum(app, lifespan="off")
except ImportError:  # pragma: no cover
    handler = None
