# Supabase migrations

SQL for the ARTPARK EIR schema. Run these once, in order, against a fresh
Supabase project.

| File | What it does |
|---|---|
| [`001_initial_schema.sql`](001_initial_schema.sql) | Tables, indexes, triggers, RLS policies |
| [`002_storage.sql`](002_storage.sql) | `resumes` bucket + per-user path RLS |

## 1. Create the Supabase project

1. Sign in to [supabase.com](https://supabase.com/dashboard).
2. **New project** → name it something like `artpark-eir-prod`.
3. **Region**: choose **`ap-south-1` (Mumbai)** — lowest latency from India.
4. Set a strong database password and store it in a password manager. You
   won't see it again.
5. Wait for the project to finish provisioning (~2 minutes).

## 2. Grab the credentials

Open **Project Settings** and copy these four values into your `.env` files
(see `backend/.env.example` and `frontend/.env.example`):

| Key | Where | Consumed by | Exposed to browser? |
|---|---|---|---|
| Project URL | Settings → API → Project URL | frontend + backend | ✓ (public) |
| `anon` public key | Settings → API → Project API keys | frontend + backend | ✓ (public) |
| `service_role` secret key | Settings → API → Project API keys | backend only | ✗ **NEVER ship** |
| Database password | (set during project creation) | direct psql / CLI | ✗ |

Populate:

```bash
# frontend/.env.local
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...

# backend/.env
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
```

## 3. Run the migrations

Two options — pick one.

### Option A — SQL Editor (fastest for a first run)

1. Dashboard → **SQL Editor** → **New query**.
2. Paste the contents of `001_initial_schema.sql`, click **Run**.
   - Expect: `Success. No rows returned` and five new tables visible in the
     Table Editor.
3. New query, paste `002_storage.sql`, **Run**.
   - Expect: `Success. No rows returned` and a `resumes` bucket under
     Storage → Buckets.

Both files wrap everything in a single `BEGIN; … COMMIT;` so if any statement
fails, nothing is partially applied.

### Option B — Supabase CLI (repeatable, recommended for prod)

```bash
# install once
brew install supabase/tap/supabase

# from the repo root
supabase link --project-ref <project-ref>

# apply each migration via psql
supabase db execute --file backend/migrations/001_initial_schema.sql
supabase db execute --file backend/migrations/002_storage.sql
```

If you're adopting this approach long-term, move the files under
`supabase/migrations/` using Supabase CLI naming (`<timestamp>_name.sql`) so
`supabase db push` picks them up automatically.

## 4. Configure Auth

Dashboard → **Authentication** → **Providers / Settings**:

1. **Email provider**: enable. Uncheck "Confirm email" if you want signups to
   activate immediately; keep it checked if you want double opt-in (the Phase 3
   OTP flow sends a 6-digit code either way).
2. **Site URL**: `https://<your-vercel-domain>` in prod, `http://localhost:5173`
   in dev.
3. **Redirect URLs**: add both of the above plus any staging URLs.
4. **Email templates** (later, Phase 3): customise the OTP template to include
   ARTPARK branding.

Rate limits are on by default (30 signups/hour per IP, etc.) — leave them.

## 5. Sanity checks

Run each of these from the SQL Editor. They match the Phase 1 acceptance
checklist.

```sql
-- All 5 tables present?
select tablename from pg_tables where schemaname = 'public' order by tablename;
-- Expected: applications, audit_logs, profiles, resume_uploads, support_tickets

-- Profile auto-creation trigger working?
-- Do this via the Auth UI (create a throwaway user), then run:
select id, email, created_at from public.profiles order by created_at desc limit 1;
-- Expected: a row matching the user you just created

-- RLS truly on?
select tablename, rowsecurity from pg_tables
 where schemaname = 'public'
   and tablename in ('profiles','applications','resume_uploads','support_tickets','audit_logs');
-- Expected: rowsecurity = true for all 5 rows

-- Anon cannot read applications?
set role anon;
select count(*) from public.applications;
-- Expected: 0 (RLS blocks anon without an auth.uid())
reset role;

-- Storage bucket private and restricted?
select id, public, file_size_limit, allowed_mime_types
  from storage.buckets where id = 'resumes';
-- Expected: public=false, file_size_limit=10485760, 3 mime types
```

## 6. When you need to reset

For dev Supabase projects you may want to wipe and re-apply:

```sql
-- In the SQL editor. DROPs cascade so no order dance needed.
drop table if exists public.audit_logs      cascade;
drop table if exists public.support_tickets cascade;
drop table if exists public.resume_uploads  cascade;
drop table if exists public.applications    cascade;
drop table if exists public.profiles        cascade;
drop function if exists public.handle_new_user()              cascade;
drop function if exists public.tg_touch_updated_at()          cascade;
drop function if exists public.tg_applications_stamp_submitted() cascade;
```

Then re-run `001_initial_schema.sql`.

Deleting a storage bucket also requires clearing objects first:

```sql
delete from storage.objects where bucket_id = 'resumes';
delete from storage.buckets where id = 'resumes';
```

Then re-run `002_storage.sql`.

## Notes on schema decisions

- **Why typed columns, not one JSONB blob?** The admin analytics layer (planned
  for Phase 9) relies on being able to `select avg(basic_degree)`,
  `group by solution_stage`, etc. without casting from JSON. JSONB is reserved
  for genuinely open-ended lists: `basic_teammates` (up to 3 objects),
  `evidence_files` (a list of attachments), `evidence_deck` (single file object),
  and `resume_uploads.parsed_data` (LLM output with an evolving shape).

- **Why enum CHECK constraints instead of ENUM types?** CHECK lists are easy to
  diff against `questions.jsx` in code review and easy to relax. A `CREATE TYPE`
  ENUM would look cleaner but ALTERing values later is awkward. If the option
  lists churn a lot in Phase 2+, we can migrate to ENUM types then.

- **Why decompose `declarations` into BOOLEANs?** The four checkboxes
  (`truthful`, `refChecks`, `terms`, `newsletter`) have distinct semantics and
  are queried independently (e.g. newsletter opt-in for marketing). Decomposed
  columns beat a JSONB object for ad-hoc queries.

- **Why can't clients update applications after submission?** The
  `"applications: self can update draft"` policy's `USING` clause requires
  `status = 'draft'`. Once the backend stamps `status = 'submitted'` (via the
  service-role key, which bypasses RLS), subsequent client UPDATEs fail. This
  enforces the read-only-after-submit rule server-side rather than relying on
  the UI.

- **Why `audit_logs` has no policies?** RLS is enabled but no SELECT/INSERT
  policies means the `anon` and `authenticated` roles get no access. The
  backend writes via the `service_role` key which bypasses RLS entirely.
