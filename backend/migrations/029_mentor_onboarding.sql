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
