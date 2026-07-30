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
