-- 024_admin_platform.sql — Admin Portal schema. Additive, idempotent, wrapped.
-- Apply to STAGING + PROD SQL editors. New tables empty; running code ignores
-- them until the admin code deploys. RLS enabled, no client policies (service-role only).
begin;

-- 1. Status enum: add on_hold + jury_review to both application tables.
do $$
declare t text;
begin
  foreach t in array array['tir_applications','sip_applications'] loop
    execute format('alter table public.%I drop constraint if exists %I', t, t||'_status_check');
    execute format($f$alter table public.%I add constraint %I check (status in (
      'draft','submitted','ai_screening','screening_failed','under_review','evaluated',
      'shortlisted','interview','offered','onboarded','rejected','waitlisted','withdrawn',
      'accepted','on_hold','jury_review'))$f$, t, t||'_status_check');
  end loop;
end $$;

-- 2. batches
create table if not exists public.batches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phase text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.batches enable row level security;

-- 3. application_batches (one batch per app)
create table if not exists public.application_batches (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null,
  application_track text not null check (application_track in ('tir','sip')),
  batch_id uuid not null references public.batches(id) on delete cascade,
  added_at timestamptz not null default now(),
  unique (application_id, application_track)
);
alter table public.application_batches enable row level security;
create index if not exists idx_application_batches_batch on public.application_batches(batch_id);

-- 4. admin_decisions
create table if not exists public.admin_decisions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null,
  application_track text not null check (application_track in ('tir','sip')),
  gate_stage text not null default 'gate1',
  decision text not null check (decision in ('shortlisted','on_hold','rejected','waitlisted')),
  rationale text,
  decided_by uuid,
  decided_at timestamptz not null default now()
);
alter table public.admin_decisions enable row level security;
create index if not exists idx_admin_decisions_app on public.admin_decisions(application_id, application_track, decided_at desc);

-- 5. application_admin_meta (hide/archive; hold is the on_hold status)
create table if not exists public.application_admin_meta (
  application_id uuid not null,
  application_track text not null check (application_track in ('tir','sip')),
  is_hidden boolean not null default false,
  is_archived boolean not null default false,
  hidden_reason text,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (application_id, application_track)
);
alter table public.application_admin_meta enable row level security;

-- 6. reviewer_profiles
create table if not exists public.reviewer_profiles (
  reviewer_user_id uuid primary key,
  expertise_domains text[] not null default '{}',
  weight numeric(3,1) not null default 1.0,
  batch_id uuid,
  updated_at timestamptz not null default now()
);
alter table public.reviewer_profiles enable row level security;

commit;
