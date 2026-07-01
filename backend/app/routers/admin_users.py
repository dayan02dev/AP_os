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
import re
import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field

from ..deps import get_current_user
from ..rbac import ROLE_CAPABILITIES, require_capability
from ..services.audit import write_audit
from ..services.email_service import (
    EmailDeliveryError,
    frontend_url,
    get_email_service,
)
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
    temp_password: str | None = Field(default=None, max_length=128)
    expertise_domains: list[str] | None = Field(default=None)
    batch_id: str | None = Field(default=None)


# ─── Endpoints ──────────────────────────────────────────────────────


def _password_ok(pw: str) -> bool:
    """Conservative match of Supabase's policy: 10+ chars with an uppercase
    letter, a lowercase letter, a digit, and a symbol. Generated passwords pass."""
    return bool(
        len(pw) >= 10
        and re.search(r"[a-z]", pw)
        and re.search(r"[A-Z]", pw)
        and re.search(r"\d", pw)
        and re.search(r"[^A-Za-z0-9]", pw)
    )


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

    # Temp password: admin-supplied (validated) or generated. The generated
    # form always satisfies the policy.
    if body.temp_password:
        temp_password = body.temp_password
        if not _password_ok(temp_password):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "weak_password",
                    "message": "Password must be at least 10 characters and include an "
                               "uppercase letter, a lowercase letter, a digit, and a symbol.",
                },
            )
    else:
        temp_password = secrets.token_urlsafe(16) + "!1Aa"

    is_reviewer_invite = "reviewer" in body.roles

    # Does this email already belong to a user? (service-role read; RLS bypassed)
    existing_id = None
    try:
        existing_rows = (
            client.table("profiles").select("id").eq("email", body.email).limit(1).execute().data
        ) or []
        existing_id = existing_rows[0]["id"] if existing_rows else None
    except Exception:  # noqa: BLE001
        existing_id = None

    existing_user = False

    if is_reviewer_invite and existing_id:
        # Existing account → convert to a reviewer. Reset the password (so the
        # emailed credentials work) and make the user reviewer-only: add
        # `reviewer`, drop applicant/founder/mentor. `admin`/`leadership` are
        # preserved so a reviewer invite never strips a staff member's access.
        existing_user = True
        new_user_id = existing_id
        try:
            client.auth.admin.update_user_by_id(new_user_id, {"password": temp_password})
        except Exception as exc:  # noqa: BLE001
            msg = str(exc)
            log.error("reviewer invite: password reset failed",
                      extra={"email": body.email, "err": msg[:200]})
            if "password" in msg.lower():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"code": "weak_password", "message": msg[:200]},
                )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={"code": "auth_update_failed", "message": msg[:200]},
            )

        client.table("profiles").upsert({
            "id": new_user_id,
            "email": body.email,
            "full_name": body.full_name,
            "phone": body.phone,
        }).execute()

        current_roles = {
            r["role"]
            for r in (
                client.table("user_roles").select("role").eq("user_id", new_user_id).execute().data
                or []
            )
        }
        keep = {"reviewer"} | (current_roles & {"admin", "leadership"})
        for role in current_roles - keep:
            client.table("user_roles").delete().eq("user_id", new_user_id).eq("role", role).execute()
        if "reviewer" not in current_roles:
            client.table("user_roles").insert({
                "user_id": new_user_id,
                "role": "reviewer",
                "granted_by": current_user["user_id"],
            }).execute()
        final_roles = sorted(keep)
    else:
        try:
            if body.send_invite and not is_reviewer_invite:
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
            if "password" in msg.lower():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"code": "weak_password", "message": msg[:200]},
                )
            log.error("admin create_user failed", extra={"email": body.email, "err": msg[:200]})
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={"code": "auth_create_failed", "message": msg[:200]},
            )

        new_user_id = new_user.id
        client.table("profiles").upsert({
            "id": new_user_id,
            "email": body.email,
            "full_name": body.full_name,
            "phone": body.phone,
        }).execute()
        client.table("user_roles").insert([
            {"user_id": new_user_id, "role": r, "granted_by": current_user["user_id"]}
            for r in body.roles
        ]).execute()
        final_roles = list(body.roles)

    # For reviewer invites, persist reviewer_profiles (expertise_domains + batch_id)
    # so the roster immediately shows the reviewer's domains and batch membership.
    if is_reviewer_invite:
        try:
            client.table("reviewer_profiles").upsert({
                "reviewer_user_id": new_user_id,
                "expertise_domains": body.expertise_domains or [],
                "batch_id": body.batch_id,
            }, on_conflict="reviewer_user_id").execute()
        except Exception as exc:  # noqa: BLE001
            log.warning("reviewer invite: reviewer_profiles upsert failed",
                        extra={"user_id": new_user_id, "err": str(exc)[:200]})

    credentials_emailed = False
    if is_reviewer_invite and body.send_invite:
        try:
            get_email_service().send_reviewer_invite(
                to=body.email,
                reviewer_name=body.full_name,
                login_email=body.email,
                temp_password=temp_password,
                inbox_url=frontend_url("/reviewer"),
            )
            credentials_emailed = True
        except Exception:  # noqa: BLE001
            log.warning("reviewer invite email failed for %s", body.email, exc_info=True)

    write_audit(
        actor_user_id=current_user["user_id"],
        actor_role="admin",
        action_type="user.created",
        target_table="profiles",
        target_id=new_user_id,
        after={"email": body.email, "roles": final_roles,
               "invite_sent": body.send_invite, "existing_user": existing_user},
    )

    return {
        "id": new_user_id,
        "email": body.email,
        "full_name": body.full_name,
        "roles": final_roles,
        "temp_password": temp_password if (is_reviewer_invite or not body.send_invite) else None,
        "invite_sent": body.send_invite,
        "credentials_emailed": credentials_emailed,
        "existing_user": existing_user,
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
    """List users with optional filters. Joins profiles + user_roles.

    When `role` is given, we filter user_roles FIRST then fetch matching
    profiles — otherwise the profiles `.limit(limit)` (ordered newest-first)
    silently drops older accounts before the role filter runs. With 200+
    profiles on staging this manifested as the oldest reviewers (e.g. the
    first admin/leadership account) disappearing from the assign-reviewer
    modal even though they had the role granted.
    """
    client = get_admin_client()

    role_user_ids: list[str] | None = None
    if role:
        rls_for_role = (
            client.table("user_roles")
            .select("user_id")
            .eq("role", role)
            .execute()
        ).data or []
        role_user_ids = [r["user_id"] for r in rls_for_role]
        if not role_user_ids:
            return {"users": [], "total": 0}

    q = client.table("profiles").select(
        "id, email, full_name, phone, location_city, active_role, created_at"
    )
    if role_user_ids is not None:
        q = q.in_("id", role_user_ids)
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
async def patch_user(
    user_id: str,
    body: PatchUserRequest,
    current_user: dict = Depends(get_current_user),
):
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
    write_audit(
        actor_user_id=current_user["user_id"],
        actor_role="admin",
        action_type="user.profile_updated",
        target_table="profiles",
        target_id=user_id,
        after={"patched": list(patch.keys())},
    )
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
    write_audit(
        actor_user_id=current_user["user_id"],
        actor_role="admin",
        action_type="role.granted",
        target_table="user_roles",
        target_id=user_id,
        after={"role": body.role},
    )

    # Best-effort role-granted notification (spec §8). Failure here must not
    # break the role grant — the row is already in user_roles + audit_log_v2.
    _notify_role_granted_safely(
        client=client,
        user_id=user_id,
        role=body.role,
        granted_by_email=current_user.get("email"),
    )

    return {"ok": True, "role": body.role}


def _notify_role_granted_safely(
    *,
    client,
    user_id: str,
    role: str,
    granted_by_email: str | None,
) -> None:
    """Send the role-granted email if we can resolve the user's address.

    Wrapped in a defensive try/except so DB lookup failures, Resend outages,
    or missing template files never propagate to the caller. The grant
    itself is the load-bearing operation; the email is informational.
    """
    try:
        prof = (
            client.table("profiles")
            .select("email,full_name")
            .eq("id", user_id)
            .limit(1)
            .execute()
        )
        row = (prof.data or [None])[0]
        if not row or not row.get("email"):
            log.info(
                "role_granted email skipped — no profile email on file",
                extra={"user_id": user_id, "role": role},
            )
            return
        signin_url = frontend_url("/apply/signin")
        get_email_service().send_role_granted(
            to=row["email"],
            user_name=row.get("full_name") or row["email"],
            role=role,
            granted_by=granted_by_email or "admin",
            signin_url=signin_url,
        )
    except EmailDeliveryError as exc:
        log.warning(
            "role_granted email delivery failed (swallowed)",
            extra={"user_id": user_id, "role": role, "err": str(exc)},
        )
    except Exception:
        log.warning(
            "role_granted email send unexpectedly failed (swallowed)",
            extra={"user_id": user_id, "role": role},
            exc_info=True,
        )


@router.delete(
    "/{user_id}/roles/{role}",
    dependencies=[Depends(require_capability("revoke_role"))],
)
async def revoke_role(
    user_id: str,
    role: str,
    current_user: dict = Depends(get_current_user),
):
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
    write_audit(
        actor_user_id=current_user["user_id"],
        actor_role="admin",
        action_type="role.revoked",
        target_table="user_roles",
        target_id=user_id,
        before={"role": role},
    )
    return {"ok": True, "role": role}


@router.post(
    "/{user_id}/reset-password",
    dependencies=[Depends(require_capability("reset_password"))],
)
async def reset_password(
    user_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Send a Supabase-managed password reset email."""
    client = get_admin_client()
    prof = (
        client.table("profiles").select("email").eq("id", user_id).limit(1).execute()
    ).data
    if not prof:
        raise HTTPException(404, detail={"code": "user_not_found"})
    email = prof[0]["email"]
    try:
        client.auth.reset_password_for_email(email)
    except Exception as exc:
        raise HTTPException(
            502,
            detail={"code": "reset_send_failed", "message": str(exc)[:200]},
        )
    write_audit(
        actor_user_id=current_user["user_id"],
        actor_role="admin",
        action_type="user.password_reset_triggered",
        target_table="profiles",
        target_id=user_id,
        after={"email": email},
    )
    return {"ok": True, "email_sent_to": email}


@router.post(
    "/{user_id}/deactivate",
    dependencies=[Depends(require_capability("manage_users"))],
)
async def deactivate_user(
    user_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Soft-deactivate a user by banning them at the Supabase auth level.

    Uses Supabase's admin API to set a 100-year ban duration (876600h).
    The user remains in auth.users + profiles; their sessions are
    invalidated and future signins are refused. Reversible via a
    separate reactivate endpoint (Phase 2 if/when needed).
    """
    client = get_admin_client()
    # Confirm user exists first — gives a clean 404 instead of a Supabase
    # error wall.
    prof = (
        client.table("profiles").select("id, email").eq("id", user_id).limit(1).execute()
    ).data
    if not prof:
        raise HTTPException(404, detail={"code": "user_not_found"})
    try:
        client.auth.admin.update_user_by_id(
            user_id,
            {"ban_duration": "876600h"},  # 100 years
        )
    except Exception as exc:
        raise HTTPException(
            502,
            detail={"code": "deactivate_failed", "message": str(exc)[:200]},
        )
    write_audit(
        actor_user_id=current_user["user_id"],
        actor_role="admin",
        action_type="user.deactivated",
        target_table="profiles",
        target_id=user_id,
        after={"email": prof[0]["email"]},
    )
    return {"ok": True, "user_id": user_id, "email": prof[0]["email"]}
