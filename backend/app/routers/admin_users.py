"""Admin endpoints for user provisioning + role management.

Implements spec §5.1. Every endpoint is gated by an admin capability:
  - manage_users for list/create/edit
  - grant_role / revoke_role for role mutations
  - reset_password for password reset

Session 1 ships only POST /admin/users (the vertical-slice minimum).
Session 2 appends list/detail/edit/grant/revoke/reset-password to this
file — see docs/superpowers/plans/2026-05-13-session-division.md.
"""

from __future__ import annotations

import logging
import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field

from ..deps import get_current_user
from ..rbac import ROLE_CAPABILITIES, require_capability
from ..supabase_client import get_admin_client

log = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/users", tags=["admin"])


# ─── Request models ─────────────────────────────────────────────────


class CreateUserRequest(BaseModel):
    email: EmailStr
    full_name: str = Field(..., min_length=1, max_length=200)
    phone: str | None = Field(default=None, max_length=30)
    # organization / role_title aren't in the `profiles` schema in Phase 1.
    # We accept them in the request so the admin form is complete, but they
    # don't persist anywhere yet — Phase 2 will add columns + plumbing.
    organization: str | None = Field(default=None, max_length=200)
    role_title: str | None = Field(default=None, max_length=200)
    roles: list[str] = Field(..., min_length=1, max_length=6)
    send_invite: bool = Field(default=True)


# ─── Endpoints ──────────────────────────────────────────────────────


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_capability("manage_users"))],
)
async def create_user(
    body: CreateUserRequest,
    current_user: dict = Depends(get_current_user),
):
    """Create a new auth user, write a profile row, assign roles, and
    optionally send a magic-link invite email via Supabase.

    Stores `granted_by` = current admin's user_id on every user_roles row
    for audit purposes (we'll fold this into audit_log_v2 in Task 15).
    """
    client = get_admin_client()

    valid_roles = set(ROLE_CAPABILITIES.keys())
    bad = [r for r in body.roles if r not in valid_roles]
    if bad:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "invalid_role",
                "invalid": bad,
                "valid": sorted(valid_roles),
            },
        )

    # Supabase's password policy enforces upper+lower+digit+symbol.
    # token_urlsafe gives upper+lower+digit but no symbol — guarantee
    # a valid password by appending a fixed symbol+digit+case mix. Only
    # consumed on the non-invite path; the magic-link path lets the
    # invitee pick their own password.
    temp_password = secrets.token_urlsafe(16) + "!1Aa"

    try:
        if body.send_invite:
            invite = client.auth.admin.invite_user_by_email(body.email)
            new_user = invite.user
        else:
            create = client.auth.admin.create_user({
                "email": body.email,
                "password": temp_password,
                "email_confirm": True,
            })
            new_user = create.user
    except Exception as exc:
        msg = str(exc)
        if "already" in msg.lower() or "registered" in msg.lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"code": "email_exists", "email": body.email},
            )
        log.error(
            "admin create_user failed",
            extra={"email": body.email, "err": msg[:200]},
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": "auth_create_failed", "message": msg[:200]},
        )

    new_user_id = new_user.id

    # Upsert profile row. handle_new_user trigger may have created an
    # empty profile; we fill the fields the admin provided. We do NOT
    # write organization/role_title — see CreateUserRequest comment.
    client.table("profiles").upsert({
        "id": new_user_id,
        "email": body.email,
        "full_name": body.full_name,
        "phone": body.phone,
    }).execute()

    rows = [
        {
            "user_id": new_user_id,
            "role": r,
            "granted_by": current_user["user_id"],
        }
        for r in body.roles
    ]
    client.table("user_roles").insert(rows).execute()

    return {
        "id": new_user_id,
        "email": body.email,
        "full_name": body.full_name,
        "roles": body.roles,
        "temp_password": None if body.send_invite else temp_password,
        "invite_sent": body.send_invite,
    }


@router.get(
    "",
    dependencies=[Depends(require_capability("manage_users"))],
)
async def list_users(
    role: str | None = None,
    search: str | None = None,
    limit: int = 200,
):
    """List users with optional filters. Joins profiles + user_roles."""
    client = get_admin_client()

    q = client.table("profiles").select(
        "id, email, full_name, phone, location_city, active_role, created_at"
    )
    if search:
        q = q.or_(f"email.ilike.%{search}%,full_name.ilike.%{search}%")
    q = q.order("created_at", desc=True).limit(limit)
    profs = (q.execute()).data or []

    rls = (
        client.table("user_roles")
        .select("user_id, role, granted_at")
        .execute()
    ).data or []
    roles_by_user: dict[str, list[str]] = {}
    for r in rls:
        roles_by_user.setdefault(r["user_id"], []).append(r["role"])

    rows = []
    for p in profs:
        user_roles = roles_by_user.get(p["id"], [])
        if role and role not in user_roles:
            continue
        rows.append({**p, "roles": user_roles})
    return {"users": rows, "total": len(rows)}


class PatchUserRequest(BaseModel):
    full_name: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=30)
    organization: str | None = Field(default=None, max_length=200)
    role_title: str | None = Field(default=None, max_length=200)


@router.get(
    "/{user_id}",
    dependencies=[Depends(require_capability("manage_users"))],
)
async def get_user(user_id: str):
    client = get_admin_client()
    prof = (
        client.table("profiles").select("*").eq("id", user_id).limit(1).execute()
    ).data
    if not prof:
        raise HTTPException(404, detail={"code": "user_not_found"})
    p = prof[0]
    rls = (
        client.table("user_roles").select("role, granted_at, granted_by")
        .eq("user_id", user_id).execute()
    ).data or []
    return {**p, "roles": rls}


@router.patch(
    "/{user_id}",
    dependencies=[Depends(require_capability("manage_users"))],
)
async def patch_user(user_id: str, body: PatchUserRequest):
    patch = body.model_dump(exclude_unset=True)
    if not patch:
        raise HTTPException(400, detail={"code": "empty_patch"})
    client = get_admin_client()
    # Map "organization" → "location_city" (existing column reuse)
    if "organization" in patch:
        patch["location_city"] = patch.pop("organization")
    # role_title not yet a column — drop silently (forward-compat)
    patch.pop("role_title", None)
    client.table("profiles").update(patch).eq("id", user_id).execute()
    return {"ok": True, "patched": list(patch.keys())}


class GrantRoleRequest(BaseModel):
    role: str


@router.post(
    "/{user_id}/roles",
    dependencies=[Depends(require_capability("grant_role"))],
    status_code=status.HTTP_201_CREATED,
)
async def grant_role(
    user_id: str,
    body: GrantRoleRequest,
    current_user: dict = Depends(get_current_user),
):
    if body.role not in ROLE_CAPABILITIES:
        raise HTTPException(400, detail={"code": "invalid_role", "role": body.role})
    client = get_admin_client()
    try:
        client.table("user_roles").insert({
            "user_id": user_id, "role": body.role,
            "granted_by": current_user["user_id"],
        }).execute()
    except Exception as exc:
        # Likely PK violation = already granted
        if "duplicate" in str(exc).lower() or "23505" in str(exc):
            raise HTTPException(409, detail={"code": "already_granted", "role": body.role})
        raise
    return {"ok": True, "role": body.role}


@router.delete(
    "/{user_id}/roles/{role}",
    dependencies=[Depends(require_capability("revoke_role"))],
)
async def revoke_role(user_id: str, role: str):
    if role not in ROLE_CAPABILITIES:
        raise HTTPException(400, detail={"code": "invalid_role", "role": role})

    client = get_admin_client()

    # Last-admin protection: if revoking 'admin' from the only remaining
    # admin, refuse. Counts admin assignments across all users; if removing
    # this one leaves zero, block.
    if role == "admin":
        total_admins = (
            client.table("user_roles").select("user_id", count="exact")
            .eq("role", "admin").execute()
        ).count or 0
        if total_admins <= 1:
            raise HTTPException(
                409,
                detail={
                    "code": "last_admin_protection",
                    "message": "Cannot revoke the last admin role.",
                },
            )

    client.table("user_roles").delete().eq("user_id", user_id).eq("role", role).execute()
    return {"ok": True, "role": role}
