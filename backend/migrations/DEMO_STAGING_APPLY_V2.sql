-- DEMO_STAGING_APPLY_V2.sql   (supersedes the earlier file — run THIS one)
--
-- WHAT CHANGED FROM V1, AND WHY V1 FAILED
--   V1 errored with: 42703 column "moved_to_track" does not exist.
--   Two mistakes in V1, both fixed here:
--     1. It used the *_PROD_APPLY variants of 037/038, which carry extra
--        diagnostic SELECTs. One of those reads `moved_to_track` — a column
--        added by migration 036, which staging did not have. Those diagnostics
--        are verification scaffolding, not schema, so V2 uses the plain
--        migrations instead and the whole failure class disappears.
--     2. V1's gap analysis only looked for missing TABLES. Four migrations add
--        COLUMNS rather than tables and were missed: 025, 028, 031, 036 (plus
--        032 and 035, which depend on migrations V1 itself installed).
--
--   Migrations 029, 030 and 034 DID apply from V1 and are deliberately not
--   repeated here. Re-running them would be harmless but pointless.
--
-- WHAT THIS INSTALLS  (dependency order — do not reorder)
--   025  sip_applications.resume_file_id
--   028  ai_screening.sections            -> the AI 4-section panels
--   031  ai_screening.founder_check       -> the Founder Check panel
--   032  profile_completion_tokens.needs_evidence
--   035  the 'comms' industry category row
--   036  moved_to_track on both tracks    -> the TIR<->VIP overlay badge
--   037  ic_documents + its private bucket -> the admin Accepted tab
--   038  academic_profiles
--   039  jury_responses
--
-- HOW TO RUN
--   Supabase Studio -> the STAGING project -> SQL Editor -> paste -> Run.
--   Confirm the project is exqmxvdtcsvpgtftwjml (staging), NOT
--   xtmszlpwgbyoumalgbhs (production), before pressing Run.
--
-- SAFETY
--   Every statement is `if not exists` / `on conflict do nothing` guarded, so
--   re-running is a no-op and a partial state heals.
--
-- VERIFY
--   The final SELECT lists every table and column this file installs. Each row
--   must read `present`.


-- ==========================================================================
-- 025 — sip_applications.resume_file_id
-- source: backend/migrations/025_sip_profile_links.sql
-- ==========================================================================

-- 025: capture LinkedIn / GitHub / resume on SIP applications (parity with TIR).
--
-- TIR got these in 019 (resume_file_id / linkedin_url / github_url). SIP applies
-- the same three columns so founder profile links + CV are stored for SIP too.
--
--   resume_file_id  uuid  -- key into the `resumes` storage bucket (no FK, mirrors TIR)
--   linkedin_url    text
--   github_url      text
--
-- No format CHECK constraints: TIR's linkedin/github format checks were dropped
-- during the SIP cutover (they caused false 422s on valid-but-unusual URLs).
-- URL validation lives in the API layer instead. Idempotent — safe to re-run.

ALTER TABLE sip_applications
  ADD COLUMN IF NOT EXISTS resume_file_id uuid,
  ADD COLUMN IF NOT EXISTS linkedin_url   text,
  ADD COLUMN IF NOT EXISTS github_url     text;

-- ==========================================================================
-- 028 — ai_screening.sections (AI 4-section blocks)
-- source: backend/migrations/028_ai_sections.sql
-- ==========================================================================

-- 028_ai_sections.sql
-- Store the four AI analyst sections (problem / solution / moats / watchouts),
-- each a list of bullet strings, produced by ai_pipeline.SectionAgent and written
-- through the existing ai_screening upsert (on_conflict application_id,application_track).
-- Nullable: null until generated (new submit) or backfilled. Idempotent.
alter table public.ai_screening
  add column if not exists sections jsonb;

comment on column public.ai_screening.sections is
  'AI analyst sections: {"problem":[...],"solution":[...],"moats":[...],"watchouts":[...]} — bullet lists, gemini-2.5-flash via ai_pipeline.SectionAgent (mig 028).';

-- ==========================================================================
-- 031 — ai_screening.founder_check
-- source: backend/migrations/031_founder_check.sql
-- ==========================================================================

-- 031_founder_check.sql
-- Résumé-derived founder assessment for TIR apps: a 4-bullet verdict produced by
-- the founder_check LangGraph pipeline (multimodal OCR -> talent-scout). Nullable;
-- NULL for all SIP apps and for TIR apps with no résumé / not yet processed.
-- Idempotent.
alter table public.ai_screening
  add column if not exists founder_check jsonb;

comment on column public.ai_screening.founder_check is
  'AI founder assessment (TIR only): {"verdict","confidence","top_signals","gaps","whats_rare","model","ran_at"} - resume multimodal-OCR''d + judged by google/gemini-2.5-flash via the founder_check LangGraph pipeline (mig 031).';

-- ==========================================================================
-- 032 — profile_completion_tokens.needs_evidence
-- source: backend/migrations/032_profile_completion_needs_evidence.sql
-- ==========================================================================

-- 032: evidence re-collection tokens
ALTER TABLE profile_completion_tokens
  ADD COLUMN IF NOT EXISTS needs_evidence boolean NOT NULL DEFAULT false;

-- ==========================================================================
-- 035 — 'comms' industry category row
-- source: backend/migrations/035_comms_industry_category.sql
-- ==========================================================================

-- 035_comms_industry_category.sql
-- Adds the "Communication (Wired & Wireless)" domain as a permanent seed
-- category. Additive + idempotent — safe to apply any time (no deploy-order
-- risk; existing code keeps working). The AI classifier reads industry_categories
-- dynamically, so future submissions can be classified into it automatically.
insert into public.industry_categories (id, label, is_seed) values
  ('comms', 'Communication (Wired & Wireless)', true)
on conflict (id) do nothing;

-- ==========================================================================
-- 036 — moved_to_track  (MUST precede 037)
-- source: backend/migrations/036_track_move_flag.sql
-- ==========================================================================

-- 036: TIR<->VIP track-move flag (reversible reclassification).
-- Additive + nullable; moved_to_track IS NULL == "not moved". No backfill.
-- The application row stays in its own table with its original answers; these
-- columns only let the admin UI badge a reclassified application.
ALTER TABLE tir_applications
  ADD COLUMN IF NOT EXISTS moved_to_track text,
  ADD COLUMN IF NOT EXISTS moved_at       timestamptz,
  ADD COLUMN IF NOT EXISTS moved_by       uuid;

ALTER TABLE sip_applications
  ADD COLUMN IF NOT EXISTS moved_to_track text,
  ADD COLUMN IF NOT EXISTS moved_at       timestamptz,
  ADD COLUMN IF NOT EXISTS moved_by       uuid;

-- ==========================================================================
-- 037 — ic_documents + private bucket  (BLOCKING: Accepted tab)
-- source: backend/migrations/037_ic_documents.sql
-- ==========================================================================

-- 037_ic_documents.sql — Investment Committee (IC) documents.
--
-- Backs the admin "Jury VIP Selected" section: a VIP (sip) application gets an
-- uploaded IC / minutes-of-meeting PDF, which an admin then digitally signs.
-- The signature is drawn (or typed) in the browser and stamped into the PDF, so
-- one row can hold BOTH artefacts: the pristine upload and the signed copy.
--
-- There is deliberately NO status guard here or in the API: the Final Gate
-- moves an app out of `jury_review` (→ offered/…), and the IC document may
-- legitimately be uploaded or signed after that decision.
--
-- New table: RLS on + explicit deny-all (service-role only), like migs 029/033.
-- NOTE: the TIR post-onboarding plan (docs/superpowers/plans/2026-07-02-…)
-- also drafted a "037" — it must renumber to 038; this one is applied first.

begin;

create table if not exists public.ic_documents (
  id                  uuid primary key default gen_random_uuid(),
  application_id      uuid not null,
  application_track   text not null check (application_track in ('tir', 'sip')),

  -- The uploaded original (IC / MOM PDF).
  bucket              text not null default 'ic-documents',
  storage_path        text not null,
  file_name           text,
  size_bytes          bigint,
  uploaded_by         uuid references auth.users(id) on delete set null,
  uploaded_at         timestamptz not null default now(),

  -- The signed copy. All null until someone signs.
  signed_storage_path text,
  signed_file_name    text,
  signed_size_bytes   bigint,
  signed_by           uuid references auth.users(id) on delete set null,
  signer_name         text,
  signer_email        text,
  signed_at           timestamptz,

  -- Set when a newer upload replaces this document. History is never deleted:
  -- superseded rows stay for audit, only the current row is served.
  superseded_at       timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Exactly one CURRENT document per application; any number of superseded ones.
create unique index if not exists ic_documents_current_uidx
  on public.ic_documents (application_id, application_track)
  where superseded_at is null;
create index if not exists ic_documents_app_idx
  on public.ic_documents (application_id, application_track);

alter table public.ic_documents enable row level security;
drop policy if exists "ic_documents: deny all" on public.ic_documents;
create policy "ic_documents: deny all" on public.ic_documents
  for all to authenticated, anon using (false) with check (false);

-- Private storage bucket for both artefacts. Service-role only — the backend
-- admin client does every read/write and hands out 120s signed URLs, exactly
-- like the tir-/sip- buckets, so no storage.objects policies are needed.
insert into storage.buckets (id, name, public)
values ('ic-documents', 'ic-documents', false)
on conflict (id) do nothing;

commit;

-- ==========================================================================
-- 038 — academic_profiles
-- source: backend/migrations/038_academic_profiles.sql
-- ==========================================================================

-- 038_academic_profiles.sql — cached enrichment of academic-roster profile pages.
--
-- Backs the "From their profile page" card on the admin Academic Jury Roster
-- professor page: an admin opens a professor, we fetch that professor's own
-- faculty page once, LLM-extract emails / lab / education / interests /
-- publications / awards / links, and cache the result here so the page is never
-- fetched twice.
--
-- Keyed on profile_url because that is what the roster actually carries and what
-- the fetch is authorised against (app/data/academic_profile_urls.json). Names
-- are not unique enough across 809 rows and change spelling between sources.
--
-- New table: RLS on + explicit deny-all (service-role only), like migs 033/037.
-- NOTE: 037 is ic_documents. The TIR post-onboarding plan also drafted a "037";
-- if that work resumes it needs 039 now.

begin;

create table if not exists public.academic_profiles (
  id             uuid primary key default gen_random_uuid(),
  profile_url    text not null,
  name           text,

  status         text not null default 'pending'
                 check (status in ('pending', 'running', 'done', 'failed')),
  -- Machine-readable failure reason (url_not_in_roster, page_timeout,
  -- page_unavailable, redirect_blocked, llm_timeout, …) + its message.
  error_code     text,
  error          text,
  http_status    integer,

  -- Normalised extraction: emails, phone, position, lab{name,url}, education[],
  -- research_interests[], publications[{title,venue,year}], awards[],
  -- links[{label,url}], summary. Shape is enforced in
  -- services/academic_enrichment/run.py::normalise before it is written.
  extracted      jsonb,
  model          text,
  content_chars  integer,

  fetched_at     timestamptz,
  enriched_by    uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists academic_profiles_url_uidx
  on public.academic_profiles (profile_url);

alter table public.academic_profiles enable row level security;
drop policy if exists "academic_profiles: deny all" on public.academic_profiles;
create policy "academic_profiles: deny all" on public.academic_profiles
  for all to authenticated, anon using (false) with check (false);

commit;

-- ==========================================================================
-- 039 — jury_responses
-- source: backend/migrations/039_jury_responses.sql
-- ==========================================================================

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


-- ==========================================================================
-- VERIFY — every row must read `present`
-- ==========================================================================

select 'table: ' || t.name as object,
       case when to_regclass('public.' || t.name) is null then 'MISSING' else 'present' end as state
from (values ('ic_documents'), ('academic_profiles'), ('jury_responses')) as t(name)
union all
select 'column: ' || c.tbl || '.' || c.col,
       case when exists (select 1 from information_schema.columns
                         where table_schema = 'public' and table_name = c.tbl and column_name = c.col)
            then 'present' else 'MISSING' end
from (values
        ('sip_applications', 'resume_file_id'),
        ('ai_screening', 'sections'),
        ('ai_screening', 'founder_check'),
        ('profile_completion_tokens', 'needs_evidence'),
        ('tir_applications', 'moved_to_track'),
        ('sip_applications', 'moved_to_track')
     ) as c(tbl, col)
union all
select 'row: industry_categories.comms',
       case when exists (select 1 from public.industry_categories where id = 'comms')
            then 'present' else 'MISSING' end
order by 1;
