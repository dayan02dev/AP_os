-- 045_vip_mis.sql — MIS reporting (monthly update + quarterly review), VIP only.
--
-- Like 044, these are VIP-only, so vip_mis_periods keeps a real foreign key
-- to sip_applications(id). No `track` column: there is nothing to
-- disambiguate.
--
-- One period row per reporting cycle (vip_mis_periods), plus four child
-- tables hanging off it: the §2 key-metrics grid (vip_mis_metrics), the §6
-- numeric financial series (vip_mis_financials), the §8 headcount-by-
-- category grid (vip_mis_headcount), and the repeating-row "entries"
-- sections — milestones, risks, asks, ip_assets, collaborations,
-- publications, products, funding, planned_vs_actual, next_milestones —
-- shared across both templates (vip_mis_entries). Section wording and field
-- schemas live in app/services/mis_catalog.py, not here.
--
-- RLS enabled with NO policies: every access is backend-mediated via the
-- service-role client, same pattern as 040-044.

begin;

-- 1) One row per reporting period per venture.
create table if not exists public.vip_mis_periods (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.sip_applications(id) on delete cascade,
  kind           text not null check (kind in ('monthly','quarterly')),
  period_key     text not null,
  label          text not null,
  period_start   date not null,
  period_end     date not null,
  due_date       date not null,
  status         text not null default 'draft'
                   check (status in ('draft','submitted')),
  submitted_at   timestamptz,
  reopened_at    timestamptz,
  reopened_by    uuid,
  narrative      jsonb not null default '{}'::jsonb,
  source_doc_path text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (application_id, kind, period_key)
);
alter table public.vip_mis_periods enable row level security;
create index if not exists idx_vip_mis_periods_app
  on public.vip_mis_periods(application_id);

-- 2) §2 Key Metrics grid — one row per metric per period.
create table if not exists public.vip_mis_metrics (
  id            uuid primary key default gen_random_uuid(),
  period_id     uuid not null references public.vip_mis_periods(id) on delete cascade,
  metric_key    text not null,
  label         text not null,
  group_key     text not null,
  unit          text,
  target        numeric,
  actual        numeric,
  prev_actual   numeric,
  rag           text check (rag in ('green','amber','red')),
  commentary    text,
  is_custom     boolean not null default false,
  sort_order    int not null default 0,
  unique (period_id, metric_key)
);
alter table public.vip_mis_metrics enable row level security;
create index if not exists idx_vip_mis_metrics_period
  on public.vip_mis_metrics(period_id);

-- 3) §6 numeric financial series (annual revenue, needs) — one row per
-- (series, bucket) per period.
create table if not exists public.vip_mis_financials (
  id          uuid primary key default gen_random_uuid(),
  period_id   uuid not null references public.vip_mis_periods(id) on delete cascade,
  series      text not null,
  bucket      text not null,
  amount      numeric,
  sort_order  int not null default 0,
  unique (period_id, series, bucket)
);
alter table public.vip_mis_financials enable row level security;
create index if not exists idx_vip_mis_financials_period
  on public.vip_mis_financials(period_id);

-- 4) §8 headcount-by-category grid — one row per category per period.
create table if not exists public.vip_mis_headcount (
  id             uuid primary key default gen_random_uuid(),
  period_id      uuid not null references public.vip_mis_periods(id) on delete cascade,
  category       text not null check (category in (
                    'artpark_associated','startup','consultants','interns')),
  current_count  int,
  exited         int,
  remarks        text,
  unique (period_id, category)
);
alter table public.vip_mis_headcount enable row level security;
create index if not exists idx_vip_mis_headcount_period
  on public.vip_mis_headcount(period_id);

-- 5) Repeating-row "entries" sections shared across both templates.
-- Deliberately NO unique constraint here, unlike the three child tables
-- above: this table holds an ordered list (e.g. two milestones can
-- legitimately share the same title in different months, or a founder can
-- carry forward an identical risk row unchanged) rather than one row per
-- key. Do not "fix" this by adding one — see the metrics/financials/
-- headcount tables above for what that pattern looks like when duplicates
-- really are a bug.
create table if not exists public.vip_mis_entries (
  id          uuid primary key default gen_random_uuid(),
  period_id   uuid not null references public.vip_mis_periods(id) on delete cascade,
  section     text not null check (section in (
                'milestones','risks','asks','ip_assets',
                'collaborations','publications','products','funding',
                'planned_vs_actual','next_milestones')),
  sort_order  int not null default 0,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
alter table public.vip_mis_entries enable row level security;
create index if not exists idx_vip_mis_entries_period
  on public.vip_mis_entries(period_id);

commit;
