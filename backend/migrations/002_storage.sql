-- ARTPARK EIR — Storage bucket + policies (Phase 1).
--
-- Creates a private 'resumes' bucket for CV uploads.
-- Convention: every object path is prefixed with the user's auth UUID
-- (e.g. "<uid>/resume-2026-05-01.pdf"), which the RLS policies enforce.
--
-- Max file size: 10 MiB.
-- Allowed MIME types: PDF, DOC, DOCX.

begin;

-- ─────────────────────────────────────────────────────────────
-- 1. Create the bucket (idempotent).
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'resumes',
  'resumes',
  false,                                      -- private bucket
  10485760,                                   -- 10 MiB (10 * 1024 * 1024)
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
   set public             = excluded.public,
       file_size_limit    = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

-- ─────────────────────────────────────────────────────────────
-- 2. RLS policies on storage.objects scoped to the 'resumes' bucket.
--    The path must start with the authenticated user's UUID.
--    storage.foldername(name) returns a text[] of path segments.
-- ─────────────────────────────────────────────────────────────

-- INSERT: users can upload only inside their own <uid>/ folder.
drop policy if exists "resumes: users upload to own folder" on storage.objects;
create policy "resumes: users upload to own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'resumes'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- SELECT: users can read only their own files.
drop policy if exists "resumes: users read own files" on storage.objects;
create policy "resumes: users read own files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'resumes'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- UPDATE/DELETE from the client is intentionally blocked (no policies).
-- The backend (service role) handles lifecycle tasks like purging orphaned
-- uploads or replacing files when the user re-uploads a CV.

commit;
