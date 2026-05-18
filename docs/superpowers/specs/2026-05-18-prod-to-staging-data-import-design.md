# ARTPARK OS — Prod → Staging data import design

**Status**: draft for review
**Date**: 2026-05-18
**Branch**: `staging-role_based_dashboard`
**Source Supabase**: prod `xtmszlpwgbyoumalgbhs` (`https://apply.artpark.info`)
**Destination Supabase**: staging `exqmxvdtcsvpgtftwjml` (`https://ap-os-git-staging-rolebaseddashboard-artpark.vercel.app`)
**Scope**: copy every real applicant entry — all columns, plus referenced storage objects — from prod to staging, so leadership reviewers can see real data on the new full-page review surface.

---

## 1. Goal

The leadership review surface (shipped on `staging-role_based_dashboard`) currently renders 40 synthetic seed applications. To validate the design against actual data — and to give the team a faithful preview before promoting Phase 1 to prod — copy every real applicant from prod into staging.

**Hard constraint**: the staging runtime (Vercel preview + staging Lambda) must NOT be wired to the prod database. The import is a one-off offline copy executed from a developer laptop. Prod credentials never land in any deployment env, GitHub Actions secret, or shared infrastructure.

---

## 2. Decisions locked in during brainstorming

| Question | Decision |
|---|---|
| Scope of data | Applications + side tables + Supabase Storage files (full fidelity). |
| Source project | `xtmszlpwgbyoumalgbhs` (matches `frontend/.env.production`). Service-role key already in dev's hands. |
| PII handling | Copy as-is — no redaction. Staging is internal-team-only; leadership sees this PII in prod anyway. Sign-in gate is the protection. |
| Seed-data handling | Wipe the 40 synthetic apps. Preserve the 3 sign-in test users (`dev@artpark.in`, `manager@artpark.in`, `test@artpark.in`) and the 6 seeded reviewer accounts plus their `user_roles` grants. |
| Cadence | Repeatable runbook — re-run as prod gets new submissions. |
| Auth.users handling | Create stub `auth.users` entries for every imported applicant, with a **scrambled** (random-32-bytes-hex) password. Email confirmed, login disabled-in-practice. |
| Prod TIR table names | Legacy: `applications`, `resume_uploads`, buckets `resumes` / `evidence-files` / `milestone-files`. Prod is pre-migration-010. |
| Prod admin tables | **None.** No `user_roles` / `reviewer_assignments` / `reviews` / `ai_screening` / `application_status_log` / `audit_log_v2` rows in prod. |
| Prod SIP tables | **None.** Prod has no SIP applications and no SIP tables / buckets. |

---

## 3. Repo layout

```
scripts/
└── import-prod-to-staging/
    ├── README.md                  ← runbook (committed)
    ├── import.py                  ← main script (committed)
    ├── run.sh                     ← shell wrapper, sources .env.import
    ├── lib/
    │   ├── tables.py              ← table list, FK ordering, preserve-list, name map
    │   ├── auth.py                ← stub-user creation via Admin API, remap builder
    │   ├── storage.py             ← prod → staging Storage object copy
    │   └── verify.py              ← row-count + FK integrity checks
    ├── .env.import.example        ← committed template, NO real keys
    ├── .env.import                ← GITIGNORED, holds 4 secrets (URLs + service-role keys)
    └── runs/                      ← GITIGNORED, per-run transcript logs
```

`.gitignore` gets two new entries:

```
scripts/import-prod-to-staging/.env.import
scripts/import-prod-to-staging/runs/
```

**`.env.import` shape** (file the developer creates by hand on their laptop):

```bash
PROD_SUPABASE_URL=https://xtmszlpwgbyoumalgbhs.supabase.co
PROD_SUPABASE_SERVICE_ROLE_KEY=eyJ...prod...

STAGING_SUPABASE_URL=https://exqmxvdtcsvpgtftwjml.supabase.co
STAGING_SUPABASE_SERVICE_ROLE_KEY=eyJ...staging...
```

These credentials live exclusively on whichever dev laptop runs the script. Nothing about prod ever lands in Vercel env vars, Lambda env vars, or GitHub Actions.

---

## 4. Wipe + preserve list

Before importing, staging needs cleaning. The script uses a two-tier wipe:

### 4.1 Full truncate

```
tir_applications
tir_resume_uploads
ai_screening
reviewer_assignments
reviews
application_status_log
audit_log_v2
```

`sip_*` tables stay alone — prod has nothing for them, and they're already empty post-seed.

### 4.2 Filtered delete (preserve a set)

| Table | Rows preserved |
|---|---|
| `auth.users` | The 3 sign-in test users (`dev@artpark.in`, `manager@artpark.in`, `test@artpark.in`) **plus** every user that currently holds the `reviewer` role in `user_roles` at the moment the script runs (resolved dynamically — the expected set today is the 6 seed reviewer accounts: `reviewer-1@artpark.in` … `reviewer-3@artpark.in`, `manager@artpark.in`, `test-rv-*@artpark.in`, but if you've added more reviewers manually they're preserved automatically). |
| `profiles` | Same set, joined by `id ← auth.users.id`. |
| `user_roles` | Same set. |

### 4.3 Tables left untouched

`support_tickets` (independent of applications), `storage.objects` (handled in §7 separately).

### 4.4 Implementation note

`PRESERVE_EMAILS` is a hard-coded constant in `lib/tables.py`. The script SELECTs the UUIDs for those emails **before** the wipe and holds them in memory as the "don't delete" set. Order of operations:

1. Resolve preserve-set UUIDs.
2. Truncate child tables (audit_log_v2 → application_status_log → reviews → reviewer_assignments → ai_screening) — these have FKs.
3. Truncate parent tables (tir_applications, sip_applications, tir_resume_uploads, sip_resume_uploads).
4. Delete from `auth.users`, `profiles`, `user_roles` where `id` not in preserve set.

### 4.5 Pre-flight safety check

Before any destructive action, the script verifies:

- `STAGING_SUPABASE_URL` host contains `exqmxvdtcsvpgtftwjml` (the staging project ref).
- `PROD_SUPABASE_URL` host contains `xtmszlpwgbyoumalgbhs` (the prod project ref).
- `SELECT count(*) FROM tir_applications WHERE basic_email LIKE '%@artpark.test'` returns > 0 — confirms staging contains seed data (the `@artpark.test` email pattern is the seed signature).

If any check fails, the script aborts before mutating anything.

---

## 5. Auth.users + profiles stub creation

### 5.1 Why this step

Prod applications have a FK on `user_id → auth.users.id`. If we import application rows without their owners, FKs dangle. Per project memory, direct SQL inserts into `auth.users` are rejected by Supabase GoTrue — only `POST /auth/v1/admin/users` creates a valid login row.

### 5.2 Algorithm

**Step A — collect distinct prod user_ids.** Walk every prod row we're about to import (just `applications.user_id` and `resume_uploads.user_id` given the simplified scope). Build the set of distinct UUIDs.

**Step B — for each unique prod_uid, fetch the prod auth + profile data:**

```sql
-- prod
SELECT email, phone, raw_user_meta_data
FROM auth.users WHERE id = <prod_uid>;

SELECT full_name, phone, linkedin_url, location_city, location_country, track
FROM profiles WHERE id = <prod_uid>;
```

**Step C — branch per email:**

- **If email ∈ `PRESERVE_EMAILS`** (the dev/manager/test/reviewer set from §4.2): no creation needed. Look up the existing staging UUID, record `prod_uid → existing_staging_uid` in the remap dict.
- **If email already exists in staging from a prior import** (HTTP 422 `user_already_exists` on Admin API call): same — look up existing UUID by email, record in remap.
- **Otherwise**, call staging's Admin API:

  ```python
  staging.auth.admin.create_user({
      "email": prod_email,
      "password": secrets.token_hex(32),       # scrambled — applicant can't sign in
      "email_confirm": True,
      "user_metadata": {
          "track": prod_track or "tir",
          "imported_at": datetime.utcnow().isoformat() + "Z",
          "source": "prod-import",
      },
  })
  # response.user.id is the new staging UUID
  ```

  Record `prod_uid → new_staging_uid` in remap. Then UPDATE the staging `profiles` row (which the `handle_new_user()` trigger already created via the auth insert) with `full_name`, `phone`, `linkedin_url`, etc. from prod.

**Step D — the `remap` dict is the single source of truth.** Every subsequent table insert in §6 routes every UUID column through `remap.get(prod_uid, prod_uid)`. If a UUID isn't in the remap (rare edge: a deleted prod owner referenced by an orphan log row), the row is logged and skipped rather than 500'd.

### 5.3 Why scrambled passwords (not real ones)

Three reasons:

1. Real applicants don't need to sign in to staging — they have no role grant (we don't import `user_roles` from prod).
2. Leakage protection: even if a real applicant guessed the staging URL, they couldn't authenticate as themselves.
3. The leadership review page reads `basic_email` from the application row directly, not via a profile lookup, so the page works regardless of whether the auth user has a working password.

### 5.4 Idempotency

Re-running the script (or running it after an aborted prior run) is safe:

- Existing emails in staging return their existing UUID via the 422 branch.
- The remap dict is rebuilt fresh each run from prod's current state.
- `profiles` updates use `upsert`-style semantics (SELECT-then-INSERT-or-UPDATE).

---

## 6. Application + resume copy

### 6.1 Table-name mapping

```python
# lib/tables.py
TABLE_MAP = {
    "applications":     "tir_applications",
    "resume_uploads":   "tir_resume_uploads",
}

SKIPPED_TABLES_PROD_MISSING = [
    "user_roles",
    "reviewer_assignments",
    "reviews",
    "ai_screening",
    "application_status_log",
    "audit_log_v2",
]

SIP_TABLES_TO_SKIP = ["sip_applications", "sip_resume_uploads"]
SIP_BUCKETS_TO_SKIP = ["sip-resumes", "sip-evidence-files", "sip-milestone-files"]
```

### 6.2 Insert order (after §5 auth/profiles done)

```
1. applications  →  tir_applications     (PARENT)
2. resume_uploads → tir_resume_uploads   (FK → auth.users)
```

### 6.3 Column-list safety probe

Before the first INSERT, probe both schemas:

```python
prod_cols     = set(probe_columns(prod, "applications"))
staging_cols  = set(probe_columns(staging, "tir_applications"))
shared        = prod_cols & staging_cols       # the actual columns we copy
extra_prod    = prod_cols - staging_cols       # warn + drop
extra_staging = staging_cols - prod_cols       # info; default values used
```

- `shared` is the projection used for both SELECT and INSERT.
- `extra_prod` (columns prod has but staging doesn't) → logged as warning, dropped from copy. Shouldn't happen if staging is a strict superset of prod migrations.
- `extra_staging` (columns staging has but prod doesn't, e.g., admin Phase 1 column additions) → logged as info; those columns default to NULL or `[]::jsonb`. Expected.

### 6.4 Per-row copy

```python
rows = prod.table("applications").select(",".join(shared)).execute().data
for row in rows:
    row["user_id"] = remap[row["user_id"]]
for chunk in batched(rows, batch_size=100):
    staging.table("tir_applications").insert(chunk).execute()
```

`resume_uploads → tir_resume_uploads` uses the same pattern.

### 6.5 What does NOT get transformed

- **Application primary keys (`id` UUIDs)** are preserved verbatim. A prod URL like `/leadership/applications/tir/<uuid>/review` resolves to the same applicant after import. Useful for cross-env debug.
- **JSONB columns** are copied verbatim: `basic_teammates`, `evidence_files`, `evidence_deck` (legacy), `execution_milestone_files` (if present from migrations 004+).
- **Timestamps** (`created_at`, `submitted_at`, `updated_at`) — verbatim. The dashboard shows prod submission dates.
- **Status values** — verbatim. Prod's 7-status set is a strict subset of staging's post-015 13-status set, so every value is valid.

### 6.6 Failure modes

| Error | Action |
|---|---|
| 23503 FK violation | Abort. Means parent insert failed or remap is missing an entry. |
| 23505 unique violation | Log and continue (idempotent re-run on existing row). |
| Batch timeout | Halve the batch size, retry once, then abort. |
| Unknown column on insert | Log offending column, drop it from the batch, continue. |

### 6.7 Imported-app default state

Imported applications land with empty admin state:

- AI panel shows "AI screening not run yet." — no `ai_screening` row.
- Reviews tab shows "No reviews submitted yet." — no `reviews` / `reviewer_assignments` rows.
- History tab shows "No status changes yet." — no `application_status_log` rows.
- Status chip reads whatever prod's `applications.status` had.

This is correct degradation — prod hasn't been running any of those subsystems yet.

---

## 7. Storage object sync

### 7.1 Bucket mapping

```python
# lib/storage.py
BUCKET_MAP = {
    "resumes":            "tir-resumes",
    "evidence-files":     "tir-evidence-files",
    "milestone-files":    "tir-milestone-files",
}
```

### 7.2 What to copy — discovery passes

The script doesn't dump entire prod buckets. It copies only objects referenced by imported application/resume rows.

**Pass 1 — resume_uploads scan.** `tir_resume_uploads.storage_path` is a top-level text column. SELECT it directly → set of paths in the `resumes` bucket.

**Pass 2 — JSONB walk.** After §6 inserts complete, walk these JSONB columns on `tir_applications`. **The bucket is inferred from the source column, not from the path string** — applicant uploads in the wizard store only `<uid>/<filename>` (no bucket prefix), and each question writes to one specific bucket:

| JSONB column | Source bucket on prod | Destination bucket on staging |
|---|---|---|
| `evidence_files[]` (array) | `evidence-files` | `tir-evidence-files` |
| `evidence_deck` (single, legacy) | `evidence-files` | `tir-evidence-files` |
| `execution_milestone_files[]` (array, legacy) | `milestone-files` | `tir-milestone-files` |
| `basic_teammates[]` | no storage paths — skip | — |

For each row in each column, extract `entry["storage_path"]` (skipping null entries). Build `(prod_bucket, staging_bucket, path)` triples and feed them into the per-object copy loop.

**Combined set** = union of pass 1 + pass 2, deduplicated. For a few hundred applications, this is typically 1000-2000 distinct objects.

### 7.3 Per-object copy

```python
def copy_object(prod, staging, prod_bucket, staging_bucket, path):
    blob = prod.storage.from_(prod_bucket).download(path)
    staging.storage.from_(staging_bucket).upload(
        path=path,
        file=blob,
        file_options={"content-type": guess_mime(path), "upsert": "true"},
    )
```

Path is identical on both sides — the storage path's UUID prefix is left unchanged even though the auth-user UUID was remapped in §5.

### 7.4 Why no path remapping

Leadership/admin reads files via service-role, which bypasses Storage RLS — the prefix UUID doesn't need to match `auth.uid()`. Applicants can't sign in to staging (scrambled passwords), so the per-user RLS check never fires for them. Rewriting paths would mean editing every JSONB blob to swap UUIDs — fragile and unnecessary for the review-page use case.

### 7.5 Idempotency, concurrency, errors

- **Idempotency**: `upsert=True` makes re-runs safe. Re-running overwrites with the latest bytes from prod.
- **Concurrency**: 8 worker threads via `concurrent.futures.ThreadPoolExecutor`. Roughly 1000 × ~1MB objects in 1-2 minutes.
- **Per-object failure modes**:
  - `404 on download` (prod object missing): log warning, skip, continue. JSONB reference becomes orphan but harmless (review page renders metadata, Download is a Phase-1.5 stub anyway).
  - Upload failure (size cap, MIME violation): log error with offending path, abort.
- **Sanity threshold**: if total bytes to copy exceeds 500 MB, the script prints the figure and asks for `y/N` confirmation before proceeding.
- **Progress logging**: every 50 objects, one line — `[storage] 250/1247 objects synced (320 MB / 1.4 GB)`.

---

## 8. Verification

`lib/verify.py` runs at the end. Three checks printed as a summary table.

### 8.1 Row counts

Compare prod row count vs staging row count per imported table:

```
table                       prod    staging    delta
applications                 247      247        ✓
resume_uploads               198      198        ✓
auth.users (imported)        247      247        ✓
auth.users (preserved)        —         9        ✓ (3 test + 6 reviewers)
profiles                     247      256        ✓ (247 imported + 9 preserved)
```

Non-zero unexpected delta → coral-printed red flag, exit code 1.

### 8.2 FK integrity

Spot-check that every imported `tir_applications.user_id` resolves to a staging `auth.users` row:

```sql
SELECT count(*) FROM tir_applications
WHERE user_id NOT IN (SELECT id FROM auth.users);
```

Expected: 0.

### 8.3 Storage sanity

Pick 5 random imported applications. For each, attempt to fetch one file from its `evidence_files` JSONB via the staging Storage API. All 5 fetch → green. Any 404 → log which path (already logged as orphan during §7; this is informational).

### 8.4 Summary block

The script ends with a wrap-up:

```
[done] Imported 247 applications + 198 resume uploads + 1247 storage objects (1.4 GB)
[done] Preserved 9 staging users (3 test logins + 6 seeded reviewers)
[done] Wiped 40 synthetic seed apps + their side tables
[done] Verification: row counts ✓ · FK integrity ✓ · Storage sanity ✓
[done] Total wall-clock: 3m 41s
```

---

## 9. Runbook (the README contents)

```bash
# One-time setup
cd /Users/.../Final_AP_os
cp scripts/import-prod-to-staging/.env.import.example \
   scripts/import-prod-to-staging/.env.import
# Edit .env.import — paste prod + staging service-role keys
#   (Supabase Dashboard → Project Settings → API → service_role key)

# Run the import
./scripts/import-prod-to-staging/run.sh

# Re-run anytime new applicants submit to prod
./scripts/import-prod-to-staging/run.sh   # same command, idempotent
```

Every run writes a timestamped transcript to `scripts/import-prod-to-staging/runs/YYYY-MM-DD-HHMMSS.log` (gitignored) for post-mortem grep.

---

## 10. Rollback

The import is destructive of staging seed data. Three rollback levers, in order of preference:

1. **Re-seed.** `python backend/scripts/seed_synthetic_cohort.py` regenerates the 40 synthetic apps. Already idempotent.
2. **Supabase Point-in-Time Restore.** Available on Supabase Pro plans; staging is on free tier (per project memory), so PITR may not be available — confirm via Supabase staging project's Backups tab.
3. **Re-run the import.** A second run cleans up a partial first run.

---

## 11. What this design intentionally does NOT include

- Importing `support_tickets` — operationally noisy and irrelevant to the leadership review page.
- Importing `user_roles` from prod — prod doesn't have the table, and staging's existing role grants on the preserved test users are exactly what we want.
- Path remapping for storage objects — service-role read bypasses RLS.
- Scheduled daily refresh via GitHub Actions — would require putting prod service-role key into a CI secret, softening the "prod isn't connected to test" boundary. The repeatable runbook on dev's laptop is sufficient.
- Two-way sync — this is one-directional prod → staging only. Staging changes never propagate back.
- A separate "preview" mode that simulates without writing — overkill for a script the dev owns end-to-end.

---

## 12. Acceptance criteria

The import is considered successful when:

1. ⬜ `./run.sh` exits zero with the green verification summary.
2. ⬜ Signing in as `dev@artpark.in / staging-pass-2026` lands on the leadership dashboard.
3. ⬜ The Applications tab shows real prod applicant names (not Divya Singh / Rohan Joshi / Priya Kapoor).
4. ⬜ Opening any imported application's review page renders:
   - The applicant's real `basic_*` fields under Section 01.
   - All free-text wizard answers under Sections 02-04 (Problem, Solution, Roadmap).
   - Real evidence files in Section 05's FileGridAnswer (one card per file, filename + size).
   - Real video URL embed in Section 05 (if applicant submitted one).
   - Real declaration checkbox state in Section 06.
5. ⬜ AI Screening panel shows "AI screening not run yet." for imported apps (correct — no `ai_screening` rows from prod).
6. ⬜ Reviews tab shows "No reviews submitted yet." for imported apps.
7. ⬜ History tab shows "No status changes yet." for imported apps.
8. ⬜ The 6 seed reviewers + 3 test users still exist in staging and can be signed in / assigned to imported apps via the existing drawer flow.
9. ⬜ No prod credentials are present in any committed file, Vercel env var, Lambda env var, or GitHub Action.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| Misconfigured `.env.import` points the wipe at prod | §4.5 pre-flight check verifies project refs + seed-data signature before wiping. |
| Prod schema drift since this design was written (e.g., a new column added to `applications`) | §6.3 column-list safety probe drops unknown prod columns and logs them; staging-only columns get NULL defaults. |
| Storage objects too large to fit staging quotas | §7.5 sanity threshold (500 MB) prompts for confirmation. |
| Real applicant signs into staging because we copied auth.users | §5.2 scrambles every imported user's password — login is functionally impossible. |
| PITR not available on staging free tier, no clean rollback | §10 levers 1 + 3 (re-seed, re-run) suffice for our scale. Confirm PITR availability before first run if concerned. |
| Prod `applications` has rows with `status` values outside the canonical 7-set | Logged + dropped at insert; doesn't crash the import. Manual investigation if non-zero. |

---
