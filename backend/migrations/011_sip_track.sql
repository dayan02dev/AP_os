-- 011_sip_track.sql — SIP (Startup Incubation Program) track schema.
--
-- Mirror of the TIR side, but:
--   - Drops TIR-only fields (hasTeam/teammates, problem_defined, stage,
--     evidence_files+video+deck, several legacy solution_* columns).
--   - Adds SIP-specific fields (sip_incorporated, sip_trl, sip_founders,
--     sip_traction, sip_traction_details + files, sip_pitch_deck,
--     sip_cap_table_file, sip_demo_video_url, sip_patents_files).
--   - All SIP RLS policies enforce profiles.track = 'sip' so a TIR user
--     cannot even SELECT from sip_* tables — physical isolation, not
--     just app-layer.
--
-- Run AFTER 010_track_rename_and_split.sql.
-- Idempotent.

begin;

-- ════════════════════════════════════════════════════════════════════
-- 1. sip_applications — one row per SIP draft/submission
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.sip_applications (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references public.profiles(id) on delete cascade,
  status                      text not null default 'draft'
                                check (status in ('draft','submitted','under_review','shortlisted','rejected','accepted','withdrawn')),
  current_section             text,
  completion_pct              smallint not null default 0 check (completion_pct between 0 and 100),
  submitted_at                timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),

  -- ── Section 02 · Basic Information (shared with TIR) ───────
  basic_full_name             text,
  basic_phone                 text,
  basic_email                 text,
  basic_org                   text,
  basic_degree                text
                                check (basic_degree is null or basic_degree in
                                  ('Bachelor''s Degree','Master''s Degree','PhD','Self-taught / Other')),
  basic_incubator_association text
                                check (basic_incubator_association is null or basic_incubator_association in ('Yes','No')),
  basic_incubator_details     text,
  basic_hear_about            text
                                check (basic_hear_about is null or basic_hear_about in
                                  ('Referral from friend/colleague',
                                   'IISc faculty or staff',
                                   'Social media (LinkedIn, Twitter, etc.)',
                                   'Event or conference',
                                   'Search engine',
                                   'Partner organization',
                                   'News article or press',
                                   'Other')),

  -- ── Section 02 · SIP-specific gates ────────────────────────
  sip_incorporated            text
                                check (sip_incorporated is null or sip_incorporated in
                                  ('Yes — Pvt Ltd, registered in India',
                                   'Not yet — we''re still pre-incorporation')),
  sip_trl                     text
                                check (sip_trl is null or sip_trl in
                                  ('TRL 3 or earlier — research stage',
                                   'TRL 4 — lab-validated prototype',
                                   'TRL 5 — pilot-tested in a relevant environment',
                                   'TRL 6+ — demonstrated in operational setting')),
  -- sipFounders cap table: list of {name, role, percent}
  sip_founders                jsonb not null default '[]'::jsonb,

  -- ── Section 03 · Problem & Importance (shared) ─────────────
  problem_describe            text,

  -- ── Section 04 · Your Solution (shared with TIR + SIP-specific) ─
  solution_describe           text,
  solution_core_tech          text,
  solution_contrarian_insight text,

  -- SIP-specific: traction
  sip_traction                text
                                check (sip_traction is null or sip_traction in
                                  ('Pre-revenue — building toward our first pilot',
                                   'Active pilots (paid or unpaid) with design partners',
                                   'Paying pilots — customers have paid for early access',
                                   'Live paying customers — repeat revenue')),
  sip_traction_details        text,
  -- LOI/MoU/PO uploads (cap of 5 enforced below + at app layer)
  sip_traction_files          jsonb not null default '[]'::jsonb,

  -- ── Section 05 · Execution Plan (shared with TIR) ──────────
  execution_milestone         text,
  execution_infrastructure    text,
  execution_failure           text,
  execution_hwsw_integration  text,
  -- Cap of 3 enforced below + at app layer
  execution_milestone_files   jsonb not null default '[]'::jsonb,

  -- ── Section 06 · Evidence (SIP-specific) ───────────────────
  -- Single-file objects: {path, name, size, mime_type, uploaded_at}
  sip_pitch_deck              jsonb,
  sip_cap_table_file          jsonb,
  -- Demo video is just a URL link (Loom / YouTube / Drive), not an upload
  sip_demo_video_url          text,
  -- Patents/publications: list of file objects (cap of 5)
  sip_patents_files           jsonb not null default '[]'::jsonb,

  -- ── Section 07 · Declaration (shared) ──────────────────────
  declaration_truthful        boolean not null default false,
  declaration_ref_checks      boolean not null default false,
  declaration_terms           boolean not null default false,
  declaration_newsletter      boolean not null default false,

  -- ── Soft caps on JSONB array length (DB-level safety net) ──
  constraint sip_applications_milestone_files_cap
    check (
      execution_milestone_files is null
      or (jsonb_typeof(execution_milestone_files) = 'array'
          and jsonb_array_length(execution_milestone_files) <= 3)
    ),
  constraint sip_applications_traction_files_cap
    check (
      sip_traction_files is null
      or (jsonb_typeof(sip_traction_files) = 'array'
          and jsonb_array_length(sip_traction_files) <= 5)
    ),
  constraint sip_applications_patents_files_cap
    check (
      sip_patents_files is null
      or (jsonb_typeof(sip_patents_files) = 'array'
          and jsonb_array_length(sip_patents_files) <= 5)
    ),
  constraint sip_applications_founders_cap
    check (
      sip_founders is null
      or (jsonb_typeof(sip_founders) = 'array'
          and jsonb_array_length(sip_founders) <= 12)
    )
);

-- Indexes
create index if not exists sip_applications_status_idx
  on public.sip_applications(status) where status <> 'draft';
create index if not exists sip_applications_submitted_at_idx
  on public.sip_applications(submitted_at desc) where submitted_at is not null;
create index if not exists sip_applications_user_id_idx
  on public.sip_applications(user_id);
create unique index if not exists sip_applications_one_draft_per_user
  on public.sip_applications(user_id) where status = 'draft';
create index if not exists sip_applications_user_submitted_idx
  on public.sip_applications(user_id, submitted_at desc) where status <> 'draft';

-- Triggers (reuse the generic touch_updated_at function from migration 001)
drop trigger if exists trg_sip_applications_updated_at on public.sip_applications;
create trigger trg_sip_applications_updated_at
  before update on public.sip_applications
  for each row execute function public.tg_touch_updated_at();

-- SIP equivalent of the TIR submitted-at stamper
create or replace function public.tg_sip_applications_stamp_submitted()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'submitted' and (old.status is null or old.status <> 'submitted') then
    new.submitted_at := coalesce(new.submitted_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sip_applications_stamp_submitted on public.sip_applications;
create trigger trg_sip_applications_stamp_submitted
  before update on public.sip_applications
  for each row execute function public.tg_sip_applications_stamp_submitted();

-- ════════════════════════════════════════════════════════════════════
-- 2. sip_resume_uploads — mirror of tir_resume_uploads
-- ════════════════════════════════════════════════════════════════════
create table if not exists public.sip_resume_uploads (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles(id) on delete cascade,
  storage_path       text not null,                 -- path inside Storage bucket 'sip-resumes'
  original_filename  text not null,
  file_size_bytes    integer not null check (file_size_bytes > 0),
  mime_type          text not null,
  parse_status       text not null default 'pending'
                       check (parse_status in ('pending','processing','completed','failed')),
  parsed_data        jsonb,
  parse_error        text,
  parsed_at          timestamptz,
  created_at         timestamptz not null default now()
);

create index if not exists sip_resume_uploads_user_created_idx
  on public.sip_resume_uploads(user_id, created_at desc);

-- ════════════════════════════════════════════════════════════════════
-- 3. RLS — enforce profiles.track = 'sip' on every read/write
--    A TIR user (track='tir') will physically fail any SELECT/INSERT
--    /UPDATE on these tables: the policy USING/CHECK clause returns
--    false, RLS rejects the row.
-- ════════════════════════════════════════════════════════════════════
alter table public.sip_applications   enable row level security;
alter table public.sip_resume_uploads enable row level security;

-- ─── sip_applications policies ──────────────────────────────────────
drop policy if exists "sip_applications: self can select" on public.sip_applications;
create policy "sip_applications: self can select"
  on public.sip_applications for select
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles p
       where p.id = auth.uid() and p.track = 'sip'
    )
  );

drop policy if exists "sip_applications: self can insert" on public.sip_applications;
create policy "sip_applications: self can insert"
  on public.sip_applications for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles p
       where p.id = auth.uid() and p.track = 'sip'
    )
  );

drop policy if exists "sip_applications: self can update draft" on public.sip_applications;
create policy "sip_applications: self can update draft"
  on public.sip_applications for update
  using (
    auth.uid() = user_id and status = 'draft'
    and exists (
      select 1 from public.profiles p
       where p.id = auth.uid() and p.track = 'sip'
    )
  )
  with check (
    auth.uid() = user_id and status = 'draft'
    and exists (
      select 1 from public.profiles p
       where p.id = auth.uid() and p.track = 'sip'
    )
  );

-- ─── sip_resume_uploads policies ────────────────────────────────────
drop policy if exists "sip_resume_uploads: self can select" on public.sip_resume_uploads;
create policy "sip_resume_uploads: self can select"
  on public.sip_resume_uploads for select
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles p
       where p.id = auth.uid() and p.track = 'sip'
    )
  );

drop policy if exists "sip_resume_uploads: self can insert" on public.sip_resume_uploads;
create policy "sip_resume_uploads: self can insert"
  on public.sip_resume_uploads for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles p
       where p.id = auth.uid() and p.track = 'sip'
    )
  );

-- ════════════════════════════════════════════════════════════════════
-- 4. SIP storage buckets
-- ════════════════════════════════════════════════════════════════════

-- ─── sip-resumes (CV uploads, max 10 MiB) ───────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sip-resumes',
  'sip-resumes',
  false,
  10485760,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
   set public             = excluded.public,
       file_size_limit    = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

-- ─── sip-milestone-files (Q5 supporting docs, max 5 MiB) ────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sip-milestone-files',
  'sip-milestone-files',
  false,
  5242880,
  array[
    'application/pdf',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'image/png',
    'image/jpeg'
  ]
)
on conflict (id) do update
   set public             = excluded.public,
       file_size_limit    = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

-- ─── sip-evidence-files (pitch deck, cap table, traction LOIs, patents)
--      Max 25 MiB per the SIP spec (pitch decks run large).
--      Subfolder convention enforced at app layer:
--        <uid>/pitch-deck/<uuid>.pdf
--        <uid>/cap-table/<uuid>.xlsx
--        <uid>/traction/<uuid>.pdf
--        <uid>/patents/<uuid>.pdf
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sip-evidence-files',
  'sip-evidence-files',
  false,
  26214400,
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv'
  ]
)
on conflict (id) do update
   set public             = excluded.public,
       file_size_limit    = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

-- ════════════════════════════════════════════════════════════════════
-- 5. Storage RLS — also gate on profiles.track = 'sip'
-- ════════════════════════════════════════════════════════════════════

-- ─── sip-resumes ────────────────────────────────────────────────────
drop policy if exists "sip-resumes: users upload to own folder" on storage.objects;
create policy "sip-resumes: users upload to own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'sip-resumes'
    and auth.uid()::text = (storage.foldername(name))[1]
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.track = 'sip')
  );

drop policy if exists "sip-resumes: users read own files" on storage.objects;
create policy "sip-resumes: users read own files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'sip-resumes'
    and auth.uid()::text = (storage.foldername(name))[1]
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.track = 'sip')
  );

-- ─── sip-milestone-files ────────────────────────────────────────────
drop policy if exists "sip-milestone-files: users upload to own folder" on storage.objects;
create policy "sip-milestone-files: users upload to own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'sip-milestone-files'
    and auth.uid()::text = (storage.foldername(name))[1]
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.track = 'sip')
  );

drop policy if exists "sip-milestone-files: users read own files" on storage.objects;
create policy "sip-milestone-files: users read own files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'sip-milestone-files'
    and auth.uid()::text = (storage.foldername(name))[1]
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.track = 'sip')
  );

drop policy if exists "sip-milestone-files: users delete own files" on storage.objects;
create policy "sip-milestone-files: users delete own files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'sip-milestone-files'
    and auth.uid()::text = (storage.foldername(name))[1]
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.track = 'sip')
  );

-- ─── sip-evidence-files ─────────────────────────────────────────────
drop policy if exists "sip-evidence-files: users upload to own folder" on storage.objects;
create policy "sip-evidence-files: users upload to own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'sip-evidence-files'
    and auth.uid()::text = (storage.foldername(name))[1]
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.track = 'sip')
  );

drop policy if exists "sip-evidence-files: users read own files" on storage.objects;
create policy "sip-evidence-files: users read own files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'sip-evidence-files'
    and auth.uid()::text = (storage.foldername(name))[1]
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.track = 'sip')
  );

drop policy if exists "sip-evidence-files: users delete own files" on storage.objects;
create policy "sip-evidence-files: users delete own files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'sip-evidence-files'
    and auth.uid()::text = (storage.foldername(name))[1]
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.track = 'sip')
  );

-- ════════════════════════════════════════════════════════════════════
-- 6. Sanity checks
-- ════════════════════════════════════════════════════════════════════
do $$
begin
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='sip_applications') then
    raise exception 'sip_applications table missing';
  end if;
  if not exists (select 1 from pg_tables where schemaname='public' and tablename='sip_resume_uploads') then
    raise exception 'sip_resume_uploads table missing';
  end if;
  if not exists (select 1 from storage.buckets where id='sip-resumes') then
    raise exception 'sip-resumes bucket missing';
  end if;
  if not exists (select 1 from storage.buckets where id='sip-milestone-files') then
    raise exception 'sip-milestone-files bucket missing';
  end if;
  if not exists (select 1 from storage.buckets where id='sip-evidence-files') then
    raise exception 'sip-evidence-files bucket missing';
  end if;
end $$;

commit;

-- ════════════════════════════════════════════════════════════════════
-- 7. Final state — paste these queries to verify after running
-- ════════════════════════════════════════════════════════════════════
-- select tablename from pg_tables where schemaname='public' and tablename like 'sip_%' order by 1;
-- select id from storage.buckets where id like 'sip-%' order by 1;
-- select polname from pg_policies where schemaname='public' and tablename like 'sip_%' order by 1;
