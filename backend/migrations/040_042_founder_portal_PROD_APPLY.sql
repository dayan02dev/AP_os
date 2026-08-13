-- ============================================================================
-- PROD APPLY — migrations 040 · 041 · 042  (TIR post-onboarding Founder Portal)
-- Target: prod Supabase  xtmszlpwgbyoumalgbhs   (Studio -> SQL Editor)
--
-- Creates the Founder Portal schema: MOU + acknowledgements, organization
-- roster, approach hats, BOM / equipment / procurement, the resources tabs
-- (store, fundraising, partners, bookings, support) and the Approach journey
-- (experiments, tasks, mentor review). Plus one additive column on
-- tir_applications (grant_amount) and the private tir-founder-docs bucket.
--
-- These were numbered 037-039 on the post_onboarding branch, which collided
-- with the ic_documents / academic_profiles / jury_responses migrations
-- already applied to prod. Renumbered to 040-042; content is otherwise the
-- backend/migrations/04*.sql files verbatim.
--
-- Safe to re-run (every statement is if-not-exists / on-conflict guarded).
-- Run STEP 1, eyeball it, then STEP 2A/2B/2C in order, then STEP 3.
-- Needs 039_jury_responses applied first.
--
-- Blast radius: the ONLY change to an existing table is
--   alter table public.tir_applications add column if not exists grant_amount
-- which is additive with a default. No drops, no truncates, no data edits.
-- ============================================================================


-- -- STEP 1 . PRE-FLIGHT (read-only) -----------------------------------------
-- Expect: jury_responses_exists = t (039 is in), and all three founder_*
-- probes = f (nothing applied yet). grant_amount_exists = f.
select
  to_regclass('public.jury_responses')             is not null as jury_responses_exists,
  to_regclass('public.founder_mou')                is not null as founder_mou_exists,
  to_regclass('public.founder_cart_items')         is not null as founder_resources_exists,
  to_regclass('public.founder_experiments')        is not null as founder_journey_exists,
  exists (select 1 from information_schema.columns
           where table_schema='public' and table_name='tir_applications'
             and column_name='grant_amount')                   as grant_amount_exists;


-- -- STEP 2A . APPLY migration 040 -----------------------------------------
-- Verbatim backend/migrations/040_founder_portal.sql

begin;

-- 1) Per-applicant grant amount (₹25,00,000 default).
alter table public.tir_applications
  add column if not exists grant_amount numeric not null default 2500000;

-- 2) MOU signature record (one per application).
create table if not exists public.founder_mou (
  id                    uuid primary key default gen_random_uuid(),
  application_id        uuid not null unique references public.tir_applications(id) on delete cascade,
  signer_name           text not null,
  signed_at             timestamptz not null default now(),
  signature_image_path  text,
  signed_pdf_path       text,
  template_version      text not null default 'tir-mou-v2',
  -- Ids of the residency acknowledgements ticked at signing time (canonical
  -- list: services/founder_mou.ACKNOWLEDGEMENTS). Stored so we can prove what
  -- was accepted even if the wording is later revised; the accepted TEXT is
  -- additionally stamped into the signed PDF.
  acknowledgements      jsonb not null default '[]'::jsonb,
  created_at            timestamptz not null default now()
);
alter table public.founder_mou enable row level security;

-- 3) Organization roster (feeds payroll).
create table if not exists public.founder_team_members (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references public.tir_applications(id) on delete cascade,
  name            text not null,
  title           text,
  employment_type text not null default 'full-time'
                    check (employment_type in ('full-time','contract','intern')),
  monthly_cost    numeric not null default 0 check (monthly_cost >= 0),
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.founder_team_members enable row level security;
create index if not exists idx_founder_team_app on public.founder_team_members(application_id);

-- 4) Approach "hats" (one per application).
create table if not exists public.founder_approach (
  application_id       uuid primary key references public.tir_applications(id) on delete cascade,
  business_member_id   uuid references public.founder_team_members(id) on delete set null,
  technology_member_id uuid references public.founder_team_members(id) on delete set null,
  product_member_id    uuid references public.founder_team_members(id) on delete set null,
  customer_member_id   uuid references public.founder_team_members(id) on delete set null,
  notes                text,
  updated_at           timestamptz not null default now()
);
alter table public.founder_approach enable row level security;

-- 5) Bill of materials.
create table if not exists public.founder_bom_items (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references public.tir_applications(id) on delete cascade,
  item            text not null,
  qty             numeric not null default 0 check (qty >= 0),
  unit_cost       numeric not null default 0 check (unit_cost >= 0),
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
alter table public.founder_bom_items enable row level security;
create index if not exists idx_founder_bom_app on public.founder_bom_items(application_id);

-- 6) Equipment.
create table if not exists public.founder_equipment_items (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references public.tir_applications(id) on delete cascade,
  item            text not null,
  cost            numeric not null default 0 check (cost >= 0),
  sort_order      int not null default 0,
  created_at      timestamptz not null default now()
);
alter table public.founder_equipment_items enable row level security;
create index if not exists idx_founder_equip_app on public.founder_equipment_items(application_id);

-- 7) Procurement tracking.
create table if not exists public.founder_procurement_items (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references public.tir_applications(id) on delete cascade,
  item            text not null,
  category        text not null default 'Other' check (category in ('BOM','Equipment','Other')),
  qty             numeric not null default 1,
  estimate        numeric not null default 0,
  vendor          text,
  quote           numeric not null default 0,
  lead_weeks      int not null default 0,
  status          text not null default 'estimate'
                    check (status in ('estimate','quoted','po','received')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.founder_procurement_items enable row level security;
create index if not exists idx_founder_proc_app on public.founder_procurement_items(application_id);

-- 8) Private storage bucket for MOU signature + signed PDF.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tir-founder-docs','tir-founder-docs', false, 10485760,
        array['image/png','application/pdf'])
on conflict (id) do nothing;
-- No storage.objects policies: service-role only (backend issues signed URLs).

commit;


-- -- STEP 2B . APPLY migration 041 -----------------------------------------
-- Verbatim backend/migrations/041_founder_resources.sql

begin;

create table if not exists public.founder_cart_items (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references public.tir_applications(id) on delete cascade,
  product_id      text not null,
  qty             numeric not null default 1 check (qty >= 1),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (application_id, product_id)
);
alter table public.founder_cart_items enable row level security;
create index if not exists idx_founder_cart_app on public.founder_cart_items(application_id);

-- 2) Generic per-applicant resource requests: quote requests (store),
--    intro requests (fundraising investors), partner connection requests.
create table if not exists public.founder_resource_requests (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references public.tir_applications(id) on delete cascade,
  kind            text not null check (kind in ('quote','intro','partner')),
  ref_id          text not null,
  created_at      timestamptz not null default now(),
  unique (application_id, kind, ref_id)
);
alter table public.founder_resource_requests enable row level security;
create index if not exists idx_founder_reqs_app on public.founder_resource_requests(application_id);

-- 3) ARTPARK asset bookings.
create table if not exists public.founder_bookings (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references public.tir_applications(id) on delete cascade,
  asset_id        text not null,
  asset_name      text not null,
  date            date not null,
  slot            text not null,
  status          text not null default 'pending'
                    check (status in ('pending','confirmed','cancelled')),
  created_at      timestamptz not null default now()
);
alter table public.founder_bookings enable row level security;
create index if not exists idx_founder_bookings_app on public.founder_bookings(application_id);

-- 4) IT & Facilities support tickets.
create table if not exists public.founder_tickets (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references public.tir_applications(id) on delete cascade,
  ref             text not null,
  area            text not null check (area in ('IT','Facilities')),
  priority        text not null check (priority in ('Low','Medium','High','Urgent')),
  subject         text not null,
  description     text,
  status          text not null default 'open'
                    check (status in ('open','in-progress','resolved')),
  created_at      timestamptz not null default now()
);
alter table public.founder_tickets enable row level security;
create index if not exists idx_founder_tickets_app on public.founder_tickets(application_id);

-- 5) Push-to-procurement (store -> founder_procurement_items) maps catalog
--    items with cat='Prototyping' to category='Service' (a service line, not
--    a bill-of-materials line). 037's inline check only allowed
--    BOM/Equipment/Other — widen it additively to admit 'Service'.
alter table public.founder_procurement_items
  drop constraint if exists founder_procurement_items_category_check;
alter table public.founder_procurement_items
  add constraint founder_procurement_items_category_check
  check (category in ('BOM','Equipment','Other','Service'));

commit;


-- -- STEP 2C . APPLY migration 042 -----------------------------------------
-- Verbatim backend/migrations/042_founder_journey.sql

begin;

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

commit;


-- -- STEP 3 . VERIFY ---------------------------------------------------------
-- Expect: tables_created = 13, rls_enabled = 13, grant_amount_exists = t,
-- bucket_exists = t, and every rows_* = 0 (fresh schema, no data yet).
select
  (select count(*) from pg_tables
    where schemaname = 'public' and tablename in (
      'founder_mou','founder_team_members','founder_approach','founder_bom_items',
      'founder_equipment_items','founder_procurement_items','founder_experiments',
      'founder_tasks','founder_review','founder_cart_items',
      'founder_resource_requests','founder_bookings','founder_tickets'
    ))                                                          as tables_created,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relrowsecurity
      and c.relname like 'founder@_%' escape '@')                          as rls_enabled,
  (select count(*) from information_schema.columns where table_schema='public'
     and table_name='tir_applications' and column_name='grant_amount') as grant_amount_cols,
  (select count(*) from storage.buckets where id='tir-founder-docs')   as bucket_rows,
  (select count(*) from public.founder_mou)                     as rows_mou;

-- The MOU acknowledgements column must exist and default to an empty array,
-- and template_version must default to v2 (the acknowledgement-bearing MOU).
select
  (select column_default from information_schema.columns
    where table_schema='public' and table_name='founder_mou'
      and column_name='acknowledgements')      as ack_default,
  (select column_default from information_schema.columns
    where table_schema='public' and table_name='founder_mou'
      and column_name='template_version')      as template_version_default;

-- The bucket must be PRIVATE (public = f) — signed MOUs are served only via
-- short-lived signed URLs issued by the backend.
select id, public as is_public, file_size_limit, allowed_mime_types
  from storage.buckets where id = 'tir-founder-docs';
