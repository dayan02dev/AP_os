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
