"""Constants + tiny utilities used across the prod→staging import script.

Single source of truth for:
  * project reference strings (used by lib/probe.py for URL safety checks)
  * which prod table names get renamed on insert to staging
  * which emails to preserve when wiping staging seed data
  * batched() — chunk an iterable into N-sized lists for bulk inserts
"""

from __future__ import annotations

from typing import Iterable, Iterator, TypeVar

# ─── Supabase project references ────────────────────────────────────────
# Used by lib/probe.py to verify the .env.import is pointing at the
# expected projects BEFORE doing anything destructive. Hard-coded on
# purpose — a typo in a URL must never let the wipe target the wrong DB.

PROD_PROJECT_REF = "xtmszlpwgbyoumalgbhs"
STAGING_PROJECT_REF = "exqmxvdtcsvpgtftwjml"

# ─── Table name mapping ────────────────────────────────────────────────
# Prod is pre-migration-010 so the TIR tables still carry their original
# names. The script reads from prod under the keys here and INSERTs into
# staging under the values.

TABLE_MAP: dict[str, str] = {
    "applications": "tir_applications",
    "resume_uploads": "tir_resume_uploads",
}

# ─── Admin Phase-1 tables ──────────────────────────────────────────────
# Prod doesn't have these. The script does NOT query prod for them and
# does NOT insert into staging for them (staging's wipe step in
# lib/wipe.py leaves them empty anyway). Listed here so reviewers can
# see why imported apps land with empty AI scores / reviews / history.

SKIPPED_TABLES_PROD_MISSING: list[str] = [
    "user_roles",
    "reviewer_assignments",
    "reviews",
    "ai_screening",
    "application_status_log",
    "audit_log_v2",
]

# ─── SIP — skipped end-to-end ──────────────────────────────────────────
# Prod has no SIP applications + no sip_* tables + no sip-* buckets.
SIP_TABLES_TO_SKIP: list[str] = ["sip_applications", "sip_resume_uploads"]
SIP_BUCKETS_TO_SKIP: list[str] = [
    "sip-resumes", "sip-evidence-files", "sip-milestone-files",
]

# ─── Preserve list — never delete from staging ─────────────────────────
# 3 sign-in test users always preserved. Plus every email currently
# holding the 'reviewer' role in staging's user_roles at wipe time —
# resolved DYNAMICALLY in lib/wipe.py (see resolve_preserve_set()).
# The static set below is just the always-preserved logins.

PRESERVE_EMAILS: set[str] = {
    "dev@artpark.in",
    "manager@artpark.in",
    "test@artpark.in",
}

# ─── batched() — chunk an iterable into N-sized lists ──────────────────

T = TypeVar("T")


def batched(items: Iterable[T], batch_size: int) -> Iterator[list[T]]:
    """Yield ``items`` as a sequence of lists no longer than ``batch_size``.

    The final batch may be shorter. Behaves on an empty iterable by
    yielding nothing.
    """
    batch: list[T] = []
    for item in items:
        batch.append(item)
        if len(batch) >= batch_size:
            yield batch
            batch = []
    if batch:
        yield batch
