-- 006_evidence_files_storage.sql — Evidence file uploads.
--
-- Section 5 (Evidence) lets applicants attach publications, patents, and
-- prototype photos. Originally the frontend FilesInput component only
-- captured {name, size, type} metadata in the JSONB column; the actual
-- file blobs were never persisted to storage. This migration paves the
-- way for the matching backend endpoint by:
--
--   1. Tightening the evidence_files JSONB to a soft per-row cap (5).
--   2. Creating a private 'evidence-files' storage bucket keyed by
--      <auth_uid>/evidence/<file-uuid>.<ext>.
--   3. Mirroring the milestone-files RLS policies on storage.objects.
--
-- Path convention inside the bucket:
--     <auth_uid>/evidence/<file-uuid>.<ext>
--
-- Max file size: 10 MiB (evidence is heavier than milestone supporting
-- docs — papers + screenshots can run large).
-- Allowed MIME types: PDF, PNG, JPG, DOC, DOCX (per the wizard accept= attr).
-- Cap of 5 files per application enforced at DB level (CHECK below) and
-- at the application layer (routers/evidence_files.py).
--
-- Idempotent.

begin;

-- ─────────────────────────────────────────────────────────────
-- 1. Soft cap on the existing evidence_files JSONB array.
--    Each entry: { file_uuid, path, name, size, mime, uploaded_at }
-- ─────────────────────────────────────────────────────────────
alter table public.applications
  drop constraint if exists applications_evidence_files_cap;
alter table public.applications
  add constraint applications_evidence_files_cap
  check (
    evidence_files is null
    or jsonb_typeof(evidence_files) = 'array'
    and jsonb_array_length(evidence_files) <= 5
  );

-- ─────────────────────────────────────────────────────────────
-- 2. Create the private 'evidence-files' bucket.
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'evidence-files',
  'evidence-files',
  false,                                      -- private; admin signs URLs as needed
  10485760,                                   -- 10 MiB (10 * 1024 * 1024)
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
   set public             = excluded.public,
       file_size_limit    = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

-- ─────────────────────────────────────────────────────────────
-- 3. RLS policies on storage.objects scoped to 'evidence-files'.
--    Mirror milestone-files / resumes — auth.uid()::text must
--    match the first folder segment of the path.
-- ─────────────────────────────────────────────────────────────

drop policy if exists "evidence-files: users upload to own folder" on storage.objects;
create policy "evidence-files: users upload to own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'evidence-files'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "evidence-files: users read own files" on storage.objects;
create policy "evidence-files: users read own files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'evidence-files'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "evidence-files: users delete own files" on storage.objects;
create policy "evidence-files: users delete own files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'evidence-files'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

commit;
