"""Wipe orchestration for the staging Supabase before the import runs.

Two-tier wipe per spec §4:

  Tier 1 (truncate fully): tir_applications, tir_resume_uploads, and
  the 5 admin Phase-1 tables (audit_log_v2 etc.).

  Tier 2 (filter delete preserving a set): auth.users, profiles,
  user_roles — keep the 3 sign-in test users and everyone currently
  holding the 'reviewer' role.
"""

from __future__ import annotations

import logging

from .tables import PRESERVE_EMAILS

log = logging.getLogger(__name__)

# Truncate order — children first to avoid FK errors.
CHILD_TABLES_TO_TRUNCATE: list[str] = [
    "audit_log_v2",
    "application_status_log",
    "reviews",
    "reviewer_assignments",
    "ai_screening",
]

APPLICATIONS_TO_TRUNCATE: list[str] = [
    "tir_applications",
    "tir_resume_uploads",
]

# Final wipe order = children, then parents.
WIPE_ORDER: list[str] = CHILD_TABLES_TO_TRUNCATE + APPLICATIONS_TO_TRUNCATE


def resolve_preserve_set(staging_client) -> set[str]:
    """Return the set of auth.users.id values to preserve through the wipe.

    Always includes the 3 sign-in test users from PRESERVE_EMAILS. Plus
    every user holding ``role='reviewer'`` in user_roles at this moment.
    """
    # Static-preserve users by email lookup.
    users = (
        staging_client.table("auth.users")
        .select("id, email")
        .in_("email", list(PRESERVE_EMAILS))
        .execute()
    ).data or []
    preserved = {row["id"] for row in users if row.get("id")}

    # Dynamic-preserve: everyone with reviewer role.
    reviewer_grants = (
        staging_client.table("user_roles")
        .select("user_id")
        .eq("role", "reviewer")
        .execute()
    ).data or []
    preserved.update(row["user_id"] for row in reviewer_grants if row.get("user_id"))

    log.info("Preserve set resolved: %d user(s)", len(preserved))
    return preserved


def run_wipe(staging_client, *, dry_run: bool = False) -> None:
    """Execute the full two-tier wipe against the staging Supabase.

    Order:
      1. Resolve preserve set (BEFORE deleting anything).
      2. Truncate child tables, then parent application tables.
      3. Delete from auth.users / profiles / user_roles where id NOT IN
         the preserve set. Per Supabase: auth.users must be deleted via
         the Admin API (POST /auth/v1/admin/users/{id} DELETE), NOT via
         a plain SQL DELETE. That call is handled by lib/auth.py
         (delete_users_outside_preserve_set) — we call it from here.
    """
    preserve = resolve_preserve_set(staging_client)

    if dry_run:
        log.info("[dry-run] Would truncate: %s", WIPE_ORDER)
        log.info("[dry-run] Would preserve %d user(s) outside the wipe", len(preserve))
        return

    for table in WIPE_ORDER:
        log.info("Truncating %s", table)
        # Supabase doesn't expose TRUNCATE via PostgREST — use DELETE WHERE
        # id IS NOT NULL which is equivalent for our use (no nullable PKs).
        staging_client.table(table).delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()

    # auth.users / profiles / user_roles deletes are done by lib/auth.py
    # because they require the Admin API for auth.users. The caller of
    # run_wipe() chains the wipe → auth-cleanup → auth-import sequence.
