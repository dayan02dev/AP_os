"""Supabase client factories.

Two clients live here:

  get_admin_client()   uses the service-role key. Bypasses RLS. This is what
                       most backend code uses — we've already verified auth
                       separately via `get_current_user`, so RLS is redundant.

  get_anon_client()    uses the anon key. RLS applies. Use this only when you
                       explicitly want RLS to gate the operation (rare in the
                       backend — usually when impersonating an end-user).

Both clients are module-level singletons via `lru_cache`. Do not instantiate
`supabase.create_client(...)` elsewhere.

Connection pooling
------------------
We talk to Supabase over HTTPS (PostgREST + GoTrue), not direct TCP to
Postgres. `supabase-py` is a thin wrapper around `httpx.Client`, which uses
`httpcore`'s built-in HTTP/1.1 connection pool (keep-alive, 10 connections
by default). One singleton per process reuses those sockets across the
lifetime of the Lambda container — no per-request connect overhead.

If we ever switch to a direct Postgres driver (psycopg, asyncpg), point
SUPABASE_DB_URL at the pooler endpoint on port 6543 (Supavisor) rather than
the direct 5432 endpoint — Postgres can't handle thousands of short-lived
Lambda connections without a pooler in front.
"""

from functools import lru_cache

from supabase import Client, create_client

from .config import settings


@lru_cache(maxsize=1)
def get_admin_client() -> Client:
    """Service-role client. Bypasses RLS. Use for all privileged writes.

    Singleton: one instance per process keeps the underlying httpx pool warm
    across requests (important on Lambda, where cold-start handshakes are the
    dominant latency cost for the first call).
    """
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


@lru_cache(maxsize=1)
def get_anon_client() -> Client:
    """Anon client. RLS applies. Use only when you want RLS to gate the call."""
    return create_client(settings.supabase_url, settings.supabase_anon_key)
