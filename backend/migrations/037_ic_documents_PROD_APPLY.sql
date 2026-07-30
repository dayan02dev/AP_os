-- ============================================================================
-- PROD APPLY — migration 037_ic_documents
-- Target: prod Supabase  xtmszlpwgbyoumalgbhs   (Studio → SQL Editor)
--
-- Backs the admin "Jury VIP Selected" tab: an uploaded IC / minutes-of-meeting
-- PDF per application plus the digital signature stamped into it.
--
-- Safe to re-run: every statement is guarded (if not exists / on conflict).
-- Run STEP 1, eyeball it, then STEP 2, then STEP 3.
-- ============================================================================


-- ── STEP 1 · PRE-FLIGHT (read-only) ─────────────────────────────────────────
-- Expect: ic_documents_exists = f, bucket_exists = f. The jury_review counts
-- should match the admin tab badges (~11 TIR / 5 VIP).
-- If ic_documents_exists is already t, 037 is applied — skip to STEP 3.
select
  to_regclass('public.ic_documents') is not null                       as ic_documents_exists,
  exists (select 1 from storage.buckets where id = 'ic-documents')      as bucket_exists,
  (select count(*) from public.tir_applications
    where status = 'jury_review')                                       as tir_in_jury_review,
  (select count(*) from public.sip_applications
    where status = 'jury_review')                                       as vip_in_jury_review,
  (select count(*) from public.tir_applications
    where moved_to_track is not null)                                   as tir_moved,
  (select count(*) from public.sip_applications
    where moved_to_track is not null)                                   as vip_moved;

-- Sanity: 036 (the migration this one follows) must already be in place.
-- Expect one row per track with moved_to_track present.
select table_name, column_name
  from information_schema.columns
 where table_schema = 'public'
   and column_name = 'moved_to_track'
 order by table_name;


-- ── STEP 2 · APPLY ──────────────────────────────────────────────────────────
-- Verbatim backend/migrations/037_ic_documents.sql

begin;

create table if not exists public.ic_documents (
  id                  uuid primary key default gen_random_uuid(),
  application_id      uuid not null,
  application_track   text not null check (application_track in ('tir', 'sip')),

  -- The uploaded original (IC / MOM PDF).
  bucket              text not null default 'ic-documents',
  storage_path        text not null,
  file_name           text,
  size_bytes          bigint,
  uploaded_by         uuid references auth.users(id) on delete set null,
  uploaded_at         timestamptz not null default now(),

  -- The signed copy. All null until someone signs.
  signed_storage_path text,
  signed_file_name    text,
  signed_size_bytes   bigint,
  signed_by           uuid references auth.users(id) on delete set null,
  signer_name         text,
  signer_email        text,
  signed_at           timestamptz,

  -- Set when a newer upload replaces this document. History is never deleted:
  -- superseded rows stay for audit, only the current row is served.
  superseded_at       timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Exactly one CURRENT document per application; any number of superseded ones.
create unique index if not exists ic_documents_current_uidx
  on public.ic_documents (application_id, application_track)
  where superseded_at is null;
create index if not exists ic_documents_app_idx
  on public.ic_documents (application_id, application_track);

alter table public.ic_documents enable row level security;
drop policy if exists "ic_documents: deny all" on public.ic_documents;
create policy "ic_documents: deny all" on public.ic_documents
  for all to authenticated, anon using (false) with check (false);

-- Private storage bucket for both artefacts. Service-role only — the backend
-- admin client does every read/write and hands out 120s signed URLs, exactly
-- like the tir-/sip- buckets, so no storage.objects policies are needed.
insert into storage.buckets (id, name, public)
values ('ic-documents', 'ic-documents', false)
on conflict (id) do nothing;

commit;

-- If the storage.buckets insert is the ONLY thing that errored (some projects
-- restrict that table from the SQL editor), the whole transaction rolled back.
-- Create the bucket by hand instead — Storage → New bucket → name
-- `ic-documents`, Public = OFF — then re-run STEP 2; it is idempotent.


-- ── STEP 3 · VERIFY ─────────────────────────────────────────────────────────
-- Expect: table t, rls_enabled t, deny_all_policy 1, both indexes present,
-- bucket present with public = false.
select
  to_regclass('public.ic_documents') is not null                        as table_exists,
  (select relrowsecurity from pg_class
    where oid = 'public.ic_documents'::regclass)                        as rls_enabled,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'ic_documents')         as policy_count,
  (select count(*) from pg_indexes
    where schemaname = 'public' and tablename = 'ic_documents'
      and indexname in ('ic_documents_current_uidx', 'ic_documents_app_idx'))
                                                                        as named_indexes,
  (select public from storage.buckets where id = 'ic-documents')        as bucket_public,
  (select count(*) from public.ic_documents)                            as rows_now;

-- Column shape, for the record.
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public' and table_name = 'ic_documents'
 order by ordinal_position;

-- OPTIONAL probe — skip it if you'd rather not write to prod at all. It proves
-- the partial unique index really guards "one current doc per app", using a
-- throwaway random application_id, and always rolls itself back (the table is
-- brand new and empty, so there is nothing else it could touch).
do $$
declare fake_app uuid := gen_random_uuid();
begin
  insert into public.ic_documents (application_id, application_track, storage_path)
  values (fake_app, 'sip', 'probe/a.pdf');
  begin
    insert into public.ic_documents (application_id, application_track, storage_path)
    values (fake_app, 'sip', 'probe/b.pdf');
    raise exception 'FAIL: a second CURRENT document was allowed';
  exception when unique_violation then
    raise notice 'OK: partial unique index blocks a second current document';
  end;
  -- Superseding the first must then allow a new current one.
  update public.ic_documents set superseded_at = now()
   where application_id = fake_app and storage_path = 'probe/a.pdf';
  insert into public.ic_documents (application_id, application_track, storage_path)
  values (fake_app, 'sip', 'probe/b.pdf');
  raise notice 'OK: a superseded row lets a new current document in';
  raise exception 'rollback probe';   -- leaves the table clean
exception when others then
  if sqlerrm <> 'rollback probe' then raise; end if;
  raise notice 'probe rolled back — ic_documents left empty';
end $$;

-- Final: must be 0 rows.
select count(*) as rows_after_probe from public.ic_documents;
