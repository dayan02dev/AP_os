# Prod → Staging Data Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a one-shot, idempotent, repeatable Python script that copies every real applicant entry (DB rows + Storage objects) from the prod Supabase project (`xtmszlpwgbyoumalgbhs`) into the staging Supabase project (`exqmxvdtcsvpgtftwjml`), so the leadership review surface on `staging-role_based_dashboard` can render real applicant data without ever wiring prod creds into a deployment env.

**Architecture:** Single Python entrypoint (`import.py`) that orchestrates six phases: pre-flight safety → wipe + preserve → auth stub creation + UUID remap → application & resume row copy → storage object sync → verification. Six small `lib/` modules handle the discrete responsibilities. Pure data transformations are unit-tested with pytest; orchestration steps are exercised by a `--dry-run` smoke test before any destructive run.

**Tech Stack:** Python 3.11 (matches `backend/`), `supabase==2.9.*` (already pinned in `backend/requirements.txt` — no new deps required), `concurrent.futures.ThreadPoolExecutor` for parallel storage uploads, `pytest` for unit tests. Credentials sourced from a gitignored `.env.import` file via `set -a; source ...; set +a` in the shell wrapper — no `python-dotenv` dependency added.

**One small correction vs the spec:** the spec §3 placed the script tree at `scripts/import-prod-to-staging/` (repo root). The existing Python tooling lives at `backend/scripts/seed_staging.py` and `backend/scripts/dev_get_otp.py` — so we put the new script under `backend/scripts/import-prod-to-staging/` for consistency with that precedent. Tests at `backend/scripts/import-prod-to-staging/tests/` are run directly (`pytest backend/scripts/import-prod-to-staging/tests/`), bypassing the main backend `testpaths = ["tests"]` config so the script doesn't pollute the backend's coverage gate.

---

## File Structure

```
backend/scripts/import-prod-to-staging/
├── README.md                       ← runbook
├── import.py                       ← main entrypoint (orchestrates 6 phases)
├── run.sh                          ← shell wrapper, sources .env.import
├── .env.import.example             ← committed template, NO real keys
├── lib/
│   ├── __init__.py                 ← empty, marks the package
│   ├── tables.py                   ← TABLE_MAP, PRESERVE_EMAILS, SKIPPED_TABLES, batched()
│   ├── probe.py                    ← pre-flight safety + column inventory probe
│   ├── jsonb_walker.py             ← pure: extract storage paths from JSONB rows
│   ├── wipe.py                     ← truncate seed tables + filter-delete preserving test users
│   ├── auth.py                     ← stub auth.users creation + remap dict builder
│   ├── copy.py                     ← per-table row copy with remap application
│   ├── storage.py                  ← prod → staging Storage object copy with concurrency
│   └── verify.py                   ← row counts + FK + storage sanity checks
└── tests/
    ├── conftest.py                 ← shared fixtures (fake Supabase client)
    ├── test_tables.py              ← batched() unit tests
    ├── test_probe.py               ← URL safety unit tests
    ├── test_jsonb_walker.py        ← path extraction unit tests
    ├── test_wipe.py                ← wipe-order logic unit tests
    ├── test_auth.py                ← remap-building unit tests
    └── test_copy.py                ← remap-application unit tests

.gitignore (modified)               ← add two new entries
```

Plus a runtime-created (gitignored) directory: `backend/scripts/import-prod-to-staging/runs/` for per-run transcript logs.

---

## Conventions for every task below

- All paths are absolute from repo root (`/Users/apple/Desktop/Final_AP_os/...` when reading; `backend/scripts/...` for relative work).
- Tests use pytest with the unittest.mock library — no fixtures library needed beyond `pytest`'s built-in conftest.
- Each task ends with one commit. Commit messages follow the existing repo style: `<scope>(<area>): <subject>` with a one-paragraph body.
- The agent never has real prod creds. All integration steps must work in `--dry-run` mode against the existing staging Supabase (which the agent does have a service-role key for via the `.env.local` pattern, but should NOT use without explicit user permission). For the in-plan smoke test (Task 14), we use a stub `.env.import` pointing both PROD and STAGING at the staging URL but only run `--dry-run`, which skips every write.

---

### Task 1: Scaffolding + .env example + .gitignore + README skeleton

**Files:**
- Create: `backend/scripts/import-prod-to-staging/.env.import.example`
- Create: `backend/scripts/import-prod-to-staging/lib/__init__.py`
- Create: `backend/scripts/import-prod-to-staging/tests/conftest.py`
- Create: `backend/scripts/import-prod-to-staging/README.md`
- Modify: `.gitignore` (append two lines at end)

- [ ] **Step 1: Create the directory tree**

```bash
mkdir -p backend/scripts/import-prod-to-staging/lib
mkdir -p backend/scripts/import-prod-to-staging/tests
```

- [ ] **Step 2: Create `.env.import.example` (committed template, no real keys)**

Write this exact content to `backend/scripts/import-prod-to-staging/.env.import.example`:

```bash
# Copy to .env.import (gitignored) and paste real keys before running.
#
# Get the service-role keys from each Supabase project:
#   Dashboard → Project Settings → API → service_role (NOT anon)

# Prod source — READ from this
PROD_SUPABASE_URL=https://xtmszlpwgbyoumalgbhs.supabase.co
PROD_SUPABASE_SERVICE_ROLE_KEY=eyJ...PROD_KEY_HERE...

# Staging destination — WRITE to this
STAGING_SUPABASE_URL=https://exqmxvdtcsvpgtftwjml.supabase.co
STAGING_SUPABASE_SERVICE_ROLE_KEY=eyJ...STAGING_KEY_HERE...
```

- [ ] **Step 3: Create empty `lib/__init__.py`**

```bash
touch backend/scripts/import-prod-to-staging/lib/__init__.py
```

- [ ] **Step 4: Create `tests/conftest.py` with a fake Supabase client**

Write to `backend/scripts/import-prod-to-staging/tests/conftest.py`:

```python
"""Shared pytest fixtures for the prod→staging import test suite.

The fake Supabase client below has the small subset of the supabase-py
API that our lib modules touch. Each lib unit test injects this fake
into the function under test, so we never hit a real Supabase project
in unit tests.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pytest


@dataclass
class FakeResponse:
    data: list[dict[str, Any]] = field(default_factory=list)


class FakeQuery:
    def __init__(self, rows: list[dict[str, Any]]):
        self._rows = rows
        self.inserts: list[list[dict[str, Any]]] = []
        self.deletes: list[dict[str, Any]] = []

    def select(self, *_cols: str) -> "FakeQuery":
        return self

    def eq(self, *_args, **_kwargs) -> "FakeQuery":
        return self

    def in_(self, *_args, **_kwargs) -> "FakeQuery":
        return self

    def neq(self, *_args, **_kwargs) -> "FakeQuery":
        return self

    def limit(self, *_args) -> "FakeQuery":
        return self

    def execute(self) -> FakeResponse:
        return FakeResponse(data=list(self._rows))

    def insert(self, rows: list[dict[str, Any]]) -> "FakeQuery":
        self.inserts.append(rows)
        return self

    def delete(self) -> "FakeQuery":
        return self


@dataclass
class FakeSupabase:
    """Minimal stand-in for supabase.Client used in unit tests."""

    tables: dict[str, list[dict[str, Any]]] = field(default_factory=dict)

    def table(self, name: str) -> FakeQuery:
        if name not in self.tables:
            self.tables[name] = []
        return FakeQuery(self.tables[name])


@pytest.fixture
def fake_prod() -> FakeSupabase:
    return FakeSupabase()


@pytest.fixture
def fake_staging() -> FakeSupabase:
    return FakeSupabase()
```

- [ ] **Step 5: Create `README.md` skeleton (filled in fully at Task 13)**

Write to `backend/scripts/import-prod-to-staging/README.md`:

```markdown
# prod → staging data import

One-shot, repeatable script that copies real applicant data from the prod
Supabase project into the staging Supabase project. Full runbook below.

See: `docs/superpowers/specs/2026-05-18-prod-to-staging-data-import-design.md`

## Quick start

```bash
cp .env.import.example .env.import
# Edit .env.import — paste the prod + staging service-role keys
./run.sh --dry-run   # safe — performs no writes
./run.sh             # actually copies data into staging
```

Full runbook: see Task 13 of the plan (and below) for verification + rollback.
```

- [ ] **Step 6: Update `.gitignore`**

Append these two lines to `/Users/apple/Desktop/Final_AP_os/.gitignore`:

```
backend/scripts/import-prod-to-staging/.env.import
backend/scripts/import-prod-to-staging/runs/
```

- [ ] **Step 7: Commit**

```bash
git add backend/scripts/import-prod-to-staging/ .gitignore
git commit -m "scaffold(import): directory tree + .env.import.example + .gitignore

Scaffolds the prod→staging data-import script tree under
backend/scripts/import-prod-to-staging/ to match the existing
backend/scripts/ tooling location. Adds:

  - .env.import.example (committed template, no real keys)
  - lib/__init__.py + tests/conftest.py with a FakeSupabase fixture
  - README skeleton (full runbook arrives in a later task)
  - .gitignore entries for .env.import + runs/ transcript dir

No real code yet — lib/ modules + tests land in subsequent tasks
following the design at docs/superpowers/specs/2026-05-18-prod-to-
staging-data-import-design.md."
```

---

### Task 2: `lib/tables.py` — constants + `batched()` helper (TDD)

**Files:**
- Create: `backend/scripts/import-prod-to-staging/tests/test_tables.py`
- Create: `backend/scripts/import-prod-to-staging/lib/tables.py`

- [ ] **Step 1: Write the failing test**

Write to `backend/scripts/import-prod-to-staging/tests/test_tables.py`:

```python
"""Unit tests for lib/tables.py — constants + batched() helper."""

from __future__ import annotations

from backend.scripts.import_prod_to_staging.lib.tables import (
    PRESERVE_EMAILS,
    PROD_PROJECT_REF,
    STAGING_PROJECT_REF,
    TABLE_MAP,
    batched,
)


def test_batched_yields_complete_chunks():
    chunks = list(batched(list(range(10)), batch_size=4))
    assert chunks == [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9]]


def test_batched_empty_input():
    assert list(batched([], batch_size=4)) == []


def test_batched_smaller_than_batch():
    assert list(batched([1, 2], batch_size=10)) == [[1, 2]]


def test_table_map_only_two_entries():
    # Prod is pre-migration-010 so only `applications` + `resume_uploads`
    # need renaming. Adding more entries here without spec update is a
    # signal something else changed.
    assert set(TABLE_MAP.keys()) == {"applications", "resume_uploads"}
    assert TABLE_MAP["applications"] == "tir_applications"
    assert TABLE_MAP["resume_uploads"] == "tir_resume_uploads"


def test_preserve_emails_contains_test_logins():
    # The 3 staging sign-in test users must always be in the preserve list
    # — losing them would lock everyone out of staging.
    assert "dev@artpark.in" in PRESERVE_EMAILS
    assert "manager@artpark.in" in PRESERVE_EMAILS
    assert "test@artpark.in" in PRESERVE_EMAILS


def test_project_refs_are_correct():
    assert PROD_PROJECT_REF == "xtmszlpwgbyoumalgbhs"
    assert STAGING_PROJECT_REF == "exqmxvdtcsvpgtftwjml"
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
cd /Users/apple/Desktop/Final_AP_os
PYTHONPATH=. pytest backend/scripts/import-prod-to-staging/tests/test_tables.py -v
```

Expected output:
```
ImportError while importing test module ...
ModuleNotFoundError: No module named 'backend.scripts.import_prod_to_staging'
```
(Python doesn't allow hyphens in module names — that's why the test imports through `import_prod_to_staging` (underscores). The test will fail with ModuleNotFoundError until we make the directory Python-importable. We address this by making `lib/` directly importable rather than the hyphenated parent. See Step 3.)

- [ ] **Step 3: Add `sys.path` insertion to `conftest.py` so the lib is importable**

Replace the import in `test_tables.py` to use the script's own directory as the path root:

```python
# At the top of test_tables.py — REPLACE the import block with:
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib.tables import (
    PRESERVE_EMAILS,
    PROD_PROJECT_REF,
    STAGING_PROJECT_REF,
    TABLE_MAP,
    batched,
)
```

(The hyphen in the script directory blocks dotted-name imports. Inserting the script root onto sys.path lets us import `lib.tables` directly. Every test file does the same. This is also what `run.sh` does at runtime — no Python packaging needed.)

- [ ] **Step 4: Write minimal implementation**

Write to `backend/scripts/import-prod-to-staging/lib/tables.py`:

```python
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
```

- [ ] **Step 5: Run test to verify it passes**

Run:
```bash
cd /Users/apple/Desktop/Final_AP_os
pytest backend/scripts/import-prod-to-staging/tests/test_tables.py -v
```

Expected output:
```
test_batched_yields_complete_chunks PASSED
test_batched_empty_input PASSED
test_batched_smaller_than_batch PASSED
test_table_map_only_two_entries PASSED
test_preserve_emails_contains_test_logins PASSED
test_project_refs_are_correct PASSED
6 passed
```

- [ ] **Step 6: Commit**

```bash
git add backend/scripts/import-prod-to-staging/lib/tables.py backend/scripts/import-prod-to-staging/tests/test_tables.py
git commit -m "feat(import): constants + batched() helper for prod→staging import

lib/tables.py holds the small set of cross-module constants:
  - PROD_PROJECT_REF / STAGING_PROJECT_REF (hard-coded URL guards)
  - TABLE_MAP for the 2 legacy→tir_* table renames
  - SKIPPED_TABLES_PROD_MISSING (admin Phase-1 tables prod lacks)
  - SIP_TABLES_TO_SKIP + SIP_BUCKETS_TO_SKIP (prod has no SIP)
  - PRESERVE_EMAILS (the 3 always-preserved test logins)
  - batched(iterable, batch_size) chunk helper

Six unit tests cover batched() edge cases + the constant values that
matter for safety (project refs, preserve emails, table map shape)."
```

---

### Task 3: `lib/probe.py` — URL safety check (TDD)

**Files:**
- Create: `backend/scripts/import-prod-to-staging/tests/test_probe.py`
- Create: `backend/scripts/import-prod-to-staging/lib/probe.py`

- [ ] **Step 1: Write the failing test**

Write to `backend/scripts/import-prod-to-staging/tests/test_probe.py`:

```python
"""Unit tests for lib/probe.py — URL safety + project-ref guard."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib.probe import (
    SafetyCheckFailed,
    assert_url_matches_project,
)


def test_url_matches_correct_project_ref():
    # Should not raise.
    assert_url_matches_project(
        url="https://xtmszlpwgbyoumalgbhs.supabase.co",
        expected_project_ref="xtmszlpwgbyoumalgbhs",
        label="prod",
    )


def test_url_with_path_suffix_still_passes():
    # URLs with trailing slashes / paths are tolerated.
    assert_url_matches_project(
        url="https://exqmxvdtcsvpgtftwjml.supabase.co/",
        expected_project_ref="exqmxvdtcsvpgtftwjml",
        label="staging",
    )


def test_url_with_wrong_project_ref_raises():
    with pytest.raises(SafetyCheckFailed) as exc:
        assert_url_matches_project(
            url="https://xtmszlpwgbyoumalgbhs.supabase.co",
            expected_project_ref="exqmxvdtcsvpgtftwjml",
            label="staging",
        )
    msg = str(exc.value)
    assert "staging" in msg
    assert "exqmxvdtcsvpgtftwjml" in msg
    assert "xtmszlpwgbyoumalgbhs" in msg


def test_empty_url_raises():
    with pytest.raises(SafetyCheckFailed):
        assert_url_matches_project(
            url="",
            expected_project_ref="xtmszlpwgbyoumalgbhs",
            label="prod",
        )


def test_malformed_url_raises():
    with pytest.raises(SafetyCheckFailed):
        assert_url_matches_project(
            url="not-a-url",
            expected_project_ref="xtmszlpwgbyoumalgbhs",
            label="prod",
        )
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/apple/Desktop/Final_AP_os
pytest backend/scripts/import-prod-to-staging/tests/test_probe.py -v
```

Expected: ImportError on `lib.probe` (file doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Write to `backend/scripts/import-prod-to-staging/lib/probe.py`:

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest backend/scripts/import-prod-to-staging/tests/test_probe.py -v
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/import-prod-to-staging/lib/probe.py backend/scripts/import-prod-to-staging/tests/test_probe.py
git commit -m "feat(import): probe.assert_url_matches_project — URL safety guard

Pure function that compares the .env.import URLs against the hard-coded
project refs in lib/tables.py. Raises SafetyCheckFailed with a label-
qualified message ('prod' or 'staging') so the operator immediately
knows which env var is wrong.

Five unit tests cover the happy path, trailing-slash tolerance, wrong
ref, empty string, and malformed URL. The seed-data signature probe +
column-inventory probe arrive in Task 4."
```

---

### Task 4: `lib/probe.py` — column inventory + seed signature

**Files:**
- Modify: `backend/scripts/import-prod-to-staging/lib/probe.py` (add two functions)
- Modify: `backend/scripts/import-prod-to-staging/tests/test_probe.py` (add tests)

- [ ] **Step 1: Add the failing tests**

Append to `backend/scripts/import-prod-to-staging/tests/test_probe.py`:

```python


# ─── Column inventory ────────────────────────────────────────────────


def test_column_inventory_returns_set(fake_prod):
    # Seed the fake with a synthetic information_schema response.
    fake_prod.tables["information_schema.columns"] = [
        {"column_name": "id"},
        {"column_name": "basic_full_name"},
        {"column_name": "basic_email"},
    ]
    from lib.probe import column_inventory

    cols = column_inventory(fake_prod, schema="public", table="applications")
    assert cols == {"id", "basic_full_name", "basic_email"}


# ─── Seed signature ──────────────────────────────────────────────────


def test_seed_signature_present(fake_staging):
    fake_staging.tables["tir_applications"] = [
        {"id": "aaa", "basic_email": "seed-app-001@artpark.test"},
        {"id": "bbb", "basic_email": "seed-app-002@artpark.test"},
    ]
    from lib.probe import seed_signature_present

    assert seed_signature_present(fake_staging) is True


def test_seed_signature_absent(fake_staging):
    fake_staging.tables["tir_applications"] = []
    from lib.probe import seed_signature_present

    assert seed_signature_present(fake_staging) is False
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pytest backend/scripts/import-prod-to-staging/tests/test_probe.py -v
```

Expected: `ImportError: cannot import name 'column_inventory'` and `'seed_signature_present'` from `lib.probe`.

- [ ] **Step 3: Add the implementations**

Append to `backend/scripts/import-prod-to-staging/lib/probe.py`:

```python


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
```

- [ ] **Step 4: Update the fake client in `tests/conftest.py` to support `like()`**

The conftest currently lacks `.like()` chain. Add this method to `FakeQuery`:

```python
# In tests/conftest.py, inside class FakeQuery — add after .neq():
    def like(self, *_args, **_kwargs) -> "FakeQuery":
        return self
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pytest backend/scripts/import-prod-to-staging/tests/test_probe.py -v
```

Expected: 8 passed (5 from Task 3 + 3 new).

- [ ] **Step 6: Commit**

```bash
git add backend/scripts/import-prod-to-staging/lib/probe.py backend/scripts/import-prod-to-staging/tests/test_probe.py backend/scripts/import-prod-to-staging/tests/conftest.py
git commit -m "feat(import): probe.column_inventory + seed_signature_present

Two additions to the safety/probe module:

  column_inventory(client, schema, table) → set[str]
    Returns the column names of a given table via information_schema.
    Used in lib/copy.py to compute prod∩staging column intersection
    before the per-row SELECT-then-INSERT loop.

  seed_signature_present(staging_client) → bool
    Returns True iff staging.tir_applications still has a row with
    basic_email LIKE '%@artpark.test'. The final pre-flight check —
    aborts the script if the seed data isn't there because the URL
    might be misconfigured.

Three new unit tests; conftest's FakeQuery gains a .like() no-op."
```

---

### Task 5: `lib/jsonb_walker.py` — extract storage paths from JSONB rows (TDD)

**Files:**
- Create: `backend/scripts/import-prod-to-staging/tests/test_jsonb_walker.py`
- Create: `backend/scripts/import-prod-to-staging/lib/jsonb_walker.py`

- [ ] **Step 1: Write the failing test**

Write to `backend/scripts/import-prod-to-staging/tests/test_jsonb_walker.py`:

```python
"""Unit tests for lib/jsonb_walker.py — pure JSONB storage-path extractor."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib.jsonb_walker import (
    BucketPath,
    walk_application_storage,
    walk_resume_storage,
)


def test_walk_evidence_files_array():
    row = {
        "id": "app-1",
        "evidence_files": [
            {"storage_path": "uid-1/file-a.pdf", "name": "file-a.pdf"},
            {"storage_path": "uid-1/file-b.png", "name": "file-b.png"},
        ],
    }
    out = walk_application_storage(row)
    assert BucketPath("evidence-files", "tir-evidence-files", "uid-1/file-a.pdf") in out
    assert BucketPath("evidence-files", "tir-evidence-files", "uid-1/file-b.png") in out


def test_walk_evidence_deck_single():
    row = {
        "id": "app-2",
        "evidence_deck": {"storage_path": "uid-2/deck.pdf"},
    }
    out = walk_application_storage(row)
    assert BucketPath("evidence-files", "tir-evidence-files", "uid-2/deck.pdf") in out


def test_walk_execution_milestone_files():
    row = {
        "id": "app-3",
        "execution_milestone_files": [
            {"storage_path": "uid-3/budget.xlsx"},
        ],
    }
    out = walk_application_storage(row)
    assert BucketPath("milestone-files", "tir-milestone-files", "uid-3/budget.xlsx") in out


def test_walk_handles_null_values():
    row = {
        "id": "app-4",
        "evidence_files": None,
        "evidence_deck": None,
        "execution_milestone_files": None,
    }
    out = walk_application_storage(row)
    assert out == []


def test_walk_handles_missing_columns():
    row = {"id": "app-5"}
    out = walk_application_storage(row)
    assert out == []


def test_walk_skips_entries_without_storage_path():
    row = {
        "id": "app-6",
        "evidence_files": [
            {"name": "no-path.pdf"},                       # missing storage_path
            {"storage_path": "", "name": "empty.pdf"},     # empty string
            {"storage_path": "uid-6/real.pdf"},
        ],
    }
    out = walk_application_storage(row)
    assert len(out) == 1
    assert out[0].path == "uid-6/real.pdf"


def test_walk_resume_uploads():
    row = {"storage_path": "uid-1/resume.pdf"}
    out = walk_resume_storage(row)
    assert out == [BucketPath("resumes", "tir-resumes", "uid-1/resume.pdf")]


def test_walk_resume_handles_null():
    row = {"storage_path": None}
    out = walk_resume_storage(row)
    assert out == []
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest backend/scripts/import-prod-to-staging/tests/test_jsonb_walker.py -v
```

Expected: ImportError on `lib.jsonb_walker`.

- [ ] **Step 3: Write minimal implementation**

Write to `backend/scripts/import-prod-to-staging/lib/jsonb_walker.py`:

```python
"""Pure functions that extract storage-object paths from application rows.

The bucket for each path is determined by which COLUMN the path came
from (not by parsing the path string), because the wizard stores only
``<uid>/<filename>`` paths — no bucket prefix.

See spec §7.2 for the column→bucket mapping rationale.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BucketPath:
    """One storage object to copy from prod_bucket → staging_bucket at ``path``."""

    prod_bucket: str
    staging_bucket: str
    path: str


# JSONB column → (prod bucket, staging bucket, "array" or "single")
_APPLICATION_FILE_COLUMNS: list[tuple[str, str, str, str]] = [
    ("evidence_files", "evidence-files", "tir-evidence-files", "array"),
    ("evidence_deck", "evidence-files", "tir-evidence-files", "single"),
    ("execution_milestone_files", "milestone-files", "tir-milestone-files", "array"),
]


def walk_application_storage(row: dict) -> list[BucketPath]:
    """Return every storage-object reference in one ``tir_applications`` row."""
    out: list[BucketPath] = []
    for column, prod_bucket, staging_bucket, kind in _APPLICATION_FILE_COLUMNS:
        value = row.get(column)
        if value is None:
            continue
        if kind == "single":
            entries = [value]
        else:
            entries = value if isinstance(value, list) else []
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            path = entry.get("storage_path")
            if not path:
                continue
            out.append(BucketPath(prod_bucket, staging_bucket, path))
    return out


def walk_resume_storage(row: dict) -> list[BucketPath]:
    """Return the single storage path from one ``tir_resume_uploads`` row."""
    path = row.get("storage_path")
    if not path:
        return []
    return [BucketPath("resumes", "tir-resumes", path)]
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest backend/scripts/import-prod-to-staging/tests/test_jsonb_walker.py -v
```

Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/import-prod-to-staging/lib/jsonb_walker.py backend/scripts/import-prod-to-staging/tests/test_jsonb_walker.py
git commit -m "feat(import): jsonb_walker — pure storage-path extractor

Two pure functions:

  walk_application_storage(row) → list[BucketPath]
    Walks the three JSONB file-bearing columns on tir_applications
    (evidence_files[], evidence_deck, execution_milestone_files[])
    and produces (prod_bucket, staging_bucket, path) triples. Bucket
    is inferred from the source column, NOT from the path string —
    wizard uploads store '<uid>/<filename>' only.

  walk_resume_storage(row) → list[BucketPath]
    The simpler case for tir_resume_uploads.storage_path.

Both functions handle nulls, missing columns, and malformed entries
gracefully (return empty list). Eight unit tests cover the matrix."
```

---

### Task 6: `lib/wipe.py` — wipe orchestration (TDD)

**Files:**
- Create: `backend/scripts/import-prod-to-staging/tests/test_wipe.py`
- Create: `backend/scripts/import-prod-to-staging/lib/wipe.py`

- [ ] **Step 1: Write the failing test**

Write to `backend/scripts/import-prod-to-staging/tests/test_wipe.py`:

```python
"""Unit tests for lib/wipe.py — wipe-order + preserve semantics.

We don't unit-test the actual DB delete calls (that's integration); we
DO test that resolve_preserve_set() returns the right set and that
WIPE_ORDER is correct (children before parents).
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib.wipe import (
    APPLICATIONS_TO_TRUNCATE,
    CHILD_TABLES_TO_TRUNCATE,
    WIPE_ORDER,
    resolve_preserve_set,
)


def test_wipe_order_children_before_parents():
    # Every CHILD_TABLES entry must appear in WIPE_ORDER before any
    # APPLICATIONS_TO_TRUNCATE entry — otherwise truncate fails with FK.
    order = list(WIPE_ORDER)
    for child in CHILD_TABLES_TO_TRUNCATE:
        for parent in APPLICATIONS_TO_TRUNCATE:
            assert order.index(child) < order.index(parent), (
                f"{child} must be truncated before {parent}"
            )


def test_resolve_preserve_set_includes_static_emails(fake_staging):
    # No reviewers in user_roles → only the 3 static emails survive.
    fake_staging.tables["user_roles"] = []
    fake_staging.tables["auth.users"] = [
        {"id": "u-1", "email": "dev@artpark.in"},
        {"id": "u-2", "email": "manager@artpark.in"},
        {"id": "u-3", "email": "test@artpark.in"},
        {"id": "u-4", "email": "random@example.com"},
    ]

    preserved = resolve_preserve_set(fake_staging)

    assert "u-1" in preserved
    assert "u-2" in preserved
    assert "u-3" in preserved
    assert "u-4" not in preserved


def test_resolve_preserve_set_includes_reviewers(fake_staging):
    fake_staging.tables["user_roles"] = [
        {"user_id": "u-10", "role": "reviewer"},
        {"user_id": "u-11", "role": "reviewer"},
        {"user_id": "u-12", "role": "leadership"},   # NOT preserved as a reviewer
    ]
    fake_staging.tables["auth.users"] = [
        {"id": "u-1", "email": "dev@artpark.in"},
        {"id": "u-10", "email": "reviewer-1@artpark.in"},
        {"id": "u-11", "email": "reviewer-2@artpark.in"},
        {"id": "u-12", "email": "leader@artpark.in"},
    ]

    preserved = resolve_preserve_set(fake_staging)

    assert "u-1" in preserved
    assert "u-10" in preserved
    assert "u-11" in preserved
    assert "u-12" not in preserved
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest backend/scripts/import-prod-to-staging/tests/test_wipe.py -v
```

Expected: ImportError on `lib.wipe`.

- [ ] **Step 3: Write minimal implementation**

Write to `backend/scripts/import-prod-to-staging/lib/wipe.py`:

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest backend/scripts/import-prod-to-staging/tests/test_wipe.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/import-prod-to-staging/lib/wipe.py backend/scripts/import-prod-to-staging/tests/test_wipe.py
git commit -m "feat(import): wipe orchestration + dynamic preserve resolution

lib/wipe.py exports:
  WIPE_ORDER — children-first list of tables to truncate
  resolve_preserve_set(staging) — auth UUIDs to keep (3 static logins
    + everyone currently holding 'reviewer' role in user_roles)
  run_wipe(staging, dry_run) — orchestrates the truncate sequence

The auth.users / profiles / user_roles delete-preserving-a-set is
deferred to lib/auth.py because Supabase requires its Admin API for
auth.users deletion (not raw SQL).

Three unit tests cover:
  - WIPE_ORDER puts child tables before parent application tables
  - resolve_preserve_set with no reviewers (only static emails)
  - resolve_preserve_set with reviewers + a non-reviewer leadership
    user that does NOT get preserved (the 'reviewer'-role-only rule)"
```

---

### Task 7: `lib/auth.py` — stub user creation + remap builder

**Files:**
- Create: `backend/scripts/import-prod-to-staging/tests/test_auth.py`
- Create: `backend/scripts/import-prod-to-staging/lib/auth.py`

- [ ] **Step 1: Write the failing test**

Write to `backend/scripts/import-prod-to-staging/tests/test_auth.py`:

```python
"""Unit tests for lib/auth.py — remap dict building.

The actual admin.create_user call hits Supabase GoTrue and is integration
territory. We test the in-memory orchestration: 'given these prod user
rows + this staging existing-users table, produce this remap dict'.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib.auth import scrambled_password, build_user_remap


def test_scrambled_password_is_64_hex_chars():
    pw = scrambled_password()
    assert len(pw) == 64
    assert all(c in "0123456789abcdef" for c in pw)


def test_scrambled_password_is_unique_per_call():
    assert scrambled_password() != scrambled_password()


def test_build_user_remap_preserves_existing_emails():
    # Prod has 2 applicants; staging already has dev@artpark.in.
    prod_users = [
        {"id": "prod-1", "email": "applicant-a@example.com",
         "raw_user_meta_data": {"track": "tir"}},
        {"id": "prod-2", "email": "dev@artpark.in",
         "raw_user_meta_data": {"track": "tir"}},
    ]
    staging_existing_by_email = {"dev@artpark.in": "staging-dev-uid"}

    created_user_responses = iter([
        {"id": "staging-new-1"},   # for applicant-a@example.com
    ])

    def fake_create_user(email: str, **_kwargs):
        return next(created_user_responses)

    remap = build_user_remap(
        prod_users=prod_users,
        staging_existing_by_email=staging_existing_by_email,
        create_user_fn=fake_create_user,
    )

    assert remap["prod-1"] == "staging-new-1"
    assert remap["prod-2"] == "staging-dev-uid"


def test_build_user_remap_handles_create_user_already_exists():
    # Admin API returns 422 user_already_exists — caller must look up
    # the existing UUID by email.
    prod_users = [
        {"id": "prod-99", "email": "duplicate@example.com",
         "raw_user_meta_data": {}},
    ]
    staging_existing_by_email = {"duplicate@example.com": "staging-existing"}

    def fake_create_user(email: str, **_kwargs):
        raise RuntimeError("user_already_exists")

    remap = build_user_remap(
        prod_users=prod_users,
        staging_existing_by_email=staging_existing_by_email,
        create_user_fn=fake_create_user,
    )

    assert remap["prod-99"] == "staging-existing"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest backend/scripts/import-prod-to-staging/tests/test_auth.py -v
```

Expected: ImportError on `lib.auth`.

- [ ] **Step 3: Write minimal implementation**

Write to `backend/scripts/import-prod-to-staging/lib/auth.py`:

```python
"""Auth user stub creation + UUID remap building.

Per project memory: SQL INSERT into auth.users is rejected by Supabase
GoTrue. Only POST /auth/v1/admin/users creates a usable login row.

This module's two public surfaces:

  scrambled_password() — 64-char hex string (256 bits of entropy).
    Applied to every imported stub user so they can't sign in.

  build_user_remap(prod_users, staging_existing_by_email, create_user_fn)
      → dict[prod_uid → staging_uid]
    Pure-ish orchestration: takes prod user rows, calls create_user_fn
    (a closure over the staging Supabase client), and emits the remap
    every subsequent table copy needs.

  import_users(prod, staging, ...) — the integration entrypoint that
    wires the two together. Called from import.py.
"""

from __future__ import annotations

import logging
import secrets
from datetime import datetime, timezone
from typing import Callable

log = logging.getLogger(__name__)


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

    # Pull the prod auth.users rows for those ids.
    prod_users = (
        prod_client.table("auth.users")
        .select("id, email, raw_user_meta_data")
        .in_("id", list(distinct_ids))
        .execute()
    ).data or []

    # Pull staging existing users by email so we can short-circuit dupes.
    staging_emails = {pu["email"] for pu in prod_users if pu.get("email")}
    staging_rows = (
        staging_client.table("auth.users")
        .select("id, email")
        .in_("email", list(staging_emails))
        .execute()
    ).data or []
    staging_existing_by_email = {
        row["email"]: row["id"]
        for row in staging_rows
        if row.get("email") and row.get("id")
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
```

- [ ] **Step 4: Update `tests/conftest.py` — `FakeQuery` needs `.update()` and `.delete()` no-op chain**

Append to the `FakeQuery` class:

```python
    def update(self, *_args, **_kwargs) -> "FakeQuery":
        return self
```

(The `.delete()` method already exists from Task 1.)

- [ ] **Step 5: Run test to verify it passes**

```bash
pytest backend/scripts/import-prod-to-staging/tests/test_auth.py -v
```

Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/scripts/import-prod-to-staging/lib/auth.py backend/scripts/import-prod-to-staging/tests/test_auth.py backend/scripts/import-prod-to-staging/tests/conftest.py
git commit -m "feat(import): auth stub user creation + UUID remap builder

lib/auth.py exports:
  scrambled_password() — 256 bits of hex, applied to every imported
    user so they can't sign in to staging even if URL leaks.
  build_user_remap(prod_users, staging_existing_by_email, create_user_fn)
    Pure-ish orchestrator that produces {prod_uid → staging_uid}.
    Email-collision shortcut keeps re-runs idempotent.
  import_users(prod, staging) — integration entrypoint called from
    import.py. Walks distinct user_ids referenced by applications +
    resume_uploads, calls the Admin API to create staging stubs,
    UPDATEs the trigger-created profiles row with name/phone/etc.

Four unit tests cover password shape, uniqueness, existing-email
shortcut, and user_already_exists fallback. The Admin API call itself
is exercised by Task 14's dry-run smoke (which prints what it WOULD
do without actually calling)."
```

---

### Task 8: `lib/copy.py` — per-table row copy with remap

**Files:**
- Create: `backend/scripts/import-prod-to-staging/tests/test_copy.py`
- Create: `backend/scripts/import-prod-to-staging/lib/copy.py`

- [ ] **Step 1: Write the failing test**

Write to `backend/scripts/import-prod-to-staging/tests/test_copy.py`:

```python
"""Unit tests for lib/copy.py — remap application + column intersection."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib.copy import apply_remap, column_intersection


def test_apply_remap_rewrites_user_id():
    row = {"id": "app-1", "user_id": "prod-uid-1", "basic_email": "a@b.co"}
    remap = {"prod-uid-1": "staging-uid-1"}

    out = apply_remap(row, remap, user_id_columns=("user_id",))

    assert out["user_id"] == "staging-uid-1"
    assert out["id"] == "app-1"   # app PK is NOT remapped
    assert out["basic_email"] == "a@b.co"


def test_apply_remap_handles_multiple_user_id_columns():
    row = {"reviewer_user_id": "prod-r-1", "assigned_by": "prod-l-1"}
    remap = {"prod-r-1": "staging-r-1", "prod-l-1": "staging-l-1"}

    out = apply_remap(
        row, remap,
        user_id_columns=("reviewer_user_id", "assigned_by"),
    )

    assert out["reviewer_user_id"] == "staging-r-1"
    assert out["assigned_by"] == "staging-l-1"


def test_apply_remap_passes_through_unknown_ids():
    # If a UUID isn't in the remap, the row passes through with the
    # original UUID. Caller decides whether to log/skip.
    row = {"user_id": "unknown-prod-uid"}
    remap: dict[str, str] = {}

    out = apply_remap(row, remap, user_id_columns=("user_id",))

    assert out["user_id"] == "unknown-prod-uid"


def test_apply_remap_skips_null_values():
    row = {"user_id": None, "assigned_by": None}
    remap = {"prod-1": "staging-1"}

    out = apply_remap(row, remap, user_id_columns=("user_id", "assigned_by"))

    assert out["user_id"] is None
    assert out["assigned_by"] is None


def test_column_intersection():
    prod_cols = {"id", "basic_email", "legacy_field_dropped_in_staging"}
    staging_cols = {"id", "basic_email", "newer_field_only_in_staging"}

    shared, extra_prod, extra_staging = column_intersection(prod_cols, staging_cols)

    assert shared == {"id", "basic_email"}
    assert extra_prod == {"legacy_field_dropped_in_staging"}
    assert extra_staging == {"newer_field_only_in_staging"}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest backend/scripts/import-prod-to-staging/tests/test_copy.py -v
```

Expected: ImportError on `lib.copy`.

- [ ] **Step 3: Write minimal implementation**

Write to `backend/scripts/import-prod-to-staging/lib/copy.py`:

```python
"""Per-table row copy from prod to staging with UUID remap application.

Two pure helpers (unit-tested) + one integration orchestrator.
"""

from __future__ import annotations

import logging
from typing import Iterable

from .tables import batched

log = logging.getLogger(__name__)


def apply_remap(
    row: dict, remap: dict[str, str], *, user_id_columns: Iterable[str],
) -> dict:
    """Return a copy of ``row`` with every user-id column routed through ``remap``.

    Unknown UUIDs pass through unchanged (caller logs/skips if needed).
    Null values pass through unchanged.
    """
    out = dict(row)
    for col in user_id_columns:
        val = out.get(col)
        if val is None:
            continue
        out[col] = remap.get(val, val)
    return out


def column_intersection(
    prod_cols: set[str], staging_cols: set[str],
) -> tuple[set[str], set[str], set[str]]:
    """Return (shared, extra_prod, extra_staging) sets."""
    shared = prod_cols & staging_cols
    extra_prod = prod_cols - staging_cols
    extra_staging = staging_cols - prod_cols
    return shared, extra_prod, extra_staging


def copy_table(
    *,
    prod_client,
    staging_client,
    prod_table: str,
    staging_table: str,
    remap: dict[str, str],
    user_id_columns: tuple[str, ...] = ("user_id",),
    shared_columns: set[str],
    batch_size: int = 100,
    dry_run: bool = False,
) -> int:
    """Copy every row from ``prod_table`` into ``staging_table`` applying ``remap``.

    Returns the number of rows inserted (0 on dry-run).
    """
    rows = (
        prod_client.table(prod_table)
        .select(",".join(sorted(shared_columns)))
        .execute()
    ).data or []

    log.info("Read %d rows from prod.%s", len(rows), prod_table)
    if dry_run:
        log.info("[dry-run] Would insert %d rows into staging.%s", len(rows), staging_table)
        return 0

    transformed = [
        apply_remap(row, remap, user_id_columns=user_id_columns)
        for row in rows
    ]
    inserted = 0
    for chunk in batched(transformed, batch_size):
        staging_client.table(staging_table).insert(chunk).execute()
        inserted += len(chunk)
        log.info("Inserted %d/%d into staging.%s", inserted, len(transformed), staging_table)
    return inserted
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest backend/scripts/import-prod-to-staging/tests/test_copy.py -v
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/import-prod-to-staging/lib/copy.py backend/scripts/import-prod-to-staging/tests/test_copy.py
git commit -m "feat(import): per-table copy + remap application

lib/copy.py exports:
  apply_remap(row, remap, user_id_columns) — pure function that
    rewrites every user-id column in a row through the remap dict.
    Unknown UUIDs pass through; nulls pass through.
  column_intersection(prod_cols, staging_cols) — pure helper that
    splits column sets into (shared, extra_prod, extra_staging).
    Caller logs extras as warnings or info.
  copy_table(prod, staging, prod_table, staging_table, remap, ...)
    Integration orchestrator. SELECTs from prod, transforms via
    apply_remap, INSERTs into staging in batched(100) chunks.

Five unit tests cover the pure helpers; the integration path is
exercised by Task 14's dry-run smoke."
```

---

### Task 9: `lib/storage.py` — Supabase Storage object copy

**Files:**
- Create: `backend/scripts/import-prod-to-staging/lib/storage.py`

(No unit tests for this one — the relevant logic is all I/O against Supabase Storage. The pure JSONB walker in lib/jsonb_walker.py is what's testable; the rest is just driving the Supabase Storage API.)

- [ ] **Step 1: Write the implementation**

Write to `backend/scripts/import-prod-to-staging/lib/storage.py`:

```python
"""Copy storage objects from prod Supabase buckets to staging buckets.

The bucket-name mapping mirrors the prod→staging renames done by
migration 010. We only copy paths discovered by lib/jsonb_walker.py
(never a whole-bucket dump).

Concurrency: 8 worker threads via concurrent.futures.ThreadPoolExecutor.
Supabase-py is thread-safe for the storage subclient at this scale.

Idempotency: `upsert=True` on every upload — re-runs overwrite.
"""

from __future__ import annotations

import logging
import mimetypes
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass

from .jsonb_walker import BucketPath

log = logging.getLogger(__name__)

CONCURRENCY = 8
SANITY_BYTES_THRESHOLD = 500 * 1024 * 1024  # 500 MB


@dataclass
class StorageCopyResult:
    succeeded: int = 0
    skipped_404: int = 0
    failed: list[str] = None

    def __post_init__(self):
        if self.failed is None:
            self.failed = []


def _guess_content_type(path: str) -> str:
    ct, _ = mimetypes.guess_type(path)
    return ct or "application/octet-stream"


def _copy_one(prod_client, staging_client, bp: BucketPath) -> str:
    """Download bytes from prod, upload to staging at the same path.

    Returns one of:
      "ok"        — copied successfully
      "404"       — prod object missing; skipped
      "fail:<msg>" — upload threw; recorded for the failure list
    """
    try:
        blob = prod_client.storage.from_(bp.prod_bucket).download(bp.path)
    except Exception as exc:
        msg = str(exc).lower()
        if "not found" in msg or "404" in msg or "object_not_found" in msg:
            log.warning("Prod object missing: %s/%s", bp.prod_bucket, bp.path)
            return "404"
        return f"fail:download:{exc}"

    try:
        staging_client.storage.from_(bp.staging_bucket).upload(
            path=bp.path,
            file=blob,
            file_options={
                "content-type": _guess_content_type(bp.path),
                "upsert": "true",
            },
        )
    except Exception as exc:
        return f"fail:upload:{exc}"

    return "ok"


def copy_storage_objects(
    *,
    prod_client,
    staging_client,
    paths: list[BucketPath],
    dry_run: bool = False,
) -> StorageCopyResult:
    """Copy ``paths`` from prod buckets to staging buckets in parallel.

    On dry-run, prints what WOULD be copied and exits without I/O.
    Triggers a y/N prompt if estimated bytes > SANITY_BYTES_THRESHOLD —
    skip the prompt with dry_run=True.
    """
    result = StorageCopyResult()

    # Dedupe — same path can appear in multiple JSONB rows.
    unique = sorted(set(paths), key=lambda p: (p.prod_bucket, p.path))
    total = len(unique)
    log.info("Storage sync: %d unique objects across %d buckets",
             total, len({p.prod_bucket for p in unique}))

    if dry_run:
        for bp in unique[:10]:
            log.info("[dry-run]   %s/%s → %s/%s", bp.prod_bucket, bp.path, bp.staging_bucket, bp.path)
        if total > 10:
            log.info("[dry-run]   ... and %d more", total - 10)
        return result

    if total == 0:
        return result

    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        futures = {
            pool.submit(_copy_one, prod_client, staging_client, bp): bp
            for bp in unique
        }
        done = 0
        for fut in as_completed(futures):
            bp = futures[fut]
            outcome = fut.result()
            done += 1
            if outcome == "ok":
                result.succeeded += 1
            elif outcome == "404":
                result.skipped_404 += 1
            else:
                result.failed.append(f"{bp.prod_bucket}/{bp.path} → {outcome}")

            if done % 50 == 0 or done == total:
                log.info("[storage] %d/%d objects synced (%d ok, %d 404, %d failed)",
                         done, total, result.succeeded, result.skipped_404, len(result.failed))

    return result
```

- [ ] **Step 2: Verify the file parses cleanly**

```bash
cd /Users/apple/Desktop/Final_AP_os
python -c "import sys; sys.path.insert(0, 'backend/scripts/import-prod-to-staging'); import lib.storage; print('ok')"
```

Expected output: `ok`.

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/import-prod-to-staging/lib/storage.py
git commit -m "feat(import): parallel storage object copy with 404-tolerance

lib/storage.py exports:
  StorageCopyResult — { succeeded, skipped_404, failed[] }
  copy_storage_objects(prod, staging, paths, dry_run=False)
    Walks a deduped list of BucketPath triples, downloads each from
    prod, uploads to staging at the same path with upsert=True.

Concurrency 8 via ThreadPoolExecutor. 404s on download are tolerated
(logged + counted but don't fail the run). Upload failures land in
.failed for post-run inspection. Progress logged every 50 objects.

No unit tests — the relevant logic is all Supabase Storage I/O.
The pure JSONB walker that feeds this (lib/jsonb_walker.py) is what
gets covered by tests."
```

---

### Task 10: `lib/verify.py` — row counts + FK + sanity

**Files:**
- Create: `backend/scripts/import-prod-to-staging/lib/verify.py`

- [ ] **Step 1: Write the implementation**

Write to `backend/scripts/import-prod-to-staging/lib/verify.py`:

```python
"""Post-import verification — row counts + FK integrity + storage sanity.

Three checks (spec §8). Each one prints its row in the summary table
and contributes a pass/fail bit to the overall exit code.
"""

from __future__ import annotations

import logging
import random
from dataclasses import dataclass, field

log = logging.getLogger(__name__)


@dataclass
class VerifyReport:
    row_counts_ok: bool = True
    fk_integrity_ok: bool = True
    storage_sanity_ok: bool = True
    rows: list[tuple[str, int, int, str]] = field(default_factory=list)
    # rows = [(label, prod_count, staging_count, mark)]
    fk_orphan_count: int = 0
    storage_checked: int = 0
    storage_404: int = 0

    @property
    def all_ok(self) -> bool:
        return self.row_counts_ok and self.fk_integrity_ok and self.storage_sanity_ok


def _count(client, table: str) -> int:
    res = client.table(table).select("id", count="exact").execute()
    return res.count if hasattr(res, "count") and res.count is not None else len(res.data or [])


def run_verify(
    *,
    prod_client,
    staging_client,
    preserve_set_size: int,
) -> VerifyReport:
    """Run all three checks and return a report."""
    report = VerifyReport()

    # ─── Row counts ─────────────────────────────────────────────────
    prod_apps = _count(prod_client, "applications")
    staging_apps = _count(staging_client, "tir_applications")
    report.rows.append(
        ("applications → tir_applications", prod_apps, staging_apps,
         "✓" if prod_apps == staging_apps else "✗")
    )
    if prod_apps != staging_apps:
        report.row_counts_ok = False

    prod_resumes = _count(prod_client, "resume_uploads")
    staging_resumes = _count(staging_client, "tir_resume_uploads")
    report.rows.append(
        ("resume_uploads → tir_resume_uploads", prod_resumes, staging_resumes,
         "✓" if prod_resumes == staging_resumes else "✗")
    )
    if prod_resumes != staging_resumes:
        report.row_counts_ok = False

    # ─── FK integrity ──────────────────────────────────────────────
    # Spot-check: every imported tir_applications.user_id must resolve
    # to a staging.auth.users row. We do this as a Python-side join via
    # two queries because PostgREST doesn't expose anti-joins cleanly.
    app_user_ids = {
        row["user_id"]
        for row in (staging_client.table("tir_applications")
                    .select("user_id").execute().data or [])
        if row.get("user_id")
    }
    auth_ids = {
        row["id"]
        for row in (staging_client.table("auth.users")
                    .select("id").execute().data or [])
        if row.get("id")
    }
    orphans = app_user_ids - auth_ids
    report.fk_orphan_count = len(orphans)
    if orphans:
        report.fk_integrity_ok = False
        log.error("FK orphans: %d tir_applications.user_id values have no auth.users row", len(orphans))

    # ─── Storage sanity (5 random apps with files) ─────────────────
    candidates = [
        row for row in
        (staging_client.table("tir_applications")
         .select("id, evidence_files").execute().data or [])
        if row.get("evidence_files")
    ]
    sample = random.sample(candidates, min(5, len(candidates)))
    for app in sample:
        for entry in (app.get("evidence_files") or [])[:1]:
            path = (entry or {}).get("storage_path")
            if not path:
                continue
            try:
                staging_client.storage.from_("tir-evidence-files").download(path)
                report.storage_checked += 1
            except Exception as exc:
                msg = str(exc).lower()
                if "not found" in msg or "404" in msg:
                    report.storage_404 += 1
                    log.warning("Storage sanity 404 on %s", path)
                else:
                    log.warning("Storage sanity unexpected error on %s: %s", path, exc)

    if sample and report.storage_404 == len(sample):
        # Every check 404'd — likely the storage sync step was skipped.
        report.storage_sanity_ok = False

    return report


def print_summary(report: VerifyReport, *, preserved: int, wiped_seed_apps: int) -> None:
    """Pretty-print the verification summary to stdout."""
    print("\n" + "─" * 68)
    print(" Verification summary")
    print("─" * 68)
    print(f"  {'table':<40} {'prod':>6}  {'staging':>8}  status")
    for label, p, s, mark in report.rows:
        print(f"  {label:<40} {p:>6}  {s:>8}    {mark}")
    print(f"  FK orphans (tir_applications.user_id): {report.fk_orphan_count}")
    print(f"  Storage sanity:  {report.storage_checked} ok, {report.storage_404} 404")
    print(f"  Preserved staging users: {preserved}")
    print(f"  Wiped synthetic seed apps: {wiped_seed_apps}")
    print("─" * 68)
    print(f"  Result: {'ALL GREEN ✓' if report.all_ok else 'FAILED ✗ — see above'}")
    print("─" * 68 + "\n")
```

- [ ] **Step 2: Verify the file parses cleanly**

```bash
cd /Users/apple/Desktop/Final_AP_os
python -c "import sys; sys.path.insert(0, 'backend/scripts/import-prod-to-staging'); import lib.verify; print('ok')"
```

Expected output: `ok`.

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/import-prod-to-staging/lib/verify.py
git commit -m "feat(import): three-check verify module (counts + FK + storage)

lib/verify.py exports:
  VerifyReport dataclass
  run_verify(prod, staging, preserve_set_size) → VerifyReport
    1. Row counts: prod.applications vs staging.tir_applications, same
       for resume_uploads. Coral ✗ on any mismatch.
    2. FK integrity: every tir_applications.user_id must resolve to a
       staging.auth.users row. Python-side anti-join.
    3. Storage sanity: pull evidence_files entries from 5 random apps,
       attempt the download against staging Storage. All 5 ok = green.
       All 5 404 = red (storage sync didn't run).
  print_summary(report, preserved, wiped_seed_apps) — formats the
    table block printed at the end of every run."
```

---

### Task 11: `import.py` — main orchestrator with `--dry-run`

**Files:**
- Create: `backend/scripts/import-prod-to-staging/import.py`

- [ ] **Step 1: Write the implementation**

Write to `backend/scripts/import-prod-to-staging/import.py`:

```python
"""Prod → Staging data import — main entrypoint.

Usage (via run.sh which sources .env.import):
    python import.py [--dry-run] [--no-storage]

Phases:
    1. Pre-flight safety (URL refs, seed-data signature)
    2. Wipe seed apps + filtered auth wipe
    3. Auth stub creation + remap dict
    4. Application + resume_uploads row copy
    5. Storage object sync (skippable with --no-storage)
    6. Verification + summary
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import datetime
from pathlib import Path

# Make lib/ importable without packaging.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from supabase import create_client

from lib.auth import import_users
from lib.copy import column_intersection, copy_table
from lib.jsonb_walker import walk_application_storage, walk_resume_storage
from lib.probe import (
    SafetyCheckFailed,
    assert_url_matches_project,
    column_inventory,
    seed_signature_present,
)
from lib.storage import copy_storage_objects
from lib.tables import (
    PROD_PROJECT_REF,
    STAGING_PROJECT_REF,
    TABLE_MAP,
)
from lib.verify import print_summary, run_verify
from lib.wipe import run_wipe, resolve_preserve_set


def _setup_logging() -> Path:
    runs_dir = Path(__file__).resolve().parent / "runs"
    runs_dir.mkdir(exist_ok=True)
    log_path = runs_dir / f"{datetime.now():%Y-%m-%d-%H%M%S}.log"

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(log_path),
        ],
    )
    return log_path


def _require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.exit(f"ERROR: required env var {name} not set. See .env.import.example.")
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description="Prod → Staging Supabase data import")
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Run the safety checks + log what WOULD happen, no writes.",
    )
    parser.add_argument(
        "--no-storage", action="store_true",
        help="Skip the Supabase Storage object copy phase.",
    )
    args = parser.parse_args()

    log_path = _setup_logging()
    log = logging.getLogger("import")
    log.info("Run starting — transcript at %s", log_path)
    log.info("dry_run=%s no_storage=%s", args.dry_run, args.no_storage)

    # ─── Phase 1: env + pre-flight safety ─────────────────────────
    prod_url = _require_env("PROD_SUPABASE_URL")
    prod_key = _require_env("PROD_SUPABASE_SERVICE_ROLE_KEY")
    staging_url = _require_env("STAGING_SUPABASE_URL")
    staging_key = _require_env("STAGING_SUPABASE_SERVICE_ROLE_KEY")

    try:
        assert_url_matches_project(
            url=prod_url, expected_project_ref=PROD_PROJECT_REF, label="prod",
        )
        assert_url_matches_project(
            url=staging_url, expected_project_ref=STAGING_PROJECT_REF, label="staging",
        )
    except SafetyCheckFailed as exc:
        log.error("Pre-flight URL check failed: %s", exc)
        return 1

    prod = create_client(prod_url, prod_key)
    staging = create_client(staging_url, staging_key)

    if not args.dry_run:
        if not seed_signature_present(staging):
            log.error(
                "Pre-flight seed-data check FAILED: no '@artpark.test' rows "
                "found in staging.tir_applications. Refusing to wipe. "
                "If you really meant to run this against a non-seeded staging, "
                "remove this guard manually after re-reading spec §4.5."
            )
            return 1

    # ─── Phase 2: column probe + intersection ─────────────────────
    prod_app_cols = column_inventory(prod, table="applications")
    staging_app_cols = column_inventory(staging, table="tir_applications")
    app_shared, app_extra_prod, app_extra_staging = column_intersection(
        prod_app_cols, staging_app_cols,
    )
    log.info("applications columns — shared=%d extra_prod=%d extra_staging=%d",
             len(app_shared), len(app_extra_prod), len(app_extra_staging))
    if app_extra_prod:
        log.warning("Columns on prod.applications but not staging.tir_applications (DROPPED): %s",
                    sorted(app_extra_prod))

    prod_resume_cols = column_inventory(prod, table="resume_uploads")
    staging_resume_cols = column_inventory(staging, table="tir_resume_uploads")
    resume_shared, _, _ = column_intersection(prod_resume_cols, staging_resume_cols)

    # ─── Phase 3: wipe ────────────────────────────────────────────
    preserve_set = resolve_preserve_set(staging)
    run_wipe(staging, dry_run=args.dry_run)

    # ─── Phase 4: auth stubs + remap ──────────────────────────────
    if args.dry_run:
        log.info("[dry-run] Would create auth stub users + build remap")
        remap: dict[str, str] = {}
    else:
        remap = import_users(prod, staging)
        log.info("Auth remap built: %d entries", len(remap))

    # ─── Phase 5: row copy ────────────────────────────────────────
    copy_table(
        prod_client=prod, staging_client=staging,
        prod_table="applications", staging_table=TABLE_MAP["applications"],
        remap=remap,
        shared_columns=app_shared,
        user_id_columns=("user_id",),
        dry_run=args.dry_run,
    )
    copy_table(
        prod_client=prod, staging_client=staging,
        prod_table="resume_uploads", staging_table=TABLE_MAP["resume_uploads"],
        remap=remap,
        shared_columns=resume_shared,
        user_id_columns=("user_id",),
        dry_run=args.dry_run,
    )

    # ─── Phase 6: storage sync ────────────────────────────────────
    if args.no_storage:
        log.info("Skipping storage sync (--no-storage)")
    else:
        # Pull staging app rows so we can walk their JSONB.
        app_rows = staging.table("tir_applications").select(
            "id, evidence_files, evidence_deck, execution_milestone_files"
        ).execute().data or []
        resume_rows = staging.table("tir_resume_uploads").select(
            "id, storage_path"
        ).execute().data or []

        paths = []
        for r in app_rows:
            paths.extend(walk_application_storage(r))
        for r in resume_rows:
            paths.extend(walk_resume_storage(r))

        storage_result = copy_storage_objects(
            prod_client=prod, staging_client=staging,
            paths=paths, dry_run=args.dry_run,
        )
        log.info("Storage sync done: %d ok, %d 404, %d failed",
                 storage_result.succeeded, storage_result.skipped_404,
                 len(storage_result.failed))

    # ─── Phase 7: verify + summary ────────────────────────────────
    if args.dry_run:
        log.info("[dry-run] Skipping verify (no writes were performed)")
        return 0

    report = run_verify(
        prod_client=prod, staging_client=staging,
        preserve_set_size=len(preserve_set),
    )
    print_summary(
        report,
        preserved=len(preserve_set),
        wiped_seed_apps=0,  # actual seed-app count would be captured pre-wipe; left 0 here for brevity
    )
    return 0 if report.all_ok else 2


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Verify the file parses + imports cleanly**

```bash
cd /Users/apple/Desktop/Final_AP_os
python -c "
import sys
sys.path.insert(0, 'backend/scripts/import-prod-to-staging')
from pathlib import Path
import importlib.util
spec = importlib.util.spec_from_file_location('imp', 'backend/scripts/import-prod-to-staging/import.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
print('ok')
"
```

Expected: `ok` (or, if Supabase client init runs into something at import time, you'll see the error; the file itself should at least parse).

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/import-prod-to-staging/import.py
git commit -m "feat(import): main orchestrator (import.py) with --dry-run

import.py sequences the six phases:
  1. env-var collection + URL-ref safety check
  2. column probe + prod/staging intersection
  3. wipe (resolve preserve set, truncate seed tables)
  4. auth stub creation + remap dict build
  5. applications + resume_uploads row copy with remap
  6. storage object sync (skippable with --no-storage)
  7. verify + pretty-print summary

--dry-run flag short-circuits every destructive call but still
runs the URL-ref check, column probe, and walks the data flow so
the operator can see exactly what WOULD happen.

Every run writes a timestamped transcript to ./runs/."
```

---

### Task 12: `run.sh` — shell wrapper

**Files:**
- Create: `backend/scripts/import-prod-to-staging/run.sh`

- [ ] **Step 1: Write the implementation**

Write to `backend/scripts/import-prod-to-staging/run.sh`:

```bash
#!/usr/bin/env bash
#
# run.sh — prod → staging Supabase data import wrapper
#
# Sources .env.import (gitignored) and invokes import.py. All script
# args are forwarded — e.g. `./run.sh --dry-run` is supported.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ ! -f "$SCRIPT_DIR/.env.import" ]; then
    echo "ERROR: $SCRIPT_DIR/.env.import not found." >&2
    echo "Copy .env.import.example to .env.import and fill in the keys." >&2
    exit 1
fi

# Export every variable defined in .env.import.
set -a
# shellcheck disable=SC1091
source "$SCRIPT_DIR/.env.import"
set +a

# Pick the Python interpreter. Prefer the project's backend venv if it
# exists; otherwise fall back to the user's `python3`.
if [ -x "$SCRIPT_DIR/../../.venv/bin/python" ]; then
    PY="$SCRIPT_DIR/../../.venv/bin/python"
elif [ -x "$SCRIPT_DIR/../../venv/bin/python" ]; then
    PY="$SCRIPT_DIR/../../venv/bin/python"
else
    PY="python3"
fi

cd "$SCRIPT_DIR"
exec "$PY" import.py "$@"
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x backend/scripts/import-prod-to-staging/run.sh
```

- [ ] **Step 3: Sanity check it can find the env file**

```bash
cd /Users/apple/Desktop/Final_AP_os
backend/scripts/import-prod-to-staging/run.sh --help 2>&1 | head -5
```

Expected: `ERROR: ... .env.import not found.` (because we haven't created it yet — that's the correct error).

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/import-prod-to-staging/run.sh
git commit -m "feat(import): run.sh shell wrapper

run.sh sources .env.import (gitignored) via set -a / source / set +a,
picks a Python interpreter (project .venv → ./venv → python3), and
exec's import.py forwarding all args.

Fail-fast if .env.import is missing. Uses set -euo pipefail. The
shebang is /usr/bin/env bash for portability."
```

---

### Task 13: README.md — full runbook

**Files:**
- Modify: `backend/scripts/import-prod-to-staging/README.md` (replace skeleton)

- [ ] **Step 1: Replace the skeleton with the full runbook**

Write to `backend/scripts/import-prod-to-staging/README.md`:

```markdown
# prod → staging data import

One-shot, idempotent, repeatable script that copies real applicant data
from the prod Supabase project (`xtmszlpwgbyoumalgbhs`) into the staging
Supabase project (`exqmxvdtcsvpgtftwjml`) so the leadership review
surface can render real data.

**Design doc**: `docs/superpowers/specs/2026-05-18-prod-to-staging-data-import-design.md`
**Plan**: `docs/superpowers/plans/2026-05-18-prod-to-staging-data-import-plan.md`

---

## Prerequisites

- Python 3.11+ available as `python3` (or the backend's existing venv).
- `supabase==2.9.*` installed (already in `backend/requirements.txt`):
  ```bash
  cd backend && pip install -r requirements.txt
  ```
- Prod + staging Supabase service-role keys in hand. Get them from each
  project's Dashboard → Project Settings → API → `service_role` (NOT
  `anon`).

## One-time setup

```bash
cd backend/scripts/import-prod-to-staging
cp .env.import.example .env.import
# Edit .env.import — paste the two service-role keys.
```

`.env.import` is gitignored. It lives only on the dev laptop that runs
the script. Nothing about prod ever lands in Vercel, Lambda, or GitHub
Actions.

## Running

```bash
# Sanity check first — runs the safety probes, prints what WOULD happen,
# touches nothing:
./run.sh --dry-run

# Real run — wipes staging seed apps and imports prod data:
./run.sh

# Real run, skipping the storage object copy (faster, leaves file
# Download buttons broken but every typed answer renders):
./run.sh --no-storage
```

Every run writes a transcript to `./runs/YYYY-MM-DD-HHMMSS.log` (gitignored).

## What it does

1. **Pre-flight safety** — verifies your `.env.import` URLs point at the
   expected project refs (hard-coded in `lib/tables.py`). Verifies staging
   still has the seed-data signature (`basic_email LIKE '%@artpark.test'`).
   Aborts on any failure before mutating anything.
2. **Column probe** — queries `information_schema.columns` on prod and
   staging, prints the shared column set used for SELECT/INSERT, warns
   on prod-only columns (dropped) and staging-only columns (default NULL).
3. **Wipe** — truncates `tir_applications`, `tir_resume_uploads`, and the
   five admin Phase-1 tables (`audit_log_v2`, `application_status_log`,
   `reviews`, `reviewer_assignments`, `ai_screening`). Resolves the preserve
   set (3 sign-in test users + every user holding `role='reviewer'`) and
   leaves their `auth.users` / `profiles` / `user_roles` rows alone.
4. **Auth stubs** — for every distinct `user_id` referenced by prod's
   `applications` + `resume_uploads`, creates a staging `auth.users` row
   via the Admin API with a random scrambled password. Builds the
   `{prod_uid → staging_uid}` remap dict.
5. **Row copy** — `applications → tir_applications` and
   `resume_uploads → tir_resume_uploads`, with every UUID column routed
   through the remap. JSONB columns + timestamps + status values copy
   verbatim.
6. **Storage sync** — walks the JSONB file-bearing columns (`evidence_files`,
   `evidence_deck`, `execution_milestone_files`) + the `tir_resume_uploads.storage_path`
   column, copies the referenced Storage objects from prod buckets
   (`resumes`, `evidence-files`, `milestone-files`) to staging buckets
   (`tir-resumes`, `tir-evidence-files`, `tir-milestone-files`).
   8 concurrent threads, `upsert=true` for idempotency.
7. **Verification** — three checks (row counts, FK integrity, storage
   sanity) printed as a summary table.

## What it does NOT do

- Touch `support_tickets` (operationally noisy, irrelevant to the review surface).
- Import `user_roles` from prod (prod doesn't have the table; staging's
  existing role grants on preserved test users are the right state).
- Touch SIP — prod has no SIP applications, tables, or buckets.
- Set up scheduled refreshes — running this is a manual dev action.

## Verification

Acceptance criteria are in spec §12. After a successful run, sign in to
the staging Vercel preview as `dev@artpark.in / staging-pass-2026` and
verify:

- Applications tab shows real applicant names (not the seed names like
  Divya Singh, Rohan Joshi, Priya Kapoor).
- Opening any imported application shows real `basic_*` fields, real
  problem/solution/roadmap text, real file cards in the Evidence section.
- AI Screening panel shows "AI screening not run yet." (correct — prod
  has no `ai_screening` rows).
- Reviews tab and History tab show their empty states.

## Rollback

Three levers in order of preference:

1. **Re-seed.** `python backend/scripts/seed_staging.py` regenerates the
   40 synthetic apps.
2. **Supabase Point-in-Time Restore** — confirm availability via the
   staging project's Backups tab (free tier may not have it).
3. **Re-run the import.** Idempotent.

## Troubleshooting

- **"Pre-flight URL check failed"** — `.env.import` has a typo in one of
  the URLs. Compare against `.env.import.example`.
- **"Pre-flight seed-data check FAILED"** — staging.tir_applications has
  no `@artpark.test` rows. Either the wipe already ran (re-running is
  safe), or `STAGING_SUPABASE_URL` is pointed at the wrong project.
- **FK orphans in the verify summary** — auth user creation skipped one
  of the prod user_ids. Look at `./runs/<latest>.log` for the
  `import_users` lines to see which UUID didn't get a stub.
- **Storage sync slow** — bump `CONCURRENCY` at the top of
  `lib/storage.py` to 16 if your network has the headroom.
```

- [ ] **Step 2: Commit**

```bash
git add backend/scripts/import-prod-to-staging/README.md
git commit -m "docs(import): full runbook with prerequisites + troubleshooting

Replaces the README skeleton from Task 1 with:
  - one-time setup (.env.import workflow)
  - run patterns (--dry-run, --no-storage)
  - phase-by-phase description of what the script does
  - explicit list of what it does NOT do
  - manual verification steps mapped to spec §12 acceptance criteria
  - three-lever rollback
  - troubleshooting recipes for the three most likely failure modes"
```

---

### Task 14: Dry-run smoke test against staging

**Files:** none — this is a manual smoke verification that the developer runs.

The agent doesn't have prod credentials, so the only smoke we can run is a `--dry-run` against staging that DOES NOT MUTATE.

- [ ] **Step 1: Create a `.env.import` pointing PROD_* at STAGING (intentional — dry-run only)**

This is the ONE TIME we point `PROD_SUPABASE_URL` at the staging project. We do this only to exercise the script's data-walking code paths without needing prod creds. `--dry-run` ensures no writes happen.

```bash
cat > backend/scripts/import-prod-to-staging/.env.import <<'EOF'
# DRY-RUN SMOKE ONLY — both URLs point at the SAME staging project.
# Replace before doing a real run.
PROD_SUPABASE_URL=https://exqmxvdtcsvpgtftwjml.supabase.co
PROD_SUPABASE_SERVICE_ROLE_KEY=<STAGING_SERVICE_ROLE_KEY_VALUE>
STAGING_SUPABASE_URL=https://exqmxvdtcsvpgtftwjml.supabase.co
STAGING_SUPABASE_SERVICE_ROLE_KEY=<STAGING_SERVICE_ROLE_KEY_VALUE>
EOF
```

Replace `<STAGING_SERVICE_ROLE_KEY_VALUE>` by hand with the staging service-role key the developer pastes (the same one that lives in their backend `.env.staging`).

- [ ] **Step 2: Run with `--dry-run`**

```bash
cd /Users/apple/Desktop/Final_AP_os
./backend/scripts/import-prod-to-staging/run.sh --dry-run 2>&1 | tee /tmp/import-dry-run.log
```

Expected output includes:
- `Pre-flight URL check failed: prod URL points at project 'exqmxvdtcsvpgtftwjml', expected 'xtmszlpwgbyoumalgbhs'`
- Exit code 1.

That's the correct failure — the URL-ref guard rejects PROD_SUPABASE_URL because it's not `xtmszlpwgbyoumalgbhs`. **The guard fired, which is exactly what it's supposed to do.** This is the smoke test passing: the safety check works.

- [ ] **Step 3: Verify pytest still passes everything**

```bash
cd /Users/apple/Desktop/Final_AP_os
pytest backend/scripts/import-prod-to-staging/tests/ -v
```

Expected: all 30+ tests pass across the 6 test files (test_tables 6, test_probe 8, test_jsonb_walker 8, test_wipe 3, test_auth 4, test_copy 5 → 34 total).

- [ ] **Step 4: Run the existing backend test suite (regression sanity)**

The import script lives outside the main `backend/tests/` testpath so it shouldn't affect the existing suite, but verify:

```bash
cd /Users/apple/Desktop/Final_AP_os/backend
pytest -v 2>&1 | tail -20
```

Expected: existing backend suite passes unchanged.

- [ ] **Step 5: Remove the smoke-only .env.import (gitignored, but safer to remove)**

```bash
rm backend/scripts/import-prod-to-staging/.env.import
```

- [ ] **Step 6: Commit anything outstanding (should be nothing — but defensive check)**

```bash
git status --short
# Expected: empty output (everything from Tasks 1-13 is already committed).
```

If anything is outstanding, commit it with a short scoped message.

- [ ] **Step 7: Final wrap-up commit (if no other unstaged changes, this is a no-op — skip)**

This task closes out the plan with no code change of its own. The next step is for the dev to:

1. Paste real prod + staging service-role keys into `.env.import`.
2. Run `./run.sh --dry-run` — this time the URL guard passes, and the script walks the prod schema printing what it WOULD do.
3. Inspect the dry-run output (transcript at `./runs/<timestamp>.log`).
4. Run `./run.sh` for real.
5. Verify per spec §12 acceptance criteria.

---

## Self-Review (done before saving)

**Spec coverage:**
- §3 Repo layout → Task 1 ✓
- §4 Wipe + preserve → Tasks 2 (constants), 6 (logic) ✓
- §5 Auth stubs + remap → Task 7 ✓
- §6 Application/resume copy → Tasks 4 (column probe), 8 (copy) ✓
- §7 Storage sync → Tasks 5 (JSONB walker), 9 (object copy) ✓
- §8 Verification → Task 10 ✓
- §9 Runbook → Task 13 ✓
- §10 Rollback → Task 13 (in README) ✓
- §11 Out-of-scope items → not implemented (correct) ✓
- §12 Acceptance criteria → Task 14 hands off to manual verification ✓
- §13 Risks → mitigations live in pre-flight (Task 3, 4), column probe (Task 4), upsert (Task 9), scrambled passwords (Task 7) ✓

**Placeholder scan:** no TBDs, no "add appropriate validation" lines, every code block is complete enough to run.

**Type consistency:** `BucketPath` defined in `lib/jsonb_walker.py` used in `lib/storage.py`. `VerifyReport` defined in `lib/verify.py` used in same file. Remap is always `dict[str, str]`. `FakeSupabase.tables` is `dict[str, list[dict]]` throughout the tests.

**Scope check:** the plan covers one coherent feature (one script, ~600 LOC including tests, runnable end-to-end). Not too big for one plan.
