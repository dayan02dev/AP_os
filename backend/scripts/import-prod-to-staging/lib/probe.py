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

    Supabase project URLs look like ``https://<ref>.supabase.co``. We
    parse the host and check that its first label equals the expected ref.

    Raises:
        SafetyCheckFailed: with a message naming ``label`` (e.g. "prod"
            or "staging") so the operator can see immediately which env
            var is wrong.
    """
    if not url:
        raise SafetyCheckFailed(
            f"{label} URL is empty — set the relevant env var in .env.import."
        )
    try:
        parsed = urlparse(url)
    except Exception as exc:
        raise SafetyCheckFailed(
            f"{label} URL {url!r} is not parseable: {exc}"
        ) from exc

    host = parsed.hostname or ""
    actual_ref = host.split(".", 1)[0] if host else ""
    if actual_ref != expected_project_ref:
        raise SafetyCheckFailed(
            f"{label} URL points at project {actual_ref!r}, "
            f"expected {expected_project_ref!r}. Refusing to proceed — "
            f"a typo here could destroy the wrong database."
        )
