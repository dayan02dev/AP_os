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
