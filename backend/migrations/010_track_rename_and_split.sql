-- 010_track_rename_and_split.sql — multi-track foundation (TIR + SIP).
--
-- Renames TIR-only tables, indexes, triggers, constraints, RLS policies,
-- storage buckets and bucket policies to carry an explicit `tir_` / `tir-`
-- prefix. Adds a `track` column to public.profiles and updates the
-- handle_new_user() trigger to populate it from auth signup metadata.
--
-- After this migration:
--   - applications        →  tir_applications
--   - resume_uploads      →  tir_resume_uploads
--   - bucket "resumes"          →  "tir-resumes"
--   - bucket "milestone-files"  →  "tir-milestone-files"
--   - bucket "evidence-files"   →  "tir-evidence-files"
--   - profiles.track exists (NULL ok; default 'tir' for back-compat)
--
-- Run BEFORE 011_sip_track.sql (which creates the SIP equivalents).
--
-- Idempotent on a fresh apply (uses IF EXISTS / ON CONFLICT). Re-running
-- after partial success may leave a mix of old + new names — diagnose
-- with the verification block at the bottom.

begin;

-- ════════════════════════════════════════════════════════════════════
-- 1. Rename tables
-- ════════════════════════════════════════════════════════════════════
alter table if exists public.applications     rename to tir_applications;
alter table if exists public.resume_uploads   rename to tir_resume_uploads;

-- ════════════════════════════════════════════════════════════════════
-- 2. Rename indexes
--    (Postgres does NOT auto-rename indexes when a table is renamed.)
-- ════════════════════════════════════════════════════════════════════
alter index if exists public.applications_pkey                  rename to tir_applications_pkey;
alter index if exists public.applications_status_idx            rename to tir_applications_status_idx;
alter index if exists public.applications_submitted_at_idx      rename to tir_applications_submitted_at_idx;
alter index if exists public.applications_user_id_idx           rename to tir_applications_user_id_idx;
alter index if exists public.applications_one_draft_per_user    rename to tir_applications_one_draft_per_user;
alter index if exists public.applications_user_submitted_idx    rename to tir_applications_user_submitted_idx;

alter index if exists public.resume_uploads_pkey                rename to tir_resume_uploads_pkey;
alter index if exists public.resume_uploads_user_created_idx    rename to tir_resume_uploads_user_created_idx;

-- ════════════════════════════════════════════════════════════════════
-- 3. Rename triggers (live on the renamed tables already, but keep
--    the trigger names in sync for clarity)
-- ════════════════════════════════════════════════════════════════════
alter trigger trg_applications_updated_at      on public.tir_applications
  rename to trg_tir_applications_updated_at;
alter trigger trg_applications_stamp_submitted on public.tir_applications
  rename to trg_tir_applications_stamp_submitted;

-- ════════════════════════════════════════════════════════════════════
-- 4. Rename trigger function (table-specific; SIP gets its own copy)
--    Postgres has no `ALTER FUNCTION IF EXISTS ... RENAME` form, so
--    guard via a DO block.
-- ════════════════════════════════════════════════════════════════════
do $$
begin
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname  = 'tg_applications_stamp_submitted'
  ) then
    alter function public.tg_applications_stamp_submitted()
      rename to tg_tir_applications_stamp_submitted;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════
-- 5. Rename named CHECK constraints
--    (Inline auto-named ones like applications_status_check are left
--     alone — they're cosmetic only and don't appear in code.)
-- ════════════════════════════════════════════════════════════════════
alter table public.tir_applications
  rename constraint applications_milestone_files_cap to tir_applications_milestone_files_cap;

alter table public.tir_applications
  rename constraint applications_problem_defined_check to tir_applications_problem_defined_check;

alter table public.tir_applications
  rename constraint applications_solution_stage_check to tir_applications_solution_stage_check;

alter table public.tir_applications
  rename constraint applications_incubator_assoc_check to tir_applications_incubator_assoc_check;

-- ════════════════════════════════════════════════════════════════════
-- 6. Rename RLS policies on the renamed tables
-- ════════════════════════════════════════════════════════════════════
alter policy "applications: self can select"         on public.tir_applications
  rename to "tir_applications: self can select";
alter policy "applications: self can insert"         on public.tir_applications
  rename to "tir_applications: self can insert";
alter policy "applications: self can update draft"   on public.tir_applications
  rename to "tir_applications: self can update draft";

alter policy "resume_uploads: self can select"       on public.tir_resume_uploads
  rename to "tir_resume_uploads: self can select";
alter policy "resume_uploads: self can insert"       on public.tir_resume_uploads
  rename to "tir_resume_uploads: self can insert";

-- ════════════════════════════════════════════════════════════════════
-- 7. Migrate storage buckets to new names
--    Two Supabase constraints make a clean rename impossible from SQL:
--      a) `protect_delete` trigger on storage.buckets blocks DELETE
--      b) The FK storage.objects.bucket_id → storage.buckets.id is
--         NOT cascading on UPDATE
--    Workaround:
--      1. INSERT new bucket (`tir-*`) with same settings
--      2. UPDATE storage.objects.bucket_id → new bucket
--      3. Leave the old bucket as an empty husk
--    Post-migration cleanup:
--      Delete the 3 empty old buckets via Supabase Storage dashboard
--      → Storage → click "resumes" → ⋯ → Delete bucket. Repeat for
--      "milestone-files" and "evidence-files".
-- ════════════════════════════════════════════════════════════════════

-- ─── tir-resumes ────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tir-resumes',
  'tir-resumes',
  false,
  10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do nothing;

update storage.objects set bucket_id = 'tir-resumes' where bucket_id = 'resumes';

-- ─── tir-milestone-files ────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tir-milestone-files',
  'tir-milestone-files',
  false,
  5242880,
  array[
    'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'image/png',
    'image/jpeg'
  ]
)
on conflict (id) do nothing;

update storage.objects set bucket_id = 'tir-milestone-files' where bucket_id = 'milestone-files';

-- ─── tir-evidence-files ─────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tir-evidence-files',
  'tir-evidence-files',
  false,
  10485760,
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do nothing;

update storage.objects set bucket_id = 'tir-evidence-files' where bucket_id = 'evidence-files';

-- ════════════════════════════════════════════════════════════════════
-- 8. Drop old storage RLS policies (referenced literal old bucket ids)
--    and recreate with the new bucket ids.
-- ════════════════════════════════════════════════════════════════════

-- ─── tir-resumes ────────────────────────────────────────────────────
drop policy if exists "resumes: users upload to own folder" on storage.objects;
drop policy if exists "resumes: users read own files"        on storage.objects;

create policy "tir-resumes: users upload to own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'tir-resumes'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "tir-resumes: users read own files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'tir-resumes'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ─── tir-milestone-files ────────────────────────────────────────────
drop policy if exists "milestone-files: users upload to own folder" on storage.objects;
drop policy if exists "milestone-files: users read own files"        on storage.objects;
drop policy if exists "milestone-files: users delete own files"      on storage.objects;

create policy "tir-milestone-files: users upload to own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'tir-milestone-files'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "tir-milestone-files: users read own files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'tir-milestone-files'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "tir-milestone-files: users delete own files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'tir-milestone-files'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ─── tir-evidence-files ─────────────────────────────────────────────
drop policy if exists "evidence-files: users upload to own folder" on storage.objects;
drop policy if exists "evidence-files: users read own files"        on storage.objects;
drop policy if exists "evidence-files: users delete own files"      on storage.objects;

create policy "tir-evidence-files: users upload to own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'tir-evidence-files'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "tir-evidence-files: users read own files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'tir-evidence-files'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "tir-evidence-files: users delete own files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'tir-evidence-files'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ════════════════════════════════════════════════════════════════════
-- 9. Add profiles.track column
--    NULL is permitted so freshly-signed-up test users can be flipped
--    to "unassigned" for the fresh-signup smoke test scenario. Default
--    is 'tir' so any existing/legacy row + any signup that omits track
--    metadata lands in TIR — preserves current behaviour.
-- ════════════════════════════════════════════════════════════════════
alter table public.profiles
  add column if not exists track text
    default 'tir'
    check (track is null or track in ('tir', 'sip'));

comment on column public.profiles.track is
  'Application track. Set on first signup via auth user_metadata.track. '
  'Locked once set; only an admin (service role) can change it. '
  'NULL = unassigned (used by fresh-signup test users).';

-- Backfill (no-op when ADD COLUMN ... DEFAULT already filled existing
-- rows, but safe and explicit).
update public.profiles set track = 'tir' where track is null;

-- ════════════════════════════════════════════════════════════════════
-- 10. Update handle_new_user() trigger to read track from signup
--     metadata. Frontend signup endpoint passes {"track":"tir"|"sip"}
--     in the auth user_metadata; falling back to 'tir' if absent.
-- ════════════════════════════════════════════════════════════════════
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, track)
  values (
    new.id,
    new.email,
    -- nullif(...,'') turns an empty string into NULL, then COALESCE picks 'tir'
    coalesce(nullif(new.raw_user_meta_data->>'track', ''), 'tir')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ════════════════════════════════════════════════════════════════════
-- 11. Sanity checks — fail loudly if any rename slipped through
-- ════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='tir_applications') then
    raise exception 'tir_applications table missing — table rename failed';
  end if;
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='tir_resume_uploads') then
    raise exception 'tir_resume_uploads table missing — table rename failed';
  end if;
  if exists (select 1 from pg_tables where schemaname='public' and tablename='applications') then
    raise exception 'old applications table still exists — rename did not complete';
  end if;
  if exists (select 1 from pg_tables where schemaname='public' and tablename='resume_uploads') then
    raise exception 'old resume_uploads table still exists — rename did not complete';
  end if;
  if not exists (select 1 from storage.buckets where id='tir-resumes') then
    raise exception 'tir-resumes bucket missing';
  end if;
  if not exists (select 1 from storage.buckets where id='tir-milestone-files') then
    raise exception 'tir-milestone-files bucket missing';
  end if;
  if not exists (select 1 from storage.buckets where id='tir-evidence-files') then
    raise exception 'tir-evidence-files bucket missing';
  end if;
  -- Note: old buckets (resumes / milestone-files / evidence-files) remain
  -- as empty husks because Supabase blocks SQL DELETE on storage.buckets.
  -- They get cleaned up by the dev via Storage UI dashboard after the
  -- migration finishes. Do NOT assert their absence here.

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='profiles' and column_name='track'
  ) then
    raise exception 'profiles.track column missing';
  end if;
end $$;

commit;

-- ════════════════════════════════════════════════════════════════════
-- 12. Final state — paste these into SQL Editor after the migration
--     to visually confirm everything renamed cleanly.
-- ════════════════════════════════════════════════════════════════════
-- select tablename from pg_tables where schemaname='public' and tablename like 'tir_%' order by 1;
-- select id from storage.buckets where id like 'tir-%' order by 1;
-- select track, count(*) from public.profiles group by track order by 1;
