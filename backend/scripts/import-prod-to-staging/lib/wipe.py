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


def run_wipe(staging_client, *, preserve_set: set[str], dry_run: bool = False) -> None:
    """Execute the Tier 1 table truncation against the staging Supabase.

    ``preserve_set`` must be resolved by the caller (via
    ``resolve_preserve_set``) BEFORE calling this function so the set is
    computed once and can be shared with the Tier 2 auth cleanup.

    Order:
      1. Truncate child tables, then parent application tables (Tier 1).
      2. Tier 2 auth cleanup (auth.users / profiles / user_roles) is
         handled by the caller via lib/auth.delete_users_outside_preserve_set,
         which must be called AFTER this function and BEFORE the auth-stub
         import phase.
    """
    if dry_run:
        log.info("[dry-run] Would truncate: %s", WIPE_ORDER)
        log.info("[dry-run] Would preserve %d user(s) outside the wipe", len(preserve_set))
        return

    for table in WIPE_ORDER:
        log.info("Truncating %s", table)
        # Supabase doesn't expose TRUNCATE via PostgREST — use DELETE WHERE
        # id IS NOT NULL which is equivalent for our use (no nullable PKs).
        staging_client.table(table).delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
