"""Safety probes that run before the script does anything destructive.

Three checks live here:
  1. URL-vs-expected-project-ref guard (this file) — pure function,
     unit-tested.
  2. Column inventory probe via information_schema — integration code
     that talks to Supabase. Added in Task 4 (same file).
  3. Seed-data signature check — added in Task 4 (same file).

If any check fails the script aborts BEFORE touching a single row.
"""

from __future__ import annotations

from urllib.parse import urlparse


class SafetyCheckFailed(Exception):
    """Raised when a pre-flight check rejects the .env.import config."""


def assert_url_matches_project(
    *, url: str, expected_project_ref: str, label: str,
) -> None:
    """Verify ``url`` points at the Supabase project named by ``expected_project_ref``.

    Requires the hostname to be EXACTLY ``<expected_project_ref>.supabase.co``.
    Partial matches (e.g. subdomain-squatting via
    ``xtmszlpwgbyoumalgbhs.supabase.co.evil.com``) are rejected.

    Raises:
        SafetyCheckFailed: with a message naming ``label`` (e.g. "prod"
            or "staging") so the operator can see immediately which env
            var is wrong.
    """
    if not url:
        raise SafetyCheckFailed(
            f"{label} URL is empty — set the relevant env var in .env.import."
        )
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    expected_host = f"{expected_project_ref}.supabase.co"
    if host != expected_host:
        raise SafetyCheckFailed(
            f"{label} URL host is {host!r}, expected {expected_host!r}. "
            f"Refusing to proceed — a typo or rebind here could destroy "
            f"the wrong database."
        )


# ─── Column inventory ───────────────────────────────────────────────


def column_inventory(client, *, schema: str = "public", table: str) -> set[str]:
    """Return the set of column names that exist on ``schema.table``.

    Queries Supabase's ``information_schema.columns`` view. Returns an
    empty set if the table doesn't exist — caller decides whether that
    is an error or just "skip this table."
    """
    res = (
        client.table("information_schema.columns")
        .select("column_name")
        .eq("table_schema", schema)
        .eq("table_name", table)
        .execute()
    )
    return {row["column_name"] for row in (res.data or [])}


# ─── Seed-data signature check ──────────────────────────────────────


def seed_signature_present(staging_client) -> bool:
    """Return True iff staging.tir_applications has at least one row whose
    basic_email matches the synthetic seed pattern ``%@artpark.test``.

    Used as the final pre-flight safety check before the wipe: if no
    seed signature is present, the script aborts because either (a) the
    wipe has already run on this DB, or (b) STAGING_SUPABASE_URL is
    accidentally pointed at something that ISN'T the seeded staging DB.
    """
    res = (
        staging_client.table("tir_applications")
        .select("id")
        .like("basic_email", "%@artpark.test")
        .limit(1)
        .execute()
    )
    return bool(res.data)
