# Demo Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing staging environment into a safe, demonstrable product tour — real application content with masked identities, twelve applications covering every pipeline state, and one login that reaches the admin, reviewer and leadership portals.

**Architecture:** Two idempotent Python scripts against the staging Supabase project via the service-role client. `mask_staging_identities.py` overwrites identity fields everywhere, deterministically. `seed_demo_cohort.py` selects twelve existing non-draft applications by a stable rule and manufactures the downstream state (reviews, assignments, batches, gate decisions, AI screening, IC documents) that makes each screen render. Then the staging API and frontend are brought to the release commit.

**Tech Stack:** Python 3.11+, `supabase-py` service-role client, pytest with the repo's `tests/fixtures/fake_supabase.py`, SAM for the staging Lambda, Vercel for the frontend.

**Spec:** `docs/superpowers/specs/2026-08-23-demo-environment-design.md`

## Global Constraints

- **Staging only.** Both scripts MUST refuse to run unless `SUPABASE_URL` contains `exqmxvdtcsvpgtftwjml`. Production is `xtmszlpwgbyoumalgbhs`. This guard is not optional and not a warning — it is an exit.
- **`--dry-run` is the default.** Neither script writes anything unless `--apply` is passed explicitly.
- **`dayan02dev/AP_os` is a PUBLIC repository.** No password, service key, token or real applicant name may appear in any committed file. Credentials are printed to stdout only.
- **Masking is irreversible** on staging. Production is never read or written.
- **Migrations are already applied and verified** (spec §4.4). Do not re-apply them.
- **Never delete an application row.** Surplus records stay as background volume.
- **Staff accounts are exempt from masking:** any email ending `@artpark.in`, `@artpark.info` or `@artpark.test`.
- **Preserve `claude-test-applicant-sip@artpark.in`** — the in-progress VIP branch tests against it.
- Commit messages must contain NO `Co-Authored-By` trailer and no Claude/Anthropic/AI reference.

## THE LIVE SCHEMA IS AUTHORITATIVE — READ THIS FIRST

**The migration files do not describe staging's actual shape.** Verified example: migration `014_admin_platform_phase1.sql` defines `reviews` with `status`, `comments` and `ai_score_overall`. The **live** `reviews` table has none of those — migration 022 reshaped it. Its real columns are:

```
id, application_id, application_track, assignment_id, reviewer_user_id,
score_problem, score_solution, score_tech, score_founders, score_commitment,
score_integrity, score_overall, recommendation, strengths, concerns,
quick_notes, flags, disagree_with_ai, locked_at, submitted_at,
created_at, updated_at
```

There is **no `status` column**. A review counts as submitted when `submitted_at` is non-null — this is what `state_machine.auto_transition_to_evaluated_on_first_review` keys on.

**Therefore: before writing any row, introspect the live table.** A one-row `select=*` against the REST endpoint returns the real column set. Any insert built from a migration file rather than the live schema is a bug waiting to 400.

Verified live shapes you may rely on:

| Table | Columns / constraints that matter |
|---|---|
| `reviewer_assignments` | `state` in `('pending','accepted','declined','completed')`; unique `(application_id, application_track, reviewer_user_id)` |
| `admin_decisions` | `gate_stage` (text, default `'gate1'`); `decision` in `('shortlisted','on_hold','rejected','waitlisted','jury_review','offered')` |
| `ic_documents` | `bucket` default `'ic-documents'`, `storage_path` NOT NULL; signed copy via `signed_storage_path`/`signer_name`/`signed_at`; **partial unique index on `(application_id, application_track) WHERE superseded_at IS NULL`** — one current document per app |
| `application_batches` | unique `(application_id, application_track, batch_id)` — many batches per app |
| `batch_reviewers` | PK `(batch_id, reviewer_user_id)` |
| `application_admin_meta` | PK `(application_id, application_track)`; columns are only `is_hidden`, `is_archived`, `hidden_reason`, `updated_at`, `updated_by` — **there is no free column for a demo marker**, which is why Task 2 selects rows deterministically instead |
| `jury_selections` | unique `(application_id, application_track, juror_user_id)` |

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `backend/scripts/mask_staging_identities.py` | Overwrite identity fields across all applicant records, deterministically | 1 |
| `backend/tests/test_mask_staging_identities.py` | Unit tests for the pure masking functions | 1 |
| `backend/scripts/seed_demo_cohort.py` | Select twelve applications and manufacture their downstream state | 2 |
| `backend/tests/test_seed_demo_cohort.py` | Unit tests for selection and state planning | 2 |
| `docs/DEMO_ENVIRONMENT.md` | The handout a PM reads | 3 |

Both scripts follow `backend/scripts/seed_staging.py`'s conventions: `_BACKEND_ROOT` on `sys.path`, dotenv from `.env.staging` then `.env`, `from app.supabase_client import get_admin_client`, module-level config constants, `logging.basicConfig`.

**Environment note:** `backend/.env.staging` is gitignored and does **not** exist in this worktree. Before running either script, copy it in:
```bash
cp /Users/apple/Desktop/Final_AP_os/backend/.env.staging \
   /Users/apple/Desktop/Final_AP_os/.claude/worktrees/demo-environment/backend/.env.staging
```
Confirm it stays untracked (`git status --short` must not list it).

---

## Task 1: Masking script

**Files:**
- Create: `backend/scripts/mask_staging_identities.py`
- Create: `backend/tests/test_mask_staging_identities.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `fake_identity(original: str) -> dict` returning `{"name","email","phone","org","linkedin"}`
  - `is_exempt(email: str | None) -> bool`
  - `mask_row(row: dict, columns: set[str]) -> dict` — the patch to apply, keys limited to `columns`
  - `STAGING_PROJECT_ID = "exqmxvdtcsvpgtftwjml"`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_mask_staging_identities.py`:

```python
"""Unit tests for the staging identity masker. Pure functions only — no network."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from mask_staging_identities import fake_identity, is_exempt, mask_row  # noqa: E402


class TestDeterminism:
    def test_same_input_gives_same_identity(self):
        a = fake_identity("Krishna Koravadi")
        b = fake_identity("Krishna Koravadi")
        assert a == b

    def test_different_inputs_usually_differ(self):
        names = {fake_identity(f"Person {i}")["name"] for i in range(40)}
        # A hash-indexed pool will collide sometimes; it must not collapse to one.
        assert len(names) > 10

    def test_identity_has_every_field(self):
        got = fake_identity("Someone Real")
        assert set(got) == {"name", "email", "phone", "org", "linkedin"}
        assert all(isinstance(v, str) and v for v in got.values())

    def test_email_is_not_a_real_domain(self):
        assert fake_identity("Someone Real")["email"].endswith("@artpark.test")


class TestExemption:
    def test_staff_domains_are_exempt(self):
        assert is_exempt("dev@artpark.in")
        assert is_exempt("tir.founder.test@artpark.info")
        assert is_exempt("seed-app-001@artpark.test")

    def test_real_applicants_are_not_exempt(self):
        assert not is_exempt("someone@gmail.com")
        assert not is_exempt("prof@pilani.bits-pilani.ac.in")

    def test_missing_email_is_not_exempt(self):
        # A row with no email still carries a real NAME that must be masked.
        assert not is_exempt(None)
        assert not is_exempt("")

    def test_exemption_is_case_insensitive(self):
        assert is_exempt("Dev@ARTPARK.in")


class TestMaskRow:
    def test_only_returns_columns_that_exist(self):
        row = {"basic_full_name": "Real Name", "basic_email": "r@gmail.com"}
        patch = mask_row(row, {"basic_full_name", "basic_email"})
        assert set(patch) <= {"basic_full_name", "basic_email"}

    def test_never_invents_a_column_the_table_lacks(self):
        row = {"basic_full_name": "Real Name"}
        patch = mask_row(row, {"basic_full_name"})
        assert "basic_org" not in patch

    def test_exempt_row_returns_an_empty_patch(self):
        row = {"basic_full_name": "Staff", "basic_email": "dev@artpark.in"}
        assert mask_row(row, {"basic_full_name", "basic_email"}) == {}

    def test_masks_a_row_with_no_email_using_its_name_as_the_seed(self):
        row = {"basic_full_name": "Real Name", "basic_email": None}
        patch = mask_row(row, {"basic_full_name", "basic_email"})
        assert patch["basic_full_name"] != "Real Name"

    def test_teammates_json_is_rewritten_not_dropped(self):
        row = {
            "basic_full_name": "Real Name",
            "basic_teammates": [{"name": "Someone Else", "role": "CTO"}],
        }
        patch = mask_row(row, {"basic_full_name", "basic_teammates"})
        mates = patch["basic_teammates"]
        assert isinstance(mates, list) and len(mates) == 1
        assert mates[0]["name"] != "Someone Else"
        # The non-identifying field must survive — the demo needs real shape.
        assert mates[0]["role"] == "CTO"

    def test_empty_teammates_stays_empty_not_null(self):
        # `basic_teammates` is NOT NULL on some rows; never write null into it.
        row = {"basic_full_name": "N", "basic_teammates": []}
        patch = mask_row(row, {"basic_full_name", "basic_teammates"})
        assert patch["basic_teammates"] == []
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd backend && python -m pytest tests/test_mask_staging_identities.py -q --no-cov`
Expected: collection error — `ModuleNotFoundError: No module named 'mask_staging_identities'`.

- [ ] **Step 3: Write the script**

Create `backend/scripts/mask_staging_identities.py`:

```python
"""Replace every real identity in the STAGING Supabase project with a synthetic one.

WHY
    Staging is a copy of production: real founder names, real Gmail and
    university addresses. It is being handed to product managers who are
    deliberately NOT given production access, so the identities have to go
    while the application CONTENT stays — the demo has to read like the real
    product.

WHAT IS PRESERVED
    Everything except identity: all long-form answers, statuses, AI scores,
    industries, dates, file references, moved_to_track. Only who they are
    changes, never what they wrote.

DETERMINISM
    fake_identity() is a pure function of the original value, so the same real
    person maps to the same synthetic person in every table and on every run.
    That keeps an applicant's name consistent between their application row and
    their profile row, and makes the script idempotent.

SAFETY
    * Refuses to run unless SUPABASE_URL points at the staging project.
    * --dry-run is the default; nothing is written without --apply.
    * Staff accounts (@artpark.in/.info/.test) are skipped — masking those
      would break the logins staging depends on.

LIMIT, STATED PLAINLY
    auth.users.email still holds real addresses. No portal screen renders it
    (they all read `profiles`), and rewriting it would break those accounts'
    sign-in for no UI-visible gain. Deliberate, not an oversight.

USAGE
    cd backend
    python scripts/mask_staging_identities.py              # dry run
    python scripts/mask_staging_identities.py --apply
"""

from __future__ import annotations

import argparse
import hashlib
import logging
import os
import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

try:
    from dotenv import load_dotenv  # type: ignore

    for candidate in (".env.staging", ".env"):
        path = _BACKEND_ROOT / candidate
        if path.exists():
            load_dotenv(path)
            break
except ImportError:
    pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-5s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("mask_staging")

STAGING_PROJECT_ID = "exqmxvdtcsvpgtftwjml"
PROD_PROJECT_ID = "xtmszlpwgbyoumalgbhs"

EXEMPT_DOMAINS = ("@artpark.in", "@artpark.info", "@artpark.test")

# Synthetic pool. Indian names because the real applicant population is Indian
# and a demo full of Anglo names would read as obviously fake.
FIRST = [
    "Aarav", "Ananya", "Advait", "Bhavya", "Chirag", "Divya", "Eshan", "Gauri",
    "Harsh", "Ishita", "Jatin", "Kavya", "Lakshya", "Meera", "Nikhil", "Oindrila",
    "Pranav", "Riya", "Sahil", "Tanvi", "Utkarsh", "Vaishnavi", "Yash", "Zoya",
]
LAST = [
    "Agarwal", "Bhat", "Chandra", "Deshpande", "Iyer", "Joshi", "Kulkarni",
    "Menon", "Nair", "Pillai", "Rao", "Sharma", "Thakur", "Varma",
]
ORGS = [
    "Aether Robotics", "Bharat Sensing", "Cyclone Mobility", "Delta Neural",
    "Ekaant Systems", "Fathom Analytics", "Girish Aerospace", "Helix BioWorks",
    "Indus Photonics", "Jyoti Energy", "Kalpa Materials", "Lumen Diagnostics",
]


def _idx(seed: str, modulo: int) -> int:
    return int(hashlib.sha256(seed.encode("utf-8")).hexdigest(), 16) % modulo


def fake_identity(original: str) -> dict:
    """Deterministic synthetic identity derived from `original`."""
    seed = (original or "anonymous").strip().lower()
    first = FIRST[_idx(seed + "|f", len(FIRST))]
    last = LAST[_idx(seed + "|l", len(LAST))]
    org = ORGS[_idx(seed + "|o", len(ORGS))]
    handle = f"{first}.{last}".lower()
    return {
        "name": f"{first} {last}",
        "email": f"{handle}@artpark.test",
        "phone": f"+9198{_idx(seed + '|p', 90000000) + 10000000}",
        "org": org,
        "linkedin": f"https://www.linkedin.com/in/{handle}",
    }


def is_exempt(email: str | None) -> bool:
    """True for staff / seed accounts, which must not be masked."""
    if not email:
        return False
    return email.strip().lower().endswith(EXEMPT_DOMAINS)


# Column -> which field of fake_identity() fills it.
FIELD_MAP = {
    "basic_full_name": "name",
    "full_name": "name",
    "basic_email": "email",
    "email": "email",
    "basic_phone": "phone",
    "phone": "phone",
    "basic_org": "org",
    "linkedin_url": "linkedin",
}


def mask_row(row: dict, columns: set[str]) -> dict:
    """Build the patch for one row. Keys are restricted to `columns`.

    Seeded from the row's email when it has one, else its name — many staging
    rows have a null email but a real name, and those must still be masked.
    """
    email = row.get("basic_email") or row.get("email")
    if is_exempt(email):
        return {}

    seed = email or row.get("basic_full_name") or row.get("full_name") or row.get("id") or ""
    ident = fake_identity(str(seed))

    patch: dict = {}
    for col, field in FIELD_MAP.items():
        if col in columns and col in row:
            patch[col] = ident[field]

    # Teammates: rewrite each name, keep every other key so the shape survives.
    if "basic_teammates" in columns and "basic_teammates" in row:
        mates = row.get("basic_teammates")
        if isinstance(mates, list):
            out = []
            for i, m in enumerate(mates):
                if isinstance(m, dict):
                    m2 = dict(m)
                    if "name" in m2:
                        m2["name"] = fake_identity(f"{seed}|mate{i}")["name"]
                    if "email" in m2:
                        m2["email"] = fake_identity(f"{seed}|mate{i}")["email"]
                    out.append(m2)
                else:
                    out.append(m)
            patch["basic_teammates"] = out
        elif mates is None:
            pass  # never write null into a NOT NULL column
        else:
            patch["basic_teammates"] = mates

    # Media URLs point at real people's demos; blank them to a placeholder.
    for col in ("github_url", "evidence_video_url", "sip_demo_video_url"):
        if col in columns and row.get(col):
            patch[col] = "https://example.test/redacted"

    return patch
```

Then add the driver below it:

```python
TARGETS = ("tir_applications", "sip_applications", "profiles")


def _guard(url: str) -> None:
    if PROD_PROJECT_ID in url:
        log.error("REFUSING: SUPABASE_URL points at PRODUCTION.")
        sys.exit(2)
    if STAGING_PROJECT_ID not in url:
        log.error("REFUSING: SUPABASE_URL is not the known staging project.")
        log.error("  expected to contain: %s", STAGING_PROJECT_ID)
        sys.exit(2)


def _columns_of(sb, table: str) -> set[str]:
    """Live column set. The migration files are NOT authoritative — `reviews`
    proves it — so always ask the database."""
    rows = sb.table(table).select("*").limit(1).execute().data or []
    return set(rows[0].keys()) if rows else set()


def _fetch_all(sb, table: str, columns: set[str]) -> list[dict]:
    """Paginate. PostgREST silently caps a plain select at 1000 rows."""
    wanted = sorted({"id"} | (columns & set(FIELD_MAP) | {"basic_teammates",
                    "github_url", "evidence_video_url", "sip_demo_video_url"}) & (columns | {"id"}))
    out: list[dict] = []
    page = 0
    while True:
        lo, hi = page * 500, page * 500 + 499
        chunk = sb.table(table).select(",".join(wanted)).range(lo, hi).execute().data or []
        out.extend(chunk)
        if len(chunk) < 500:
            return out
        page += 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write changes (default is a dry run)")
    args = ap.parse_args()

    url = os.environ.get("SUPABASE_URL", "")
    _guard(url)
    log.info("target: staging (%s) — mode: %s", STAGING_PROJECT_ID,
             "APPLY" if args.apply else "DRY RUN")

    from app.supabase_client import get_admin_client
    sb = get_admin_client()

    grand = 0
    for table in TARGETS:
        cols = _columns_of(sb, table)
        if not cols:
            log.warning("%-20s no rows — skipping", table)
            continue
        rows = _fetch_all(sb, table, cols)
        patches = [(r["id"], mask_row(r, cols)) for r in rows]
        patches = [(rid, p) for rid, p in patches if p]
        log.info("%-20s %d rows, %d to mask", table, len(rows), len(patches))
        for rid, p in patches[:3]:
            log.info("    e.g. %s -> %s", rid[:8], {k: p[k] for k in list(p)[:3]})
        if args.apply:
            for rid, p in patches:
                sb.table(table).update(p).eq("id", rid).execute()
        grand += len(patches)

    log.info("%s %d rows", "masked" if args.apply else "would mask", grand)
    if not args.apply:
        log.info("re-run with --apply to write")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

**Note on `profiles`:** its primary key is `id`, and it has `full_name`/`email`/`phone`/`linkedin_url` but no `basic_*` columns. `mask_row` handles this because `FIELD_MAP` covers both naming conventions and every write is gated on `col in columns`.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd backend && python -m pytest tests/test_mask_staging_identities.py -q --no-cov`
Expected: PASS, all cases.

- [ ] **Step 5: Prove the guard actually guards**

Run:
```bash
cd backend && SUPABASE_URL="https://xtmszlpwgbyoumalgbhs.supabase.co" \
  python scripts/mask_staging_identities.py
```
Expected: exits 2 with `REFUSING: SUPABASE_URL points at PRODUCTION.` and writes nothing.

Then:
```bash
cd backend && SUPABASE_URL="https://something-else.supabase.co" \
  python scripts/mask_staging_identities.py
```
Expected: exits 2 with the not-the-known-staging-project message.

Record both outputs in your report. A guard nobody watched refuse is not a verified guard.

- [ ] **Step 6: Commit**

```bash
git add backend/scripts/mask_staging_identities.py backend/tests/test_mask_staging_identities.py
git commit -m "feat(staging): deterministic identity masker for the demo environment"
```

---

## Task 2: Demo cohort seed script

**Files:**
- Create: `backend/scripts/seed_demo_cohort.py`
- Create: `backend/tests/test_seed_demo_cohort.py`

**Interfaces:**
- Consumes: `STAGING_PROJECT_ID` guard pattern from Task 1 (reimplement, do not import across scripts).
- Produces:
  - `DEMO_PLAN: list[dict]` — twelve entries, each `{"slot","track","status","reviews","gate","memo","moved"}`
  - `select_demo_rows(candidates: list[dict], plan: list[dict]) -> list[tuple[dict, dict]]`
  - `reviews_for(spec: str) -> list[dict]` returning recommendation sets
  - `DEMO_EMAIL = "demo@artpark.test"`

**Background the implementer needs.** `application_admin_meta` has no free column for a marker (its only fields are `is_hidden`, `is_archived`, `hidden_reason`, `updated_at`, `updated_by`), so the twelve rows are chosen **deterministically by sorted application id** rather than tagged. Same candidate pool → same twelve, every run, with no schema change.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_seed_demo_cohort.py`:

```python
"""Unit tests for the demo cohort planner. Pure functions only — no network."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from seed_demo_cohort import DEMO_PLAN, reviews_for, select_demo_rows  # noqa: E402


class TestPlanShape:
    def test_twelve_slots(self):
        assert len(DEMO_PLAN) == 12

    def test_every_slot_names_a_track_and_status(self):
        for p in DEMO_PLAN:
            assert p["track"] in ("tir", "sip")
            assert p["status"]

    def test_covers_the_states_the_spec_requires(self):
        statuses = {p["status"] for p in DEMO_PLAN}
        for required in ("submitted", "under_review", "evaluated",
                         "on_hold", "jury_review", "rejected", "offered"):
            assert required in statuses, f"{required} missing from the demo plan"

    def test_exactly_one_slot_is_a_moved_track(self):
        assert sum(1 for p in DEMO_PLAN if p.get("moved")) == 1

    def test_exactly_one_slot_has_a_signed_memo(self):
        assert sum(1 for p in DEMO_PLAN if p.get("memo") == "signed") == 1


class TestSelection:
    def _cands(self, n):
        # Deliberately unsorted, to prove selection does not depend on input order.
        return [{"id": f"{i:04d}-aaaa", "status": "under_review"} for i in reversed(range(n))]

    def test_selects_one_row_per_slot(self):
        got = select_demo_rows(self._cands(30), DEMO_PLAN)
        assert len(got) == len(DEMO_PLAN)

    def test_selection_is_stable_across_input_order(self):
        a = select_demo_rows(self._cands(30), DEMO_PLAN)
        b = select_demo_rows(list(reversed(self._cands(30))), DEMO_PLAN)
        assert [r["id"] for r, _ in a] == [r["id"] for r, _ in b]

    def test_never_reuses_a_row(self):
        got = select_demo_rows(self._cands(30), DEMO_PLAN)
        ids = [r["id"] for r, _ in got]
        assert len(ids) == len(set(ids))

    def test_raises_when_there_are_too_few_candidates(self):
        import pytest
        with pytest.raises(ValueError, match="not enough"):
            select_demo_rows(self._cands(3), DEMO_PLAN)


class TestReviewSets:
    def test_yes_verdict_needs_two_yes_and_under_two_no(self):
        recs = [r["recommendation"] for r in reviews_for("verdict_yes")]
        assert recs.count("yes") >= 2 and recs.count("no") < 2

    def test_no_verdict_needs_two_no_and_under_two_yes(self):
        recs = [r["recommendation"] for r in reviews_for("verdict_no")]
        assert recs.count("no") >= 2 and recs.count("yes") < 2

    def test_split_produces_neither_majority(self):
        recs = [r["recommendation"] for r in reviews_for("split")]
        assert recs.count("yes") < 2 and recs.count("no") < 2

    def test_none_means_no_reviews(self):
        assert reviews_for("none") == []

    def test_every_review_carries_submitted_at(self):
        # The live `reviews` table has NO `status` column — submitted_at is the
        # only signal that a review counts as submitted.
        for spec in ("verdict_yes", "verdict_no", "split"):
            for r in reviews_for(spec):
                assert r.get("submitted_at")
                assert "status" not in r
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd backend && python -m pytest tests/test_seed_demo_cohort.py -q --no-cov`
Expected: `ModuleNotFoundError: No module named 'seed_demo_cohort'`.

- [ ] **Step 3: Write the planner half of the script**

Create `backend/scripts/seed_demo_cohort.py` with the same header block, dotenv loading, logging and guard as Task 1 (reimplement — these are standalone scripts, not a package), then:

```python
DEMO_EMAIL = "demo@artpark.test"

# One entry per demo slot. `reviews` selects a recommendation set; `gate` writes
# an admin_decisions row; `memo` controls ic_documents; `moved` sets
# moved_to_track so the effective-track overlay badge appears.
DEMO_PLAN = [
    {"slot": 1,  "track": "tir", "status": "submitted",    "reviews": "none",       "gate": None,          "memo": None,     "moved": False},
    {"slot": 2,  "track": "tir", "status": "under_review", "reviews": "none",       "gate": None,          "memo": None,     "moved": False},
    {"slot": 3,  "track": "tir", "status": "under_review", "reviews": "split",      "gate": None,          "memo": None,     "moved": False},
    {"slot": 4,  "track": "tir", "status": "evaluated",    "reviews": "verdict_yes","gate": None,          "memo": None,     "moved": False},
    {"slot": 5,  "track": "tir", "status": "evaluated",    "reviews": "verdict_no", "gate": None,          "memo": None,     "moved": False},
    {"slot": 6,  "track": "tir", "status": "on_hold",      "reviews": "verdict_yes","gate": "on_hold",     "memo": None,     "moved": False},
    {"slot": 7,  "track": "tir", "status": "jury_review",  "reviews": "verdict_yes","gate": "jury_review", "memo": None,     "moved": False},
    {"slot": 8,  "track": "tir", "status": "jury_review",  "reviews": "verdict_yes","gate": "jury_review", "memo": "signed", "moved": False},
    {"slot": 9,  "track": "tir", "status": "rejected",     "reviews": "verdict_no", "gate": "gate2_reject","memo": None,     "moved": False},
    {"slot": 10, "track": "tir", "status": "offered",      "reviews": "verdict_yes","gate": "gate2_offer", "memo": "signed", "moved": False},
    {"slot": 11, "track": "sip", "status": "jury_review",  "reviews": "verdict_yes","gate": "jury_review", "memo": None,     "moved": False},
    {"slot": 12, "track": "tir", "status": "jury_review",  "reviews": "split",      "gate": "jury_review", "memo": None,     "moved": True},
]

_SCORES = {
    "score_problem": 7.5, "score_solution": 7.0, "score_tech": 8.0,
    "score_founders": 7.5, "score_commitment": 8.0, "score_integrity": 8.5,
    "score_overall": 7.7,
}
_SUBMITTED = "2026-07-15T10:00:00+00:00"

_REVIEW_SETS = {
    "none": [],
    "split": ["yes", "maybe"],
    "verdict_yes": ["yes", "yes", "maybe"],
    "verdict_no": ["no", "no", "maybe"],
}


def reviews_for(spec: str) -> list[dict]:
    """Review rows for a slot. NOTE: the live `reviews` table has no `status`
    column — `submitted_at` is what marks a review submitted, which is what
    `reco_verdict` and the auto-transition both key on."""
    out = []
    for rec in _REVIEW_SETS[spec]:
        out.append({
            **_SCORES,
            "recommendation": rec,
            "strengths": "Strong technical grounding; credible route to a pilot.",
            "concerns": "Go-to-market is thin and the team is small for the scope.",
            "submitted_at": _SUBMITTED,
        })
    return out


def select_demo_rows(candidates: list[dict], plan: list[dict]) -> list[tuple[dict, dict]]:
    """Pair each plan slot with a candidate application, deterministically.

    Sorted by id so the same pool always yields the same twelve, regardless of
    the order PostgREST returned them. `application_admin_meta` has no spare
    column to tag rows with, so stability comes from the ordering rather than
    from a marker.
    """
    if len(candidates) < len(plan):
        raise ValueError(
            f"not enough candidate applications: need {len(plan)}, have {len(candidates)}"
        )
    ordered = sorted(candidates, key=lambda r: str(r["id"]))
    return [(ordered[i], plan[i]) for i in range(len(plan))]
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd backend && python -m pytest tests/test_seed_demo_cohort.py -q --no-cov`
Expected: PASS, all cases.

- [ ] **Step 5: Write the apply half**

Add to the same file. Every insert introspects its table first, per the schema warning at the top of this plan.

The driver must, in this order:

1. `_guard(os.environ["SUPABASE_URL"])` — same two-branch guard as Task 1.
2. **Demo account.** Find or create `demo@artpark.test` via `sb.auth.admin`. Generate a password with `secrets.token_urlsafe(9) + "!1Aa"`. Upsert its `profiles` row (`full_name="Demo Product Manager"`). Grant `admin`, `leadership` and `reviewer` in `user_roles`, each `on_conflict do nothing`. **Do not** grant `applicant` — `isApplyHiddenFor` already hides the wizard, and an extra role muddles the switcher.
3. **Reviewer roster.** Ensure `reviewer-demo-1@artpark.test` … `-3@artpark.test` exist with the `reviewer` role and a `reviewer_profiles` row (`expertise_domains`, `weight=1.0`).
4. **Batches.** Create `Batch A` and `Batch B` in `batches` if absent (match on `name`). Add the three roster reviewers to Batch A and the demo account to Batch B via `batch_reviewers`.
5. **Candidates.** Fetch non-draft applications per track, paginating in 500-row pages. Filter to rows that already carry an `ai_screening` row where possible, so the AI panels have something. Call `select_demo_rows`.
6. **Per slot**, in this order — status last, because the state machine validates transitions:
   - `reviewer_assignments`: one row per review in the set, plus one for the demo account on slots 2–5, `state='completed'` where a review exists else `'pending'`.
   - `reviews`: one row per `reviews_for(spec)` entry, carrying `assignment_id` from the matching assignment.
   - `ai_screening`: upsert on `(application_id, application_track)` with the component scores, an overall, a `summary`, and `sections` — a JSON object with the four section blocks.
   - `application_batches`: slot into Batch A or B.
   - `admin_decisions`: for `gate` values — `on_hold`/`jury_review` write `gate_stage='gate1'`; `gate2_reject` writes `gate_stage='gate2', decision='rejected'`; `gate2_offer` writes `gate_stage='gate2', decision='offered'`.
   - `jury_assignments` + `jury_selections` for slots 7–12.
   - `ic_documents` when `memo` is set: insert with `bucket='ic-documents'`, `storage_path=f"demo/{app_id}.pdf"`, `file_name="IC-memo-demo.pdf"`, and for `"signed"` also `signed_storage_path`, `signer_name="Demo Product Manager"`, `signed_at`. **Respect the partial unique index** — check for an existing row with `superseded_at is null` before inserting.
   - `moved_to_track`: set to `'sip'` on the slot-12 TIR row, plus `moved_at`.
   - **Status**, written directly on the application row (not via the state machine — the seed is establishing a state, not transitioning through one).
7. Print the demo account email and password, and the staging URL.

Idempotency for every insert: read first, insert only what is missing. Unique constraints to respect are listed in the schema table at the top of this plan.

- [ ] **Step 6: Dry-run against staging and read the plan**

```bash
cp /Users/apple/Desktop/Final_AP_os/backend/.env.staging \
   /Users/apple/Desktop/Final_AP_os/.claude/worktrees/demo-environment/backend/.env.staging
cd backend && python scripts/seed_demo_cohort.py
```
Expected: a per-slot summary of what would be written, no writes. Confirm twelve slots resolved to twelve distinct application ids.

- [ ] **Step 7: Commit**

```bash
git add backend/scripts/seed_demo_cohort.py backend/tests/test_seed_demo_cohort.py
git commit -m "feat(staging): demo cohort seed — twelve applications covering every pipeline state"
```

---

## Task 3: The handout

**Files:**
- Create: `docs/DEMO_ENVIRONMENT.md`

- [ ] **Step 1: Write it**

Sections, in order:

1. **What this is** — a masked copy of the real system for learning it. State plainly, in the first three lines, that every founder name, email and company is synthetic and that the environment is disposable.
2. **How to get in** — the URL, the account email, and *"ask Udayan for the password"*. **No password in this file** — the repo is public.
3. **The ten-minute tour** — Leadership → Admin → Reviewer, in that order, because that is the order the portal switcher lands you in. Per portal: what to click, what to look at, what it means. Name the twelve applications' states so the reader knows what they are seeing (e.g. "the row with the green ACCEPTED chip has a signed IC memo; the red one was rejected at the final gate").
4. **What this does not show** — the applicant wizard, the jury portal (unwired this cohort), and the VIP onboarding surfaces still in progress. Without this, a PM will conclude the product lacks them.
5. **Refreshing it** — the two script names and the note that both are `--dry-run` by default and safe to re-run.

- [ ] **Step 2: Verify no secret leaked in**

Run:
```bash
grep -inE "password|secret|service_role|eyJ|@gmail|@artpark\.in" docs/DEMO_ENVIRONMENT.md
```
Expected: matches only on the phrase pointing the reader at who to ask for the password. Any key-shaped string (`eyJ…`) or real-looking email is a failure — the repo is public.

- [ ] **Step 3: Commit**

```bash
git add docs/DEMO_ENVIRONMENT.md
git commit -m "docs(demo): product-manager handout for the staging demo environment"
```

---

## Task 4: Run the masking

**Files:** none modified — this task executes Task 1's script against staging.

**This is the irreversible step.** It cannot be undone without re-importing from production.

- [ ] **Step 1: Capture a before-sample**

```bash
cd backend && python - <<'PY'
import os, sys
sys.path.insert(0, '.')
from app.supabase_client import get_admin_client
sb = get_admin_client()
for t in ("tir_applications", "sip_applications", "profiles"):
    col = "basic_email" if t.endswith("applications") else "email"
    rows = sb.table(t).select(f"id,{col}").limit(8).execute().data or []
    print(t, [ (r.get(col) or "")[-22:] for r in rows ])
PY
```
Record the output. This is the evidence that masking changed something.

- [ ] **Step 2: Dry run**

Run: `cd backend && python scripts/mask_staging_identities.py`
Expected: per-table counts and three sample patches per table, zero writes. Sanity-check that the count for `tir_applications` is close to 283 minus the staff exemptions.

- [ ] **Step 3: Confirm with the user before applying**

Post the dry-run counts and wait for an explicit go-ahead. Do not apply on your own judgement — this is the irreversible step and the user owns it.

- [ ] **Step 4: Apply**

Run: `cd backend && python scripts/mask_staging_identities.py --apply`

- [ ] **Step 5: Verify no real identity survives**

```bash
cd backend && python - <<'PY'
import sys; sys.path.insert(0, '.')
from app.supabase_client import get_admin_client
sb = get_admin_client()
EXEMPT = ("@artpark.in", "@artpark.info", "@artpark.test")
bad = []
for t in ("tir_applications", "sip_applications", "profiles"):
    col = "basic_email" if t.endswith("applications") else "email"
    page = 0
    while True:
        rows = sb.table(t).select(f"id,{col}").range(page*500, page*500+499).execute().data or []
        for r in rows:
            e = (r.get(col) or "").strip().lower()
            if e and not e.endswith(EXEMPT):
                bad.append((t, r["id"], e))
        if len(rows) < 500: break
        page += 1
print("UNMASKED ROWS:", len(bad))
for b in bad[:20]: print("  ", b)
PY
```
Expected: `UNMASKED ROWS: 0`. Anything else means the mask surface was incomplete — report it rather than proceeding.

- [ ] **Step 6: Confirm the VIP QA founder survived**

```bash
cd backend && python - <<'PY'
import sys; sys.path.insert(0, '.')
from app.supabase_client import get_admin_client
sb = get_admin_client()
r = sb.table("sip_applications").select("basic_email,status") \
      .eq("basic_email", "claude-test-applicant-sip@artpark.in").execute().data
print("VIP QA founder:", r)
PY
```
Expected: one row, `status = 'onboarded'`, email unchanged. The in-progress VIP branch depends on it.

---

## Task 5: Run the seed

**Files:** none modified — this task executes Task 2's script.

- [ ] **Step 1: Dry run and read every slot**

Run: `cd backend && python scripts/seed_demo_cohort.py`
Confirm: twelve distinct application ids, and the statuses match `DEMO_PLAN`.

- [ ] **Step 2: Apply**

Run: `cd backend && python scripts/seed_demo_cohort.py --apply`
Capture the printed credentials — they go to the user, not into any file.

- [ ] **Step 3: Verify the twelve states landed**

```bash
cd backend && python - <<'PY'
import sys; sys.path.insert(0, '.')
sys.path.insert(0, 'scripts')
from app.supabase_client import get_admin_client
from seed_demo_cohort import DEMO_PLAN
sb = get_admin_client()
for want in sorted({p["status"] for p in DEMO_PLAN}):
    n = 0
    for t in ("tir_applications", "sip_applications"):
        n += len(sb.table(t).select("id").eq("status", want).execute().data or [])
    print(f"  {want:14} {n}")
PY
```
Expected: every status in the plan has at least one row.

- [ ] **Step 4: Verify the aggregate verdict rule produces all three outcomes**

```bash
cd backend && python - <<'PY'
import sys; sys.path.insert(0, '.')
from app.supabase_client import get_admin_client
from app.services.admin_query import reco_verdict
sb = get_admin_client()
rows = sb.table("reviews").select("application_id,recommendation,submitted_at").execute().data or []
tally = {}
for r in rows:
    if not r.get("submitted_at"): continue
    t = tally.setdefault(r["application_id"], {"yes":0,"maybe":0,"no":0})
    t[r["recommendation"]] = t.get(r["recommendation"], 0) + 1
seen = {}
for aid, t in tally.items():
    seen.setdefault(reco_verdict(t), []).append(aid)
for v in ("yes", "maybe", "no"):
    print(f"  verdict {v!s:6} -> {len(seen.get(v, []))} application(s)")
PY
```
Expected: at least one application for each of `yes`, `maybe` and `no`. This is the check that the RECO column and the count-threshold rule are demonstrable — it uses the real production function, not a reimplementation.

- [ ] **Step 5: Verify the IC memo row respects the partial unique index**

```bash
cd backend && python - <<'PY'
import sys; sys.path.insert(0, '.')
from app.supabase_client import get_admin_client
sb = get_admin_client()
rows = sb.table("ic_documents").select("application_id,signed_at,superseded_at").execute().data or []
cur = [r for r in rows if r.get("superseded_at") is None]
print("ic_documents:", len(rows), "total,", len(cur), "current,",
      sum(1 for r in cur if r.get("signed_at")), "signed")
PY
```
Expected: at least one current row, at least one of them signed, and no application with two current rows.

---

## Task 6: Bring staging current, then verify end to end

**Files:** none modified.

**Both deploy steps are outward-facing and must be confirmed with the user first.** They also affect the in-progress VIP work, which shares this stack.

- [ ] **Step 1: Check the intake flags before deploying**

```bash
grep -E "TIR_SUBMISSIONS_CLOSED|SIP_SUBMISSIONS_CLOSED" \
  /Users/apple/Desktop/Final_AP_os/backend/.env.staging
```
`deploy-staging.sh` defaults these to `false`. Staging should mirror production's closed intake or the demo misrepresents the current state. Report the values and fix them in `.env.staging` before deploying if they are absent or `false`.

- [ ] **Step 2: Confirm with the user, then deploy the API**

```bash
cd infra/sam && ./deploy-staging.sh
```
Check `docker info` first — without Docker the script falls back to a host build, which ships macOS wheels.

- [ ] **Step 3: Fast-forward the staging frontend**

Verify it is still a clean fast-forward, then push:
```bash
git fetch origin
git rev-list --count origin/release/sip-launch-v1..origin/staging   # must be 0
git push origin release/sip-launch-v1:staging
```
Vercel rebuilds `ap-os-git-staging-artpark.vercel.app` automatically.

- [ ] **Step 4: Confirm the deployed bundle carries the current admin work**

```bash
BUNDLE=$(curl -s https://ap-os-git-staging-artpark.vercel.app/apply | grep -oE '/assets/[^"]+\.js' | head -1)
curl -s "https://ap-os-git-staging-artpark.vercel.app$BUNDLE" | grep -c "adm-decision-accepted"
```
Expected: at least 1. That class ships only with the Accepted-tab decision states, so it is a positive marker that the new build is live rather than a cached old one. If it is 0, the deploy has not propagated — wait and re-check rather than assuming failure.

- [ ] **Step 5: Sign in as the demo account and walk all three portals**

Confirm, and report each:
- signing in lands on `/leadership`
- "Switch role" offers Leadership, Reviewer and Admin
- the Admin portal shows seven tabs and no "Jury Decision" toggle
- the Accepted tab renders with a green ACCEPTED row and a red REJECTED row
- the Reviewer portal's queue is **not empty** (this is the trap in spec §7.2 — the demo account needs its own assignments)
- Gate 1 shows applications with RECO values

- [ ] **Step 6: Report the credentials to the user**

Give the URL, email and password in chat. Not in a file, not in a commit — the repo is public.

---

## Self-Review

**Spec coverage.**

| Spec section | Task |
|---|---|
| §4.1 frontend fast-forward | 6 |
| §4.2 API redeploy | 6 |
| §4.3 intake flags | 6 |
| §4.4 migrations | already applied — no task, verified before planning |
| §5 masking (surface, determinism, exemptions, safety, irreversibility) | 1, 4 |
| §6.1 twelve applications | 2 |
| §6.2 supporting state | 2 |
| §6.3 no storage uploads | 2 (placeholder `storage_path`) |
| §7 demo account, incl. the reviewer-assignment trap | 2, 6 |
| §8 handout | 3 |
| §9 verification (all six items) | 4, 5, 6 |
| §10 risks | guards in 1 and 2; VIP founder check in 4 |

**Deviation from the spec, flagged:** §6.1 said the twelve rows would be tagged in `application_admin_meta` with a `demo_seq` marker. That table has no spare column and adding one would mean a new migration. Selection is deterministic by sorted application id instead — same stability, no schema change.

**Placeholder scan.** No TBD/TODO. Task 2 Step 5 describes the apply half as an ordered list of operations with exact table names, column names and constraint rules rather than a full code block — the code is long and mechanical, and every value it needs is specified. Task 3 specifies the handout by required section rather than by prose, since the prose is the deliverable.

**Type consistency.** `fake_identity` returns the same five keys everywhere it is used, and `FIELD_MAP` maps only to those keys. `mask_row(row, columns)` has one signature across the script and its tests. `select_demo_rows(candidates, plan)` returns `list[tuple[dict, dict]]` in both the planner and its tests. `reviews_for(spec)` takes the four keys present in `_REVIEW_SETS` and every `DEMO_PLAN` entry's `reviews` value is one of those four. `DEMO_EMAIL` is defined once.
