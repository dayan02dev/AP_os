"""Health endpoints.

Two levels:

  GET /health          Shallow. Always 200 if the process is up. Returns
                       {status, version, uptime_seconds}. Cheap — used by
                       load balancers / k8s liveness probes.
  GET /health/ready    Deep. Hits Supabase DB (SELECT 1), Supabase Auth
                       (list 1 user), and OpenRouter (HEAD /). Returns 200
                       when all checks are "ok", 503 when any check fails.
                       Used by readiness probes + synthetic monitoring.
"""

from __future__ import annotations

import logging
import time
from typing import Any

import httpx
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from ..config import settings
from ..supabase_client import get_admin_client

log = logging.getLogger(__name__)

router = APIRouter(tags=["health"])

# Process start timestamp captured at import.
_STARTED_AT = time.time()


@router.get("/health")
async def health() -> dict[str, Any]:
    """Liveness: process is running. No external dependencies touched."""
    return {
        "status": "ok",
        "version": settings.app_version,
        "uptime_seconds": int(time.time() - _STARTED_AT),
    }


@router.get("/health/ready")
async def ready() -> Any:
    """Readiness: every external dependency the app needs is reachable."""
    checks: dict[str, str] = {}

    # ── Supabase DB ──
    try:
        # One-row peek at any existing table — this exercises both the REST
        # layer and Postgres connection pool.
        get_admin_client().table("profiles").select("id").limit(1).execute()
        checks["db"] = "ok"
    except Exception as exc:
        log.warning("health/ready: db check failed", extra={"err": str(exc)})
        checks["db"] = "error"

    # ── Supabase Auth (GoTrue) ──
    try:
        # admin.list_users paginates; an empty first page still round-trips
        # a request through Auth so we know the service is alive.
        get_admin_client().auth.admin.list_users(page=1, per_page=1)
        checks["auth"] = "ok"
    except Exception as exc:
        log.warning("health/ready: auth check failed", extra={"err": str(exc)})
        checks["auth"] = "error"

    # ── OpenRouter (LLM) ──
    try:
        async with httpx.AsyncClient(timeout=5.0) as http:
            # OpenRouter doesn't expose a cheap /healthz, so hit /models
            # with a HEAD — it 200s with no body. If they're down, we
            # find out in under 5 seconds.
            resp = await http.head(
                "https://openrouter.ai/api/v1/models",
                headers={"Authorization": f"Bearer {settings.openrouter_api_key}"} if settings.openrouter_api_key else {},
            )
        checks["llm"] = "ok" if resp.status_code < 500 else "error"
    except Exception as exc:
        log.warning("health/ready: llm check failed", extra={"err": str(exc)})
        checks["llm"] = "error"

    all_ok = all(v == "ok" for v in checks.values())
    body = {"status": "ok" if all_ok else "degraded", "checks": checks}
    return JSONResponse(status_code=200 if all_ok else 503, content=body)
