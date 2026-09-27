-- ============================================================================
-- PROD APPLY — migration 046_ic_documents_multi
-- Target: prod Supabase  xtmszlpwgbyoumalgbhs   (Studio → SQL Editor)
--
-- Lets one application hold several current IC memo documents (admin
-- Accepted tab → Memo Upload / Replace Memo now take multiple PDFs).
--
-- Safe to re-run: every statement is guarded (if exists / if not exists).
-- Run STEP 1, eyeball it, then STEP 2, then STEP 3.
-- Apply this BEFORE the backend (SAM) deploy of the multi-memo change.
-- ============================================================================


-- ── STEP 1 · PRE-FLIGHT (read-only) ─────────────────────────────────────────
-- Expect: ic_documents_exists = t, unique_index_exists = t (037 in place).
-- If unique_index_exists is already f, 046 is applied — skip to STEP 3.
select
  to_regclass('public.ic_documents') is not null                    as ic_documents_exists,
  to_regclass('public.ic_documents_current_uidx') is not null       as unique_index_exists,
  (select count(*) from public.ic_documents where superseded_at is null) as current_docs;


-- ── STEP 2 · APPLY ──────────────────────────────────────────────────────────
-- Verbatim backend/migrations/046_ic_documents_multi.sql

begin;

drop index if exists public.ic_documents_current_uidx;

create index if not exists ic_documents_current_idx
  on public.ic_documents (application_id, application_track)
  where superseded_at is null;

commit;


-- ── STEP 3 · VERIFY ─────────────────────────────────────────────────────────
-- Expect: unique_index_exists = f, current_idx_exists = t.
select
  to_regclass('public.ic_documents_current_uidx') is not null       as unique_index_exists,
  to_regclass('public.ic_documents_current_idx') is not null        as current_idx_exists;
