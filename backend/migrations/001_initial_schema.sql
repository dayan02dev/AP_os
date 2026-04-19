-- ARTPARK EIR — initial schema (Phase 1).
--
-- Tables: profiles, applications, resume_uploads, support_tickets, audit_logs
-- Plus: updated_at triggers, profile auto-provision on auth signup, full RLS.
--
-- Every form field from frontend/src/questions.jsx maps to a typed column on
-- `applications`. JSONB is used only for genuinely open-ended lists
-- (teammates, file attachments).
--
-- Runs cleanly on a fresh Supabase project. Safe to re-run: uses IF NOT EXISTS
-- for tables/indexes, CREATE OR REPLACE for functions, DROP IF EXISTS before
-- triggers/policies.

begin;

-- ─────────────────────────────────────────────────────────────
-- Extensions
-- ─────────────────────────────────────────────────────────────
create extension if not exists pgcrypto;        -- gen_random_uuid()

-- ─────────────────────────────────────────────────────────────
-- Shared trigger helpers
-- ─────────────────────────────────────────────────────────────
create or replace function public.tg_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- 1. profiles (one row per auth user)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  email             text not null unique,
  full_name         text,
  phone             text,
  linkedin_url      text,
  location_city     text,
  location_country  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.tg_touch_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 2. applications (one draft per user)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.applications (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null unique references public.profiles(id) on delete cascade,
  status                  text not null default 'draft'
                           check (status in ('draft','submitted','under_review','shortlisted','rejected','accepted','withdrawn')),
  current_section         text,
  completion_pct          smallint not null default 0 check (completion_pct between 0 and 100),
  submitted_at            timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  -- ── Section 02 · Basic Information ─────────────────────────
  basic_has_team          text
                           check (basic_has_team in ('Yes — I have co-founders','No — going solo for now')),
  basic_teammates         jsonb not null default '[]'::jsonb,
  basic_full_name         text,
  basic_phone             text,
  basic_email             text,
  basic_org               text,
  basic_degree            text
                           check (basic_degree in
                             ('Bachelor''s Degree','Master''s Degree','PhD','Self-taught / Other')),
  basic_incubators        text,
  basic_hear_about        text
                           check (basic_hear_about in
                             ('Referral from friend/colleague',
                              'IISc faculty or staff',
                              'Social media (LinkedIn, Twitter, etc.)',
                              'Event or conference',
                              'Search engine',
                              'Partner organization',
                              'News article or press',
                              'Other')),

  -- ── Section 03 · Problem & Importance ──────────────────────
  problem_defined         text
                           check (problem_defined in
                             ('Yes, clearly defined',
                              'Partially defined',
                              'Still exploring the problem space')),
  problem_describe        text,
  problem_importance      text,

  -- ── Section 04 · Your Solution ─────────────────────────────
  solution_stage          text
                           check (solution_stage in
                             ('Still exploring problem area',
                              'Literature / research stage',
                              'Simulations completed',
                              'Lab demos / proof-of-concept',
                              'Prototype built',
                              'Pilot-ready product',
                              'Deployed in real setting with real users')),
  solution_describe       text,
  solution_core_tech      text,
  solution_ten_x          text,
  solution_hurdles        text,
  solution_moat           text,
  solution_national_scale text,
  solution_customers      text,

  -- ── Section 05 · Execution Plan ────────────────────────────
  execution_will_break    text,
  execution_milestone     text,
  execution_budget        text,
  execution_failure       text,

  -- ── Section 06 · Evidence ──────────────────────────────────
  -- Lists of {storage_path, name, size, mime_type}.
  -- evidence_deck is a single-file object; evidence_files is an array.
  evidence_files          jsonb not null default '[]'::jsonb,
  evidence_video_url      text,
  evidence_deck           jsonb,

  -- ── Section 07 · Declaration (exploded to typed BOOLEANs) ──
  declaration_truthful    boolean not null default false,
  declaration_ref_checks  boolean not null default false,
  declaration_terms       boolean not null default false,
  declaration_newsletter  boolean not null default false
);

drop trigger if exists trg_applications_updated_at on public.applications;
create trigger trg_applications_updated_at
  before update on public.applications
  for each row execute function public.tg_touch_updated_at();

-- Stamp submitted_at exactly once, the first time status transitions to 'submitted'.
create or replace function public.tg_applications_stamp_submitted()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'submitted' and (old.status is null or old.status <> 'submitted') then
    new.submitted_at := coalesce(new.submitted_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_applications_stamp_submitted on public.applications;
create trigger trg_applications_stamp_submitted
  before update on public.applications
  for each row execute function public.tg_applications_stamp_submitted();

-- ─────────────────────────────────────────────────────────────
-- 3. resume_uploads
-- ─────────────────────────────────────────────────────────────
create table if not exists public.resume_uploads (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete cascade,
  storage_path       text not null,                 -- path inside Storage bucket 'resumes'
  original_filename  text not null,
  file_size_bytes    integer not null check (file_size_bytes > 0),
  mime_type          text not null,
  parse_status       text not null default 'pending'
                      check (parse_status in ('pending','processing','completed','failed')),
  parsed_data        jsonb,
  parse_error        text,
  parsed_at          timestamptz,
  created_at         timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- 4. support_tickets
-- ─────────────────────────────────────────────────────────────
create table if not exists public.support_tickets (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid references public.profiles(id) on delete set null,
  email                  text not null,
  subject                text not null,
  body                   text not null,
  category               text check (category in ('technical','application','general','other')),
  status                 text not null default 'open'
                           check (status in ('open','in_progress','resolved','closed')),
  email_delivery_status  text,
  created_at             timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- 5. audit_logs (service-role only; no client access)
-- ─────────────────────────────────────────────────────────────
create table if not exists public.audit_logs (
  id          bigserial primary key,
  user_id     uuid references public.profiles(id) on delete set null,
  action      text not null,
  metadata    jsonb,
  ip_address  inet,
  user_agent  text,
  created_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Indexes
-- ─────────────────────────────────────────────────────────────
create index if not exists applications_status_idx
  on public.applications(status)
  where status <> 'draft';

create index if not exists applications_submitted_at_idx
  on public.applications(submitted_at desc)
  where submitted_at is not null;

create index if not exists applications_user_id_idx
  on public.applications(user_id);

create index if not exists resume_uploads_user_created_idx
  on public.resume_uploads(user_id, created_at desc);

create index if not exists support_tickets_status_created_idx
  on public.support_tickets(status, created_at desc);

create index if not exists audit_logs_user_created_idx
  on public.audit_logs(user_id, created_at desc);

create index if not exists audit_logs_action_created_idx
  on public.audit_logs(action, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- Auto-provision a profiles row on every new auth.users insert.
-- SECURITY DEFINER so the trigger can write to public.profiles while
-- running under the context of auth.users' writer (GoTrue).
-- ─────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────
-- Row-Level Security
-- ─────────────────────────────────────────────────────────────
alter table public.profiles         enable row level security;
alter table public.applications     enable row level security;
alter table public.resume_uploads   enable row level security;
alter table public.support_tickets  enable row level security;
alter table public.audit_logs       enable row level security;

-- ── profiles ─────────────────────────────────────────────────
drop policy if exists "profiles: self can select" on public.profiles;
create policy "profiles: self can select"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles: self can update" on public.profiles;
create policy "profiles: self can update"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ── applications ─────────────────────────────────────────────
drop policy if exists "applications: self can select" on public.applications;
create policy "applications: self can select"
  on public.applications for select
  using (auth.uid() = user_id);

drop policy if exists "applications: self can insert" on public.applications;
create policy "applications: self can insert"
  on public.applications for insert
  with check (auth.uid() = user_id);

-- Updates allowed only while the row is still a draft.
-- Status transitions out of draft are done by the backend (service role bypasses RLS).
drop policy if exists "applications: self can update draft" on public.applications;
create policy "applications: self can update draft"
  on public.applications for update
  using (auth.uid() = user_id and status = 'draft')
  with check (auth.uid() = user_id and status = 'draft');

-- ── resume_uploads (insert + select only, no client mutation) ─
drop policy if exists "resume_uploads: self can select" on public.resume_uploads;
create policy "resume_uploads: self can select"
  on public.resume_uploads for select
  using (auth.uid() = user_id);

drop policy if exists "resume_uploads: self can insert" on public.resume_uploads;
create policy "resume_uploads: self can insert"
  on public.resume_uploads for insert
  with check (auth.uid() = user_id);

-- ── support_tickets ──────────────────────────────────────────
-- Anyone (including anon) can open a ticket. The row's user_id must be either
-- null (anon) or match the caller. Email/subject/body must be present.
drop policy if exists "support_tickets: anyone can insert" on public.support_tickets;
create policy "support_tickets: anyone can insert"
  on public.support_tickets for insert
  with check (
    (user_id is null or user_id = auth.uid())
    and char_length(email) > 0
    and char_length(subject) > 0
    and char_length(body) > 0
  );

-- Authed users can read their own tickets only.
drop policy if exists "support_tickets: self can select" on public.support_tickets;
create policy "support_tickets: self can select"
  on public.support_tickets for select
  using (auth.uid() is not null and user_id = auth.uid());

-- ── audit_logs: no policies → no client access (service role bypasses RLS) ─
-- Intentionally left with zero policies.

commit;
