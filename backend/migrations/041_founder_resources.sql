-- 041_founder_resources.sql — Founders Resources tabs (Wave 2 of the TIR
-- post-onboarding Founder Portal): procurement store, fundraising & connects,
-- corporate partners, book ARTPARK assets, IT & Facilities support.
--
-- All tables are TIR-scoped, keyed on tir_applications(id). RLS is enabled
-- with NO policies: every access is backend-mediated via the service-role
-- client (which bypasses RLS), and the /founder router enforces that
-- application_id belongs to the current user (same pattern as 037).
--
-- Reference data (product catalog, investors, fundraising toolkit, corporate
-- partners, bookable assets) is NOT stored in the DB — it's served from
-- Python constants in app/services/founder_catalog.py, mirroring the
-- mockup's hardcoded catalogData/investorsData/partnersData/assetsData.
-- These four tables hold only the per-applicant state layered on top of it.

-- 1) Procurement-store cart (per applicant, keyed by catalog product_id).
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
