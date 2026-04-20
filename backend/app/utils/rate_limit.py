"""Rate limiting primitives.

Two layers:

  1) slowapi global limiter — IP-keyed. Provides the 60/min/IP default for
     every route that doesn't explicitly opt out. Backed by an in-memory
     counter inside each Lambda/uvicorn container.

  2) Sliding-window buckets (below) — for per-email / per-user / per-token
     rate limits that slowapi's request-only key_func can't cleanly express
     (email lives in the request body; user_id lives inside the JWT).

⚠ THESE LIMITS ARE PER-CONTAINER, NOT DISTRIBUTED.
  In the current Lambda + API Gateway setup one invocation = one container,
  so a burst of parallel Lambda invocations can each allow N requests,
  effectively multiplying limits. At our expected scale (~10–100 apps/day)
  this is fine and intentional — swap to a Redis-backed bucket if we ever
  scale to thousands of concurrent applicants. Do NOT silently add Redis
  without thinking about the cost model.
"""

from __future__ import annotations

import time
from collections import defaultdict
from threading import Lock

from fastapi import HTTPException, Request, status
from slowapi import Limiter
from slowapi.util import get_remote_address

from ..config import settings

# ─── Global slowapi limiter (IP-keyed default) ─────────────────────

limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[settings.rate_limit_default],
)


def per_token_key(request: Request) -> str:
    """slowapi key_func that buckets by Bearer token (≈ per-user) when a
    token is present, falling back to client IP for anonymous routes.

    We hash the token into a 32-char slice so the key stays stable across
    one session without storing the raw token in memory longer than needed.
    """
    auth = (request.headers.get("authorization") or "").lower()
    if auth.startswith("bearer "):
        token = auth.split(" ", 1)[1].strip()
        return f"user:{token[:32]}"
    return f"ip:{get_remote_address(request)}"


# ─── Sliding-window buckets (in-memory) ────────────────────────────

_buckets: dict[str, list[float]] = defaultdict(list)
_bucket_lock = Lock()


def _prune(key: str, cutoff: float) -> list[float]:
    fresh = [ts for ts in _buckets[key] if ts > cutoff]
    _buckets[key] = fresh
    return fresh


def check_rate(bucket: str, key: str, max_count: int, window_s: int) -> None:
    """Raise HTTP 429 if (bucket, key) is over quota. Does NOT record.

    Paired with `record_rate()` when you only want to consume a slot on
    success (e.g. request-otp — don't penalise the caller for Supabase
    network errors).
    """
    now = time.time()
    cutoff = now - window_s
    composite = f"{bucket}:{key}"
    with _bucket_lock:
        fresh = _prune(composite, cutoff)
        if len(fresh) >= max_count:
            retry_after = int(window_s - (now - fresh[0])) + 1
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many {bucket} requests. Try again in {retry_after}s.",
                headers={"Retry-After": str(retry_after)},
            )


def record_rate(bucket: str, key: str) -> None:
    """Consume one slot. Use after a successful call."""
    with _bucket_lock:
        _buckets[f"{bucket}:{key}"].append(time.time())


def check_and_record(bucket: str, key: str, max_count: int, window_s: int) -> None:
    """Atomic check-then-record. Use when every attempt counts (e.g.
    verify-otp, where failed attempts must cost to prevent brute force).
    """
    now = time.time()
    cutoff = now - window_s
    composite = f"{bucket}:{key}"
    with _bucket_lock:
        fresh = _prune(composite, cutoff)
        if len(fresh) >= max_count:
            retry_after = int(window_s - (now - fresh[0])) + 1
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many {bucket} requests. Try again in {retry_after}s.",
                headers={"Retry-After": str(retry_after)},
            )
        fresh.append(now)
        _buckets[composite] = fresh


def reset_buckets_for_tests() -> None:
    """Flush all in-memory state. Called from test fixtures; never in prod."""
    with _bucket_lock:
        _buckets.clear()


# ─── Convenient wrappers for per-user rate limits ──────────────────

def per_user_rate_limit(bucket: str, max_count: int, window_s: int):
    """Returns a FastAPI dependency that enforces a per-user rate limit on
    any authed endpoint. The user_id is pulled from get_current_user so this
    must be added AFTER Depends(get_current_user) in the route signature —
    or, preferably, the route uses Depends(get_current_user) itself and
    this dependency pulls the same cached result.

    Usage:
        @router.get(
            "/me",
            dependencies=[Depends(per_user_rate_limit("auth-me", 120, 60))],
        )
        async def me(user: dict = Depends(get_current_user)): ...
    """
    from fastapi import Depends

    from ..deps import get_current_user

    def _dep(current_user: dict = Depends(get_current_user)) -> None:
        check_and_record(bucket, current_user["user_id"], max_count, window_s)

    return _dep
