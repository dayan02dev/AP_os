-- 007_sip_waitlist.sql — SIP (Startup Incubation Program) waitlist intake.
--
-- The marketing page at /tir + the programs landing carry a "Notify me"
-- form that collects four fields when SIP applications open: name, work
-- email, startup name, current stage. This migration creates the table
-- the public POST /sip/waitlist endpoint writes into so we can fan out
-- launch emails on 22 May 2026 and surface signups on the admin dashboard.
--
-- Idempotent.

begin;

create table if not exists public.sip_waitlist (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  email           text not null,
  startup_name    text not null,
  current_stage   text not null,
  source          text default 'programs_page',
  ip_addr         inet,
  user_agent      text,
  created_at      timestamptz not null default now()
);

-- One signup per email. Case-insensitive — duplicate signups should be
-- treated as idempotent updates (the application layer can decide).
create unique index if not exists sip_waitlist_email_uidx
  on public.sip_waitlist (lower(email));

-- Index on created_at for the admin dashboard listing.
create index if not exists sip_waitlist_created_at_idx
  on public.sip_waitlist (created_at desc);

-- The admin dashboard reads this table via the service role; no RLS for
-- now. Anonymous inserts go through the FastAPI router which uses the
-- service-role client, so RLS isn't on the data path.
alter table public.sip_waitlist enable row level security;

drop policy if exists "sip_waitlist: deny all" on public.sip_waitlist;
create policy "sip_waitlist: deny all"
  on public.sip_waitlist for all
  to authenticated, anon
  using (false)
  with check (false);

commit;
