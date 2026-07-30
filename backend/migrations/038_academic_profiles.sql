-- 038_academic_profiles.sql — cached enrichment of academic-roster profile pages.
--
-- Backs the "From their profile page" card on the admin Academic Jury Roster
-- professor page: an admin opens a professor, we fetch that professor's own
-- faculty page once, LLM-extract emails / lab / education / interests /
-- publications / awards / links, and cache the result here so the page is never
-- fetched twice.
--
-- Keyed on profile_url because that is what the roster actually carries and what
-- the fetch is authorised against (app/data/academic_profile_urls.json). Names
-- are not unique enough across 809 rows and change spelling between sources.
--
-- New table: RLS on + explicit deny-all (service-role only), like migs 033/037.
-- NOTE: 037 is ic_documents. The TIR post-onboarding plan also drafted a "037";
-- if that work resumes it needs 039 now.

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
