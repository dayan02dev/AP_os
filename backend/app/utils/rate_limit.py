"""Rate limiter shared across routers.

slowapi uses in-memory counters by default — fine for a single Lambda container
at our scale. If we ever multi-container, swap the storage to Redis/Upstash
via the `storage_uri` kwarg.

The default limit comes from config (`settings.rate_limit_default`) and applies
to every route that doesn't override with `@limiter.limit(...)`. `main.py`
registers the SlowAPIMiddleware + exception handler so default limits engage.
"""

from slowapi import Limiter
from slowapi.util import get_remote_address

from ..config import settings

limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[settings.rate_limit_default],
)
