-- 039_founder_journey.sql — TIR Approach 6-step wizard: derisking
-- experiments, workplan tasks, and mentor review (residency dashboard reads
-- these too). STAGING ONLY for now — RLS enabled, no policies; access is
-- backend-mediated via the /founder router + service-role client (which
-- bypasses RLS), and the router enforces application_id ↔ user_id ownership.
-- Same pattern as 037/038.

-- 1) Derisking experiments (technical + commercial assumption stacks).
create table if not exists public.founder_experiments (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references public.tir_applications(id) on delete cascade,
  track           text not null check (track in ('technical','commercial')),
  gate            int not null default 1 check (gate in (1,2,3)),
  risk            text not null default 'medium' check (risk in ('high','medium','low')),
  status          text not null default 'not-started'
                    check (status in ('not-started','running','validated','invalidated')),
  test_type       text not null default 'literature',
  start_week      int not null default 1 check (start_week between 1 and 24),
  weeks           int not null default 4 check (weeks between 1 and 24),
  assumption      text,
  hypothesis      text,
  test            text,
  pass_criteria   text,
  kill_criteria   text,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.founder_experiments enable row level security;
create index if not exists idx_founder_experiments_app on public.founder_experiments(application_id);

-- 2) Workplan activities — derisking tasks, optionally linked to an
-- experiment (set null on delete so removing an experiment doesn't destroy
-- the task, just orphans the link — matches the mockup's independent lists).
create table if not exists public.founder_tasks (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references public.tir_applications(id) on delete cascade,
  task            text,
  exp_id          uuid references public.founder_experiments(id) on delete set null,
  owner           text,
  effort          int not null default 1 check (effort between 1 and 12),
  status          text not null default 'todo' check (status in ('todo','doing','done')),
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.founder_tasks enable row level security;
create index if not exists idx_founder_tasks_app on public.founder_tasks(application_id);

-- 3) Mentor review of the plan (one per application) — draft → pending →
-- approved. "Advance" is simulated server-side (mimics the mockup's ~2.6s
-- auto-approval timer) with a fixed primary mentor + review quote.
create table if not exists public.founder_review (
  application_id  uuid primary key references public.tir_applications(id) on delete cascade,
  status          text not null default 'draft' check (status in ('draft','pending','approved')),
  approved_by     text,
  approved_on     text,
  mentor_comment  text,
  updated_at      timestamptz not null default now()
);
alter table public.founder_review enable row level security;

-- Widen team employment_type to the 4 values the design uses (Full-time /
-- Part-time / Contract / Advisor); keep 'intern' for back-compat with any
-- existing 037-era rows. Additive.
alter table public.founder_team_members
  drop constraint if exists founder_team_members_employment_type_check;
alter table public.founder_team_members
  add constraint founder_team_members_employment_type_check
  check (employment_type in ('full-time','part-time','contract','advisor','intern'));
