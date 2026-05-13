"""Reusable FastAPI dependencies.

`get_current_user` — verifies a Supabase-issued JWT from the Authorization
header by calling `supabase.auth.get_user(token)`. Returns a small dict the
routes can depend on. Raises 401 on any problem.
"""

from typing import Annotated

from fastapi import Header, HTTPException, status

from .supabase_client import get_admin_client
from .utils.logging import user_id_var

# Typed alias so routes can write:
#   user: CurrentUser = Depends(get_current_user)
CurrentUser = dict  # {"user_id": str, "email": str, "roles": list[str]}


async def get_current_user(
    authorization: Annotated[str | None, Header()] = None,
) -> CurrentUser:
    """Extract & verify the Supabase access token from Authorization: Bearer …"""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Empty Bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        client = get_admin_client()
        result = client.auth.get_user(token)
    except Exception as exc:  # network error, malformed token, etc.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token verification failed",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    user = getattr(result, "user", None)
    if user is None or user.id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Stamp the authed user's id on the request-scoped contextvar so every
    # log line for the remainder of this request carries it. We set but do
    # not reset (request lifecycle is short; the middleware resets at end).
    user_id_var.set(user.id)

    # If Sentry is active, tag the user on its scope too.
    try:  # pragma: no cover - sentry is optional
        import sentry_sdk  # noqa: WPS433

        sentry_sdk.set_user({"id": user.id, "email": user.email})
    except Exception:
        pass

    # Fetch the user's roles for RBAC. Single query per request; cheap.
    # Empty list if no roles granted yet (pure applicants pre-Phase-1).
    # Failures here are non-fatal: routes that don't require a specific
    # capability still work; routes that do will 403 via require_capability.
    roles: list[str] = []
    try:
        roles_res = (
            client.table("user_roles")
            .select("role")
            .eq("user_id", user.id)
            .execute()
        )
        roles = [row["role"] for row in (roles_res.data or [])]
    except Exception:
        pass

    return {"user_id": user.id, "email": user.email, "roles": roles}
