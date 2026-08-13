-- 040_founder_portal.sql — TIR post-onboarding Founder Portal (Wave 1).
-- All tables are TIR-scoped, keyed on tir_applications(id).
-- Applied to PRODUCTION 2026-08-13 alongside 041/042. Portal reach is limited
-- by two independent gates: an offered/onboarded status check and the
-- FOUNDER_PORTAL_ALLOWLIST env allow-list (see routers/founder.py).
-- RLS is enabled with NO policies: every access is backend-mediated via the
-- service-role client (which bypasses RLS), and the /founder router enforces
-- that application_id belongs to the current user.

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
