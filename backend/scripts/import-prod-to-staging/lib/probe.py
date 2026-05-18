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

    Supabase's PostgREST API doesn't expose ``information_schema`` over
    REST (only the ``public`` schema is auto-exposed), so we sample one
    row from the target table and read its keys. The ``schema`` arg is
    accepted for forward-compat but currently only ``public`` works
    over PostgREST.

    Returns an empty set if the table is empty or doesn't exist —
    caller decides whether that's an error or just "skip this table."
    """
    if schema != "public":
        # Non-public schemas aren't reachable via PostgREST. Caller should
        # know — return empty so the column intersection is empty and the
        # caller logs the divergence.
        return set()
    try:
        res = client.table(table).select("*").limit(1).execute()
    except Exception:
        return set()
    if not res.data:
        return set()
    return set(res.data[0].keys())


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
