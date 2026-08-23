-- DEMO_STAGING_APPLY.sql
--
-- Brings the STAGING Supabase project up to the release line's schema.
--
-- WHY THIS FILE EXISTS
--   Staging's migration history has a gap: 040-045 were applied (founder
--   portal + VIP) but 029, 030, 034, 037, 038 and 039 never were. The current
--   backend references all six, so endpoints touching them return 500 until
--   this runs. `ic_documents` (037) is the sharpest: the admin Accepted tab
--   calls /admin/platform/ic-documents on mount, so that whole tab fails to
--   load without it.
--
-- HOW TO RUN
--   Supabase Studio -> the STAGING project -> SQL Editor -> paste this whole
--   file -> Run. Staging has no DB password, no exec_sql RPC and no CLI
--   access, so Studio is the only route.
--
-- SAFETY
--   Every statement is `if not exists` guarded, so a partially-applied state
--   heals instead of erroring, and re-running is a no-op.
--   Run this against STAGING only. Check the project name in the Studio header
--   before pressing Run.
--
-- VERIFY AFTERWARDS
--   The final SELECT prints one row per table with a present/MISSING marker.
--   All six must read `present`.


-- ==========================================================================
-- 029 — mentor invites + responses
-- source: backend/migrations/029_mentor_onboarding.sql
-- ==========================================================================

-- 029_mentor_onboarding.sql — mentor invites + responses
create table if not exists public.mentor_invites (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null,
  token       text not null,
  invited_by  text,
  status      text not null default 'invited',
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);
create unique index if not exists mentor_invites_token_uidx on public.mentor_invites (token);
create unique index if not exists mentor_invites_email_uidx on public.mentor_invites (lower(email));
alter table public.mentor_invites enable row level security;
drop policy if exists "mentor_invites: deny all" on public.mentor_invites;
create policy "mentor_invites: deny all" on public.mentor_invites for all to authenticated, anon using (false) with check (false);

create table if not exists public.mentor_responses (
  id                  uuid primary key default gen_random_uuid(),
  invite_id           uuid not null references public.mentor_invites(id) on delete cascade,
  willing             boolean not null,
  days_available      text,
  honorarium_opt_in   boolean,
  bank_details        jsonb,
  future_comms_opt_in boolean,
  contact_email       text,
  ip_addr             inet,
  user_agent          text,
  submitted_at        timestamptz not null default now()
);
create unique index if not exists mentor_responses_invite_uidx on public.mentor_responses (invite_id);
alter table public.mentor_responses enable row level security;
drop policy if exists "mentor_responses: deny all" on public.mentor_responses;
create policy "mentor_responses: deny all" on public.mentor_responses for all to authenticated, anon using (false) with check (false);

-- ==========================================================================
-- 030 — profile-completion tokens
-- source: backend/migrations/030_profile_completion_tokens.sql
-- ==========================================================================

-- 030_profile_completion_tokens.sql
-- Single-use, 72h magic-link tokens for the TIR profile-completion request
-- (applicant uploads a missing résumé / LinkedIn via a no-login form).
-- Service-role only (no public RLS grants); all access via the backend.
create table if not exists public.profile_completion_tokens (
  id uuid primary key default gen_random_uuid(),
  application_id uuid,                       -- tir_applications.id; NULL for preview tokens
  application_track text not null default 'tir',
  token text not null unique,                -- secrets.token_urlsafe(32)
  needs_resume boolean not null default true,
  needs_linkedin boolean not null default true,
  is_preview boolean not null default false, -- preview/sample tokens write nothing
  sent_to text,                              -- email the link was sent to (audit)
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists idx_pct_token on public.profile_completion_tokens(token);
create index if not exists idx_pct_application
  on public.profile_completion_tokens(application_id, application_track);

-- ==========================================================================
-- 034 — batch_reviewers (multi-batch allocation)
-- source: backend/migrations/034_multi_batch_allocation.sql
-- ==========================================================================

-- 034_multi_batch_allocation.sql
-- Multi-batch allocation: an application may belong to many batches, and a
-- reviewer may be a member of many batches. `batch_reviewers` is the source of
-- truth for reviewer<->batch membership; `application_batches` is relaxed from
-- one-batch-per-app to many; membership is backfilled from
-- reviewer_profiles.batch_id. Idempotent / re-runnable.
--
-- DEPLOY-ORDER: apply TOGETHER WITH the matching backend code. Applied against
-- pre-feature code it breaks POST /admin/platform/batches/{id}/applications,
-- whose upsert used ON CONFLICT (application_id, application_track) — the very
-- constraint step 2 drops.

begin;

-- 1. reviewer <-> batch membership (many-to-many)
create table if not exists public.batch_reviewers (
  batch_id         uuid not null references public.batches(id) on delete cascade,
  reviewer_user_id uuid not null references auth.users(id) on delete cascade,
  added_by         uuid,
  added_at         timestamptz not null default now(),
  primary key (batch_id, reviewer_user_id)
);
alter table public.batch_reviewers enable row level security;
create index if not exists idx_batch_reviewers_reviewer
  on public.batch_reviewers(reviewer_user_id);

-- 2. relax application_batches: one-batch-per-app -> many-batches-per-app.
--    Drop the old 2-col unique constraint (matched by column set, name-agnostic),
--    then add the 3-col unique so an app can't be in the same batch twice.
do $$
declare c text;
begin
  select con.conname into c
  from   pg_constraint con
  join   pg_class rel on rel.oid = con.conrelid
  join   pg_namespace ns on ns.oid = rel.relnamespace
  where  ns.nspname = 'public'
    and  rel.relname = 'application_batches'
    and  con.contype = 'u'
    and  ( select array_agg(a.attname::text order by a.attname::text)
           from   unnest(con.conkey) as k(attnum)
           join   pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
         ) = array['application_id','application_track']
  limit 1;
  if c is not null then
    execute format('alter table public.application_batches drop constraint %I', c);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_batches_app_track_batch_key'
      and conrelid = 'public.application_batches'::regclass
  ) then
    alter table public.application_batches
      add constraint application_batches_app_track_batch_key
      unique (application_id, application_track, batch_id);
  end if;
end $$;

-- 3. backfill membership from each reviewer's current home batch (non-destructive)
insert into public.batch_reviewers (batch_id, reviewer_user_id)
select rp.batch_id, rp.reviewer_user_id
from   public.reviewer_profiles rp
where  rp.batch_id is not null
on conflict (batch_id, reviewer_user_id) do nothing;

commit;

-- ==========================================================================
-- 037 — ic_documents + private bucket (BLOCKING for the Accepted tab)
-- source: backend/migrations/037_ic_documents_PROD_APPLY.sql
-- ==========================================================================

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

-- ==========================================================================
-- 038 — academic_profiles
-- source: backend/migrations/038_academic_profiles_PROD_APPLY.sql
-- ==========================================================================

-- ============================================================================
-- PROD APPLY — migration 038_academic_profiles
-- Target: prod Supabase  xtmszlpwgbyoumalgbhs   (Studio → SQL Editor)
--
-- Caches the live enrichment of an academic-roster professor's own faculty page
-- (emails / lab / education / interests / publications / awards / links), keyed
-- on profile_url so each page is read once ever.
--
-- Safe to re-run. Run STEP 1, eyeball it, then STEP 2, then STEP 3.
-- Needs migration 037 (ic_documents) applied first — that is the one before it.
-- ============================================================================


-- ── STEP 1 · PRE-FLIGHT (read-only) ─────────────────────────────────────────
-- Expect: academic_profiles_exists = f, ic_documents_exists = t (037 is in).
select
  to_regclass('public.academic_profiles') is not null as academic_profiles_exists,
  to_regclass('public.ic_documents')      is not null as ic_documents_exists;


-- ── STEP 2 · APPLY ──────────────────────────────────────────────────────────
-- Verbatim backend/migrations/038_academic_profiles.sql

begin;

create table if not exists public.academic_profiles (
  id             uuid primary key default gen_random_uuid(),
  profile_url    text not null,
  name           text,

  status         text not null default 'pending'
                 check (status in ('pending', 'running', 'done', 'failed')),
  -- Machine-readable failure reason (url_not_in_roster, page_timeout,
  -- page_unavailable, redirect_blocked, llm_timeout, …) + its message.
  error_code     text,
  error          text,
  http_status    integer,

  -- Normalised extraction: emails, phone, position, lab{name,url}, education[],
  -- research_interests[], publications[{title,venue,year}], awards[],
  -- links[{label,url}], summary. Shape is enforced in
  -- services/academic_enrichment/run.py::normalise before it is written.
  extracted      jsonb,
  model          text,
  content_chars  integer,

  fetched_at     timestamptz,
  enriched_by    uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists academic_profiles_url_uidx
  on public.academic_profiles (profile_url);

alter table public.academic_profiles enable row level security;
drop policy if exists "academic_profiles: deny all" on public.academic_profiles;
create policy "academic_profiles: deny all" on public.academic_profiles
  for all to authenticated, anon using (false) with check (false);

commit;


-- ── STEP 3 · VERIFY ─────────────────────────────────────────────────────────
-- Expect: table t, rls t, policy 1, unique index 1, rows 0.
select
  to_regclass('public.academic_profiles') is not null as table_exists,
  (select relrowsecurity from pg_class
    where oid = 'public.academic_profiles'::regclass)  as rls_enabled,
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'academic_profiles') as policy_count,
  (select count(*) from pg_indexes
    where schemaname = 'public' and tablename = 'academic_profiles'
      and indexname = 'academic_profiles_url_uidx')     as url_unique_index,
  (select count(*) from public.academic_profiles)       as rows_now;

-- The status CHECK must reject anything outside the four known states.
do $$
begin
  begin
    insert into public.academic_profiles (profile_url, status)
    values ('https://probe.invalid/x', 'banana');
    raise exception 'FAIL: the status CHECK did not reject an unknown value';
  exception when check_violation then
    raise notice 'OK: status CHECK rejects unknown values';
  end;
  -- And profile_url must be unique.
  insert into public.academic_profiles (profile_url, status) values ('https://probe.invalid/x', 'done');
  begin
    insert into public.academic_profiles (profile_url, status) values ('https://probe.invalid/x', 'done');
    raise exception 'FAIL: duplicate profile_url was allowed';
  exception when unique_violation then
    raise notice 'OK: profile_url is unique';
  end;
  raise exception 'rollback probe';   -- leaves the table clean
exception when others then
  if sqlerrm <> 'rollback probe' then raise; end if;
  raise notice 'probe rolled back — academic_profiles left empty';
end $$;

select count(*) as rows_after_probe from public.academic_profiles;

-- ==========================================================================
-- 039 — jury_responses
-- source: backend/migrations/039_jury_responses.sql
-- ==========================================================================

-- 039_jury_responses.sql — detailed jury invite response (incl. honorarium bank details).
--
-- The jury invite email now explains the full engagement (evaluate -> mentor 3
-- startups -> monthly honorarium) and the respond form collects what we need to
-- actually onboard and pay a juror. `jury_invites` only carries linkedin_url +
-- expertise_domains, which is not enough, and widening it would mix "who we
-- invited" with "what they told us".
--
-- Mirrors public.mentor_responses (migration 029) deliberately: same shape, same
-- bank_details jsonb, same one-row-per-invite rule. Bank details are DB-only and
-- are NEVER emailed or returned to the browser — see routers/jury_invites.py.
--
-- New table: RLS on + explicit deny-all (service-role only), like migs 029/033/037/038.

begin;

create table if not exists public.jury_responses (
  id                  uuid primary key default gen_random_uuid(),
  invite_id           uuid not null references public.jury_invites(id) on delete cascade,

  accepted            boolean not null,

  -- Professional context (also seeds jury enrichment + domain matching).
  full_name           text,
  affiliation         text,
  designation         text,
  expertise_domains   text[] not null default '{}',
  linkedin_url        text,
  contact_email       text,
  contact_phone       text,

  -- Engagement terms the juror is agreeing to.
  mentoring_opt_in    boolean,
  max_startups        integer,

  -- Honorarium. bank_details is {account_name, account_number, ifsc, bank_name,
  -- pan} — written once here, never read back into any API response.
  honorarium_opt_in   boolean,
  bank_details        jsonb,

  notes               text,
  future_comms_opt_in boolean,

  ip_addr             inet,
  user_agent          text,
  submitted_at        timestamptz not null default now()
);

-- One CURRENT response per invite. The accept endpoint upserts on this, so a
-- retried submit updates in place instead of stacking duplicates.
create unique index if not exists jury_responses_invite_uidx
  on public.jury_responses (invite_id);

alter table public.jury_responses enable row level security;
drop policy if exists "jury_responses: deny all" on public.jury_responses;
create policy "jury_responses: deny all" on public.jury_responses
  for all to authenticated, anon using (false) with check (false);

commit;


-- ==========================================================================
-- VERIFY — every row must read `present`
-- ==========================================================================

select t.name as table_name,
       case when to_regclass('public.' || t.name) is null
            then 'MISSING' else 'present' end as state
from (values
        ('mentor_invites'),
        ('mentor_responses'),
        ('profile_completion_tokens'),
        ('batch_reviewers'),
        ('ic_documents'),
        ('academic_profiles'),
        ('jury_responses')
     ) as t(name)
order by t.name;
