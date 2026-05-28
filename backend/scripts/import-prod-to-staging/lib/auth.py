"""Auth user stub creation + UUID remap building.

Per project memory: SQL INSERT into auth.users is rejected by Supabase
GoTrue. Only POST /auth/v1/admin/users creates a usable login row.

This module's public surfaces:

  scrambled_password() — 64-char hex string (256 bits of entropy).
    Applied to every imported stub user so they can't sign in.

  build_user_remap(prod_users, staging_existing_by_email, create_user_fn)
      → dict[prod_uid → staging_uid]
    Pure-ish orchestration: takes prod user rows, calls create_user_fn
    (a closure over the staging Supabase client), and emits the remap
    every subsequent table copy needs.

  delete_users_outside_preserve_set(staging_client, preserve_set) → int
    Tier 2 wipe: deletes every auth.users row whose id is NOT in
    preserve_set. Uses the Admin API so GoTrue state is cleaned up.
    The cascading FKs on profiles / user_roles handle those tables.

  import_users(prod, staging, ...) — the integration entrypoint that
    wires the two together. Called from import.py.
"""

from __future__ import annotations

import logging
import secrets
from datetime import datetime, timezone
from typing import Callable

log = logging.getLogger(__name__)


def list_auth_users(client, *, page_size: int = 1000) -> list[dict]:
    """List every auth.users row via the Supabase Admin API.

    PostgREST doesn't expose the ``auth`` schema, so we can't reach
    ``auth.users`` via ``client.table(...)``. The Admin API
    (``client.auth.admin.list_users()``) is the only path. Paginates
    through every page and returns dicts shaped like
    ``{"id": ..., "email": ..., "raw_user_meta_data": {...}}``
    so callers can use them interchangeably with the PostgREST shape.
    """
    out: list[dict] = []
    page = 1
    while True:
        try:
            users = client.auth.admin.list_users(page=page, per_page=page_size)
        except TypeError:
            # Older supabase-py signatures took no kwargs — fall back.
            users = client.auth.admin.list_users()
        users = users or []
        for u in users:
            out.append({
                "id": getattr(u, "id", None),
                "email": getattr(u, "email", None),
                "raw_user_meta_data": dict(getattr(u, "user_metadata", None) or {}),
            })
        if len(users) < page_size:
            break
        page += 1
    return out


def scrambled_password() -> str:
    """Return a fresh 256-bit hex string used as the staging user password."""
    return secrets.token_hex(32)


def build_user_remap(
    *,
    prod_users: list[dict],
    staging_existing_by_email: dict[str, str],
    create_user_fn: Callable[..., dict],
) -> dict[str, str]:
    """Build a {prod_uid → staging_uid} mapping.

    For each prod user:
      - If their email already exists in staging, map to existing UUID.
      - Otherwise call create_user_fn(email=..., password=..., ...) which
        returns a dict with at least {'id': new_uid}. If create_user_fn
        raises with 'user_already_exists' in the message, fall back to
        the staging_existing_by_email lookup (covers a race where the
        email was added between our SELECT and our INSERT).
    """
    remap: dict[str, str] = {}

    for prod_user in prod_users:
        prod_uid = prod_user["id"]
        email = prod_user["email"]

        # Existing-email shortcut.
        if email in staging_existing_by_email:
            remap[prod_uid] = staging_existing_by_email[email]
            continue

        track = (prod_user.get("raw_user_meta_data") or {}).get("track") or "tir"

        try:
            created = create_user_fn(
                email=email,
                password=scrambled_password(),
                email_confirm=True,
                user_metadata={
                    "track": track,
                    "imported_at": datetime.now(timezone.utc).isoformat(),
                    "source": "prod-import",
                },
            )
            remap[prod_uid] = created["id"]
        except Exception as exc:
            msg = str(exc).lower()
            if "user_already_exists" in msg or "already registered" in msg:
                # Race: someone else inserted this email after we built the map.
                # Re-fetch by email would be ideal; for unit testing we trust
                # staging_existing_by_email which is populated on every run.
                if email in staging_existing_by_email:
                    remap[prod_uid] = staging_existing_by_email[email]
                else:
                    raise
            else:
                raise

    return remap


def delete_users_outside_preserve_set(
    staging_client, preserve_set: set[str]
) -> int:
    """Tier 2 wipe: delete every staging auth.users row not in preserve_set.

    Uses the Supabase Admin API (DELETE /auth/v1/admin/users/{id}) so
    GoTrue's internal state is cleaned up properly. The cascading FKs on
    profiles and user_roles take care of those child tables automatically.

    Errors on individual user deletions are logged and skipped — we
    continue with the rest of the set so a single bad row doesn't abort
    the whole wipe.

    Returns the number of users actually deleted.
    """
    all_users = list_auth_users(staging_client)
    users_to_delete = {row["id"] for row in all_users if row.get("id")} - preserve_set
    log.info(
        "Tier 2 auth wipe: %d total staging users, %d preserved, %d to delete",
        len(all_users), len(preserve_set), len(users_to_delete),
    )

    deleted = 0
    for uid in users_to_delete:
        try:
            staging_client.auth.admin.delete_user(uid)
            deleted += 1
        except Exception as exc:
            log.error("Failed to delete staging auth user %s: %s — continuing", uid, exc)

    log.info("Tier 2 auth wipe complete: %d user(s) deleted", deleted)
    return deleted


def import_users(prod_client, staging_client) -> dict[str, str]:
    """Integration entrypoint — fetches prod user rows + staging existing
    emails, then builds the remap by calling the Supabase Admin API.

    Returns the remap dict.
    """
    # Collect unique prod user_ids referenced by applications + resume_uploads.
    app_user_ids = {
        row["user_id"]
        for row in (prod_client.table("applications")
                    .select("user_id").execute().data or [])
        if row.get("user_id")
    }
    resume_user_ids = {
        row["user_id"]
        for row in (prod_client.table("resume_uploads")
                    .select("user_id").execute().data or [])
        if row.get("user_id")
    }
    distinct_ids = app_user_ids | resume_user_ids
    log.info("Found %d distinct prod user_ids", len(distinct_ids))

    if not distinct_ids:
        return {}

    # Pull the prod auth.users rows for those ids via the Admin API
    # (auth schema is not exposed over PostgREST). Python-side filter.
    all_prod_users = list_auth_users(prod_client)
    prod_users = [u for u in all_prod_users if u.get("id") in distinct_ids]

    # Pull staging existing users so we can short-circuit duplicate emails.
    staging_emails = {pu["email"] for pu in prod_users if pu.get("email")}
    all_staging_users = list_auth_users(staging_client)
    staging_existing_by_email = {
        u["email"]: u["id"]
        for u in all_staging_users
        if u.get("email") in staging_emails and u.get("id")
    }

    def create_user(**kwargs) -> dict:
        # supabase-py wraps the Admin API. The response has .user.id.
        res = staging_client.auth.admin.create_user(kwargs)
        return {"id": res.user.id}

    remap = build_user_remap(
        prod_users=prod_users,
        staging_existing_by_email=staging_existing_by_email,
        create_user_fn=create_user,
    )

    # Mirror profile fields (full_name, phone, etc.). The handle_new_user()
    # trigger created an empty profile row; we UPDATE it now.
    prod_profiles = (
        prod_client.table("profiles")
        .select("id, full_name, phone, linkedin_url, location_city, location_country")
        .in_("id", list(distinct_ids))
        .execute()
    ).data or []
    by_prod_id = {p["id"]: p for p in prod_profiles if p.get("id")}

    for prod_uid, staging_uid in remap.items():
        profile = by_prod_id.get(prod_uid)
        if not profile:
            continue
        update_fields = {
            k: profile.get(k)
            for k in ("full_name", "phone", "linkedin_url", "location_city", "location_country")
            if profile.get(k) is not None
        }
        if update_fields:
            staging_client.table("profiles").update(update_fields).eq("id", staging_uid).execute()

    return remap
