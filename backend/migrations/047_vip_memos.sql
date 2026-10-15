-- 047_vip_memos.sql — automated VIP investment-memo generation (MEMO_SCHEMA v2).
--
-- One row in vip_memos per generated memo VERSION; sections, questions, research
-- sources, consumed inputs, model-call runs and PDF/DOCX exports hang off it.
-- Exactly one version per (application, native track) is `is_current`; the flip
-- is done atomically by vip_memo_make_current(). History is kept.
-- Nothing here touches ai_screening.sections.
--
-- All tables: RLS on + explicit deny-all (service-role only), like mig 037.
-- Private storage bucket `vip-memos` holds <application_id>/<memo_id>.pdf|.docx.

begin;

create table if not exists public.vip_memos (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null,
  native_track    text not null check (native_track in ('tir', 'sip')),
  version         integer not null,
  status          text not null default 'queued'
                    check (status in ('queued', 'running', 'ready', 'failed', 'failed_budget')),
  is_current      boolean not null default false,
  schema_version  integer not null default 2,
  error           text,
  triggered_by    uuid references auth.users(id) on delete set null,
  cost_usd        numeric(10, 4) not null default 0,
  models          jsonb not null default '{}'::jsonb,

  -- header
  name            text,
  headline        text,
  in_short        text,
  plain           jsonb,
  prepared_by     text,
  generated_at    text,

  -- snapshot
  ask_value        text,  ask_note        text,
  instrument_value text,  instrument_note text,
  sector_value     text,  sector_note     text,
  stage_value      text,  stage_note      text,
  location_value   text,  location_note   text,
  team_value       text,  team_note       text,
  ic_date          text,

  -- recommendation: stored, never served to the UI
  rec_verdict     text,
  rec_summary     jsonb,
  rec_conditions  jsonb,

  figures         jsonb,
  know            jsonb,
  "check"         jsonb,
  memo_json       jsonb,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (application_id, native_track, version)
);

create unique index if not exists vip_memos_current_uidx
  on public.vip_memos (application_id, native_track)
  where is_current;
create index if not exists vip_memos_app_idx
  on public.vip_memos (application_id, native_track);

create table if not exists public.vip_memo_sections (
  id          uuid primary key default gen_random_uuid(),
  memo_id     uuid not null references public.vip_memos(id) on delete cascade,
  section_key text not null check (section_key in
                ('what', 'why', 'product', 'tech', 'competitors',
                 'market', 'team', 'milestones', 'funds', 'risks')),
  position    integer not null,
  takeaway    text,
  source_note text,
  body        jsonb not null,
  unique (memo_id, section_key)
);

create table if not exists public.vip_memo_questions (
  id       uuid primary key default gen_random_uuid(),
  memo_id  uuid not null references public.vip_memos(id) on delete cascade,
  position integer not null,
  question text not null
);

create table if not exists public.vip_memo_sources (
  id          uuid primary key default gen_random_uuid(),
  memo_id     uuid not null references public.vip_memos(id) on delete cascade,
  section_key text,
  title       text,
  publisher   text,
  url         text,
  year        text,
  claim       text
);

create table if not exists public.vip_memo_inputs (
  id             uuid primary key default gen_random_uuid(),
  memo_id        uuid not null references public.vip_memos(id) on delete cascade,
  kind           text not null check (kind in ('field', 'file')),
  bucket         text,
  path           text,
  mime           text,
  method         text,
  chars_used     integer,
  truncated      boolean not null default false,
  skipped_reason text
);

create table if not exists public.vip_memo_runs (
  id               uuid primary key default gen_random_uuid(),
  memo_id          uuid not null references public.vip_memos(id) on delete cascade,
  step             text not null,
  model            text,
  input_tokens     integer not null default 0,
  output_tokens    integer not null default 0,
  reasoning_tokens integer not null default 0,
  web_searches     integer not null default 0,
  cost_usd         numeric(10, 4) not null default 0,
  duration_ms      integer,
  ok               boolean not null default true,
  error            text,
  created_at       timestamptz not null default now()
);

create table if not exists public.vip_memo_exports (
  id         uuid primary key default gen_random_uuid(),
  memo_id    uuid not null references public.vip_memos(id) on delete cascade,
  format     text not null check (format in ('pdf', 'docx')),
  bucket     text not null,
  path       text not null,
  bytes      bigint,
  sha256     text,
  created_at timestamptz not null default now()
);

create index if not exists vip_memo_sections_memo_idx  on public.vip_memo_sections (memo_id);
create index if not exists vip_memo_questions_memo_idx on public.vip_memo_questions (memo_id);
create index if not exists vip_memo_sources_memo_idx   on public.vip_memo_sources (memo_id);
create index if not exists vip_memo_inputs_memo_idx    on public.vip_memo_inputs (memo_id);
create index if not exists vip_memo_runs_memo_idx      on public.vip_memo_runs (memo_id);
create index if not exists vip_memo_exports_memo_idx   on public.vip_memo_exports (memo_id);

-- Atomically make one memo the current version for its (application, track).
create or replace function public.vip_memo_make_current(p_memo_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app   uuid;
  v_track text;
begin
  select application_id, native_track into v_app, v_track
    from public.vip_memos where id = p_memo_id;
  if not found then
    raise exception 'vip_memo_make_current: memo % not found', p_memo_id;
  end if;

  update public.vip_memos
     set is_current = false, updated_at = now()
   where application_id = v_app and native_track = v_track
     and is_current and id <> p_memo_id;

  update public.vip_memos
     set is_current = true, updated_at = now()
   where id = p_memo_id;
end;
$$;
revoke all on function public.vip_memo_make_current(uuid) from public, anon, authenticated;

-- RLS: deny-all on every table (service-role backend only).
alter table public.vip_memos          enable row level security;
alter table public.vip_memo_sections  enable row level security;
alter table public.vip_memo_questions enable row level security;
alter table public.vip_memo_sources   enable row level security;
alter table public.vip_memo_inputs    enable row level security;
alter table public.vip_memo_runs      enable row level security;
alter table public.vip_memo_exports   enable row level security;

drop policy if exists "vip_memos: deny all" on public.vip_memos;
create policy "vip_memos: deny all" on public.vip_memos
  for all to authenticated, anon using (false) with check (false);
drop policy if exists "vip_memo_sections: deny all" on public.vip_memo_sections;
create policy "vip_memo_sections: deny all" on public.vip_memo_sections
  for all to authenticated, anon using (false) with check (false);
drop policy if exists "vip_memo_questions: deny all" on public.vip_memo_questions;
create policy "vip_memo_questions: deny all" on public.vip_memo_questions
  for all to authenticated, anon using (false) with check (false);
drop policy if exists "vip_memo_sources: deny all" on public.vip_memo_sources;
create policy "vip_memo_sources: deny all" on public.vip_memo_sources
  for all to authenticated, anon using (false) with check (false);
drop policy if exists "vip_memo_inputs: deny all" on public.vip_memo_inputs;
create policy "vip_memo_inputs: deny all" on public.vip_memo_inputs
  for all to authenticated, anon using (false) with check (false);
drop policy if exists "vip_memo_runs: deny all" on public.vip_memo_runs;
create policy "vip_memo_runs: deny all" on public.vip_memo_runs
  for all to authenticated, anon using (false) with check (false);
drop policy if exists "vip_memo_exports: deny all" on public.vip_memo_exports;
create policy "vip_memo_exports: deny all" on public.vip_memo_exports
  for all to authenticated, anon using (false) with check (false);

-- Private bucket for the PDF / DOCX exports (service-role only, signed URLs).
insert into storage.buckets (id, name, public)
values ('vip-memos', 'vip-memos', false)
on conflict (id) do nothing;

commit;
