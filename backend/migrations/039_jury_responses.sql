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
