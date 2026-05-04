"""Reusable FastAPI dependencies.

`get_current_user` — verifies a Supabase-issued JWT from the Authorization
header by calling `supabase.auth.get_user(token)`. Returns a small dict the
routes can depend on. Raises 401 on any problem.

`require_track('tir' | 'sip')` — factory for a dependency that asserts the
caller's `profiles.track` matches the required value. Used to physically
isolate the TIR and SIP application flows: a TIR user trying to hit a SIP
endpoint (or vice versa) gets 403 before the route handler ever runs.
"""

from typing import Annotated, Literal

from fastapi import Depends, Header, HTTPException, status

from .supabase_client import get_admin_client
from .utils.logging import user_id_var

# Typed alias so routes can write:
#   user: CurrentUser = Depends(get_current_user)
CurrentUser = dict  # {"user_id": str, "email": str, "track": str | None}


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

    # Look up the user's track from profiles. Cheap single-row read; cached
    # by Supabase's connection pool. Returns None if the profile row was
    # never created or the column is null (the "fresh signup" test scenario).
    track: str | None = None
    try:
        prof_res = (
            client.table("profiles")
            .select("track")
            .eq("id", user.id)
            .limit(1)
            .execute()
        )
        rows = prof_res.data or []
        if rows:
            track = rows[0].get("track")
    except Exception:
        # Non-fatal — endpoints that need track will reject via require_track.
        pass

    return {"user_id": user.id, "email": user.email, "track": track}


def require_track(required: Literal["tir", "sip"]):
    """Build a FastAPI dependency that asserts the caller's track == `required`.

    Usage on a router:
        from ..deps import get_current_user, require_track

        @router.get(
            "/sip-applications/me",
            dependencies=[Depends(require_track("sip"))],
        )
        async def get_sip_app(current_user: dict = Depends(get_current_user)):
            ...

    Behavior:
      - track matches → pass
      - track is the OTHER value → 403 with message pointing user to support
      - track is NULL → 403 telling user their account hasn't picked a track yet
    """
    async def _dep(current_user: dict = Depends(get_current_user)) -> None:
        track = current_user.get("track")
        if track == required:
            return
        if track is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "track_unassigned",
                    "message": (
                        "Your account hasn't been assigned a program track yet. "
                        "Please complete signup."
                    ),
                },
            )
        # Wrong-track case — explicit message tells the user what to do.
        other = "TIR" if required == "sip" else "SIP"
        you_are = "TIR" if track == "tir" else "SIP"
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "wrong_track",
                "message": (
                    f"You're enrolled in the {you_are} track. "
                    f"This endpoint is for {required.upper()} applicants only. "
                    "To switch tracks, contact support."
                ),
                "your_track": track,
                "required_track": required,
            },
        )

    return _dep
