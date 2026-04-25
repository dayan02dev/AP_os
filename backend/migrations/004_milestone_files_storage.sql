-- 004_milestone_files_storage.sql — Bucket 3 file-attach support.
--
-- Adds (a) a JSONB metadata column on applications for the user's
-- milestone supporting docs, and (b) a private storage bucket
-- 'milestone-files' that follows the same <auth_uid>/... prefix
-- convention as the existing 'resumes' bucket.
--
-- Path convention inside the bucket:
--     <auth_uid>/milestone/<file-uuid>.<ext>
--
-- The leading <auth_uid> segment is what RLS checks. The /milestone/
-- subfolder leaves room for future sub-buckets per application without
-- rewriting policies — RLS only inspects the first segment via
-- storage.foldername(name)[1].
--
-- Max file size: 5 MiB (per manager's spec).
-- Allowed MIME types: PDF, XLS, XLSX, CSV, PNG, JPG.
-- Cap of 3 files per application enforced at DB level (CHECK below) AND
-- at the application layer (routers/milestone_files.py).
--
-- Idempotent.

begin;

-- ─────────────────────────────────────────────────────────────
-- 1. JSONB column for per-application metadata.
--    Each entry: { file_uuid, path, name, size, mime, uploaded_at }
-- ─────────────────────────────────────────────────────────────
alter table public.applications
  add column if not exists execution_milestone_files jsonb default '[]'::jsonb;

-- Soft cap: at most 3 files in the array. Enforced at DB level so a
-- compromised client can't sneak more in.
alter table public.applications
  drop constraint if exists applications_milestone_files_cap;
alter table public.applications
  add constraint applications_milestone_files_cap
  check (
    execution_milestone_files is null
    or jsonb_typeof(execution_milestone_files) = 'array'
    and jsonb_array_length(execution_milestone_files) <= 3
  );

-- ─────────────────────────────────────────────────────────────
-- 2. Create the private 'milestone-files' bucket.
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'milestone-files',
  'milestone-files',
  false,                                      -- private; objects served via signed URLs
  5242880,                                    -- 5 MiB (5 * 1024 * 1024)
  array[
    'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'image/png',
    'image/jpeg'
  ]
)
on conflict (id) do update
   set public             = excluded.public,
       file_size_limit    = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

-- ─────────────────────────────────────────────────────────────
-- 3. RLS policies on storage.objects scoped to 'milestone-files'.
--    Mirror the resumes bucket's pattern — auth.uid()::text must
--    match the first folder segment of the path.
-- ─────────────────────────────────────────────────────────────

-- INSERT: users can upload only inside their own <uid>/ folder.
drop policy if exists "milestone-files: users upload to own folder" on storage.objects;
create policy "milestone-files: users upload to own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'milestone-files'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- SELECT: users can read only their own files.
drop policy if exists "milestone-files: users read own files" on storage.objects;
create policy "milestone-files: users read own files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'milestone-files'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- DELETE: users can remove their own files (e.g. swap an attachment
-- before submitting). After application is submitted, the backend's
-- locked-row check prevents the metadata mutation; the underlying
-- bucket object stays as an audit artefact.
drop policy if exists "milestone-files: users delete own files" on storage.objects;
create policy "milestone-files: users delete own files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'milestone-files'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- UPDATE is intentionally not granted — the metadata column is the
-- source of truth for what's attached; reuploading creates a new
-- object and the old one becomes orphaned. Service role can sweep
-- orphans periodically.

commit;
