"""FastAPI app entrypoint.

Wires together:
  - CORS (strict, allow-list from settings.cors_origins)
  - Structured JSON logging
  - slowapi rate limiting (60/min/IP default; see utils/rate_limit.py)
  - Sentry init (no-op if SENTRY_DSN is empty)
  - Routers: /health (live), /auth /applications /resume /support (stubs,
    filled in later phases)
  - Mangum handler for AWS Lambda (noop when running under uvicorn)

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
from .routers import applications, auth, health, resume, support
from .utils.logging import configure_logging
from .utils.rate_limit import limiter

# ─── Logging ────────────────────────────────────────────────────
configure_logging(level=settings.log_level)
log = logging.getLogger(__name__)

# ─── Sentry (optional) ──────────────────────────────────────────
if settings.sentry_dsn:
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.starlette import StarletteIntegration

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.env,
        integrations=[StarletteIntegration(), FastApiIntegration()],
        traces_sample_rate=0.1,
    )
    log.info("sentry initialised", extra={"env": settings.env})
else:
    log.info("sentry disabled (SENTRY_DSN not set)")

# ─── App ────────────────────────────────────────────────────────
app = FastAPI(
    title="ARTPARK EIR API",
    version="0.2.0",
    docs_url="/docs" if settings.env != "prod" else None,
    redoc_url=None,
    openapi_url="/openapi.json" if settings.env != "prod" else None,
)

# CORS — strict allow-list from env.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# Rate limiting — attach the limiter + 429 handler + middleware.
# Order matters: state, handler, middleware.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# ─── Routers ────────────────────────────────────────────────────
app.include_router(health.router)
app.include_router(auth.router)
app.include_router(applications.router)
app.include_router(resume.router)
app.include_router(support.router)

log.info(
    "app ready",
    extra={
        "env": settings.env,
        "cors_origins": settings.cors_origins,
        "rate_limit_default": settings.rate_limit_default,
    },
)

# ─── Lambda adapter (Phase 9) ───────────────────────────────────
# Mangum wraps the ASGI app as a Lambda handler. No-op when running under
# uvicorn locally. Imported at module load so SAM can find it as `app.main.handler`.
try:
    from mangum import Mangum

    handler = Mangum(app, lifespan="off")
except ImportError:  # pragma: no cover — Mangum is in requirements; only skipped in odd envs
    handler = None
