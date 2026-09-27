-- 046_ic_documents_multi.sql — several current IC documents per application.
--
-- The admin Accepted tab now lets an admin attach MORE THAN ONE memo document
-- (IC minutes, annexures, …) to an application. 037 enforced exactly one
-- current row per application via a partial unique index; this drops it.
-- History semantics are unchanged: replacing/removing a document still sets
-- `superseded_at` and never deletes the row.
--
-- Numbered 046 because 043-045 are taken by the VIP onboarding branch.
-- Safe in any deploy order: the pre-046 backend always supersedes before it
-- inserts, so it never creates a second current row on its own. It MUST be
-- applied before the backend's `mode=append` upload is used, or the insert
-- fails on the unique index (record_failed 502).

begin;

drop index if exists public.ic_documents_current_uidx;

-- Non-unique replacement for the current-docs lookup.
create index if not exists ic_documents_current_idx
  on public.ic_documents (application_id, application_track)
  where superseded_at is null;

commit;
