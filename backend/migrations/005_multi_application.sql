-- 005_multi_application.sql — allow multiple applications per user.
--
-- Light version: a user has at most one in-flight DRAFT, and any number
-- of SUBMITTED applications stacking up in history. Submitted rows stay
-- read-only forever (existing trigger + backend 409 already enforce
-- that). Past-applications tab queries the full set.
--
-- Storage: milestone files keep the same <user_id>/milestone/<uuid>.<ext>
-- path. Files are application-scoped via the row's JSONB column — i.e.
-- only the row that references the file metadata "owns" it. Old files
-- belonging to submitted apps stay readable to the user (which is fine —
-- past tab is read-only) but the new draft starts with an empty JSONB.
--
-- Idempotent.

begin;

-- 1. Drop the hard UNIQUE(user_id) so multiple rows per user are allowed.
--    Postgres named this constraint applications_user_id_key when the
--    column was declared 'unique' inline. Drop by name; ignore if absent.
alter table public.applications
  drop constraint if exists applications_user_id_key;

-- 2. Re-introduce the "at most one open draft per user" invariant via a
--    partial unique index. New drafts can only be created when no other
--    draft exists for that user; submitted rows don't count.
drop index if exists applications_one_draft_per_user;
create unique index applications_one_draft_per_user
  on public.applications (user_id)
  where status = 'draft';

-- 3. Helpful index for the "list my submitted apps" query (Past tab).
create index if not exists applications_user_submitted_idx
  on public.applications (user_id, submitted_at desc)
  where status <> 'draft';

commit;
