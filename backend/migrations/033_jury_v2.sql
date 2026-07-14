-- 033_jury_v2.sql — Jury v2: invites, profiles, assignments, selections,
-- recommendations. Jurors PICK apps to mentor (no scoring — no jury_reviews).
-- All new tables: RLS on + explicit deny-all (service-role only), like mig 029.

begin;

-- 1. Allow 'jury' in user_roles role CHECK. Robust: drop ANY check constraint
--    on the table referencing the role column (name/normalised-form agnostic).
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
     where conrelid = 'public.user_roles'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%role%'
  loop
    execute format('alter table public.user_roles drop constraint %I', r.conname);
  end loop;
  alter table public.user_roles add constraint user_roles_role_check
    check (role in ('applicant','founder','reviewer','mentor','leadership','admin','jury'));
end $$;

-- 2. admin_decisions CHECK: keep existing values (incl. jury_review) AND add offered.
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
     where conrelid = 'public.admin_decisions'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%decision%'
  loop
    execute format('alter table public.admin_decisions drop constraint %I', r.conname);
  end loop;
  alter table public.admin_decisions add constraint admin_decisions_decision_check
    check (decision in ('shortlisted','on_hold','rejected','waitlisted','jury_review','offered'));
end $$;

-- 3. jury_invites — invite + accept-form answers on one row.
create table if not exists public.jury_invites (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  email             text not null,
  token             text not null,
  invited_by        uuid references auth.users(id) on delete set null,
  status            text not null default 'invited'
                    check (status in ('invited','accepted','declined')),
  linkedin_url      text,
  expertise_domains text[] not null default '{}',
  sent_at           timestamptz,
  responded_at      timestamptz,
  created_at        timestamptz not null default now()
);
create unique index if not exists jury_invites_token_uidx on public.jury_invites (token);
create unique index if not exists jury_invites_email_uidx on public.jury_invites (lower(email));
alter table public.jury_invites enable row level security;
drop policy if exists "jury_invites: deny all" on public.jury_invites;
create policy "jury_invites: deny all" on public.jury_invites
  for all to authenticated, anon using (false) with check (false);

-- 4. jury_profiles — per-juror profile + enrichment.
create table if not exists public.jury_profiles (
  juror_user_id     uuid primary key,
  invite_id         uuid references public.jury_invites(id) on delete set null,
  expertise_domains text[] not null default '{}',
  linkedin_url      text,
  enrichment        jsonb,
  enrichment_status text not null default 'pending'
                    check (enrichment_status in ('pending','running','done','failed')),
  matched_at        timestamptz,
  weight            numeric(3,1) not null default 1.0,
  updated_at        timestamptz not null default now()
);
alter table public.jury_profiles enable row level security;
drop policy if exists "jury_profiles: deny all" on public.jury_profiles;
create policy "jury_profiles: deny all" on public.jury_profiles
  for all to authenticated, anon using (false) with check (false);

-- 5. jury_assignments — which apps admin gave which juror (ported shape).
create table if not exists public.jury_assignments (
  id                uuid primary key default gen_random_uuid(),
  application_id    uuid not null,
  application_track text not null check (application_track in ('tir','sip')),
  juror_user_id     uuid not null references auth.users(id) on delete cascade,
  assigned_by       uuid references auth.users(id) on delete set null,
  assigned_at       timestamptz not null default now(),
  due_at            timestamptz,
  unique (application_id, application_track, juror_user_id)
);
create index if not exists jury_assignments_juror_idx on public.jury_assignments (juror_user_id);
create index if not exists jury_assignments_app_idx   on public.jury_assignments (application_id, application_track);
alter table public.jury_assignments enable row level security;
drop policy if exists "jury_assignments: deny all" on public.jury_assignments;
create policy "jury_assignments: deny all" on public.jury_assignments
  for all to authenticated, anon using (false) with check (false);

-- 6. jury_selections — a juror's picks (submitted sets only; no drafts).
create table if not exists public.jury_selections (
  id                uuid primary key default gen_random_uuid(),
  application_id    uuid not null,
  application_track text not null check (application_track in ('tir','sip')),
  juror_user_id     uuid not null references auth.users(id) on delete cascade,
  note              text,
  submitted_at      timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (application_id, application_track, juror_user_id)
);
create index if not exists jury_selections_juror_idx on public.jury_selections (juror_user_id);
alter table public.jury_selections enable row level security;
drop policy if exists "jury_selections: deny all" on public.jury_selections;
create policy "jury_selections: deny all" on public.jury_selections
  for all to authenticated, anon using (false) with check (false);

-- 7. jury_recommendations — precomputed app↔juror fit.
create table if not exists public.jury_recommendations (
  id                uuid primary key default gen_random_uuid(),
  juror_user_id     uuid not null references auth.users(id) on delete cascade,
  application_id    uuid not null,
  application_track text not null check (application_track in ('tir','sip')),
  score             numeric(5,1) not null,
  reason            text,
  model             text,
  computed_at       timestamptz not null default now(),
  unique (juror_user_id, application_id, application_track)
);
create index if not exists jury_recos_juror_idx on public.jury_recommendations (juror_user_id);
alter table public.jury_recommendations enable row level security;
drop policy if exists "jury_recommendations: deny all" on public.jury_recommendations;
create policy "jury_recommendations: deny all" on public.jury_recommendations
  for all to authenticated, anon using (false) with check (false);

commit;
