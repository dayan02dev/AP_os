-- 044_vip_air.sql — ARTPARK Innovation Readiness (AIR) assessment, VIP only.
--
-- Unlike the five shared tables in 043, these are VIP-only, so they keep real
-- foreign keys to sip_applications(id). No `track` column: there is nothing to
-- disambiguate.
--
-- RLS enabled with NO policies: every access is backend-mediated via the
-- service-role client, and the /founder/air router enforces that the
-- application belongs to the caller — same pattern as 040-043.

begin;

-- 1) One assessment round per venture per quarter.
create table if not exists public.vip_air_assessments (
  id                uuid primary key default gen_random_uuid(),
  application_id    uuid not null references public.sip_applications(id) on delete cascade,
  round_label       text not null,
  status            text not null default 'draft'
                      check (status in ('draft','submitted','verified')),
  submitted_at      timestamptz,
  verified_at       timestamptz,
  verified_by       uuid,
  overall_claimed   int check (overall_claimed between 1 and 9),
  overall_verified  int check (overall_verified between 1 and 9),
  tech_claimed      int check (tech_claimed between 1 and 9),
  tech_verified     int check (tech_verified between 1 and 9),
  comm_claimed      int check (comm_claimed between 1 and 9),
  comm_verified     int check (comm_verified between 1 and 9),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (application_id, round_label)
);
alter table public.vip_air_assessments enable row level security;
create index if not exists idx_vip_air_assessments_app
  on public.vip_air_assessments(application_id);

-- 2) Six lever scores per round — claimed by the founder, verified by ARTPARK.
create table if not exists public.vip_air_lever_scores (
  id                uuid primary key default gen_random_uuid(),
  assessment_id     uuid not null references public.vip_air_assessments(id) on delete cascade,
  lever             text not null check (lever in (
                      'scientific_principles','architecture','qualification',
                      'user_needs','supply_chain','reliability')),
  q1_option         text,
  q2_option         text,
  q3_option         text,
  criteria_checked  jsonb not null default '[]'::jsonb,
  claimed_level     int check (claimed_level between 1 and 9),
  verified_level    int check (verified_level between 1 and 9),
  verifier_note     text,
  verified_at       timestamptz,
  verified_by       uuid,
  updated_at        timestamptz not null default now(),
  unique (assessment_id, lever)
);
alter table public.vip_air_lever_scores enable row level security;
create index if not exists idx_vip_air_scores_assessment
  on public.vip_air_lever_scores(assessment_id);

-- 3) Qualifying documents uploaded per lever per claimed level.
create table if not exists public.vip_air_evidence (
  id                uuid primary key default gen_random_uuid(),
  assessment_id     uuid not null references public.vip_air_assessments(id) on delete cascade,
  lever             text not null,
  air_level         int not null check (air_level between 1 and 9),
  doc_label         text not null,
  storage_path      text not null,
  filename          text,
  size_bytes        int,
  content_type      text,
  uploaded_at       timestamptz not null default now()
);
alter table public.vip_air_evidence enable row level security;
create index if not exists idx_vip_air_evidence_assessment
  on public.vip_air_evidence(assessment_id);

-- 4) Private bucket for AIR evidence documents. Service-role only; the
-- backend issues short-lived signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vip-founder-docs','vip-founder-docs', false, 26214400,
        array['application/pdf','image/png','image/jpeg',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;

commit;
