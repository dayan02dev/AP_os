-- 008_application_templates.sql — offline template upload + parse.
--
-- A second auto-fill mechanism alongside the resume upload. Applicants
-- who prefer to type offline download a Word .docx template containing
-- Q9–Q19, fill it at their own pace, and upload it; the parsing pipeline
-- extracts each answer between literal anchor markers (>>> ANSWER Q9
-- START >>> … <<< ANSWER Q9 END <<<), normalises the two MCQ answers via
-- Gemini Flash, and pre-populates the matching DB columns on the user's
-- open draft application. Apply-to-application is NULL-only: a field
-- the applicant has already typed into is never overwritten.
--
-- All Q9–Q19 target columns already exist on public.applications:
--   Q9  → problem_describe              Q15 → execution_will_break
--   Q10 → problem_defined               Q16 → execution_milestone
--   Q11 → solution_describe             Q17 → execution_infrastructure
--   Q12 → solution_core_tech            Q18 → execution_failure
--   Q13 → solution_contrarian_insight   Q19 → execution_hwsw_integration
--   Q14 → solution_stage
--
-- This migration therefore only adds the new tracking table + storage
-- bucket; no ALTER TABLE on applications is needed.
--
-- Idempotent.

begin;

-- ─────────────────────────────────────────────────────────────
-- 1. Tracking table — one row per upload, mirrors resume_uploads.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.application_templates (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  application_id           uuid references public.applications(id) on delete set null,
  storage_path             text not null,
  original_filename        text,
  file_size_bytes          integer,
  mime_type                text,
  parse_status             text not null default 'pending'
                            check (parse_status in ('pending','processing','completed','failed')),
  parse_error              text,
  parsed_at                timestamptz,
  parsed_data              jsonb,                       -- raw {"Q9": "...", "Q10": "Yes", ...}
  applied_to_application_at timestamptz,
  created_at               timestamptz not null default now()
);

create index if not exists idx_app_templates_user
  on public.application_templates (user_id);
create index if not exists idx_app_templates_app
  on public.application_templates (application_id);
create index if not exists idx_app_templates_user_created_at
  on public.application_templates (user_id, created_at desc);

alter table public.application_templates enable row level security;

drop policy if exists app_templates_self_select on public.application_templates;
create policy app_templates_self_select on public.application_templates
  for select using (auth.uid() = user_id);

drop policy if exists app_templates_self_insert on public.application_templates;
create policy app_templates_self_insert on public.application_templates
  for insert with check (auth.uid() = user_id);

drop policy if exists app_templates_self_update on public.application_templates;
create policy app_templates_self_update on public.application_templates
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- 2. Private 'application-templates' storage bucket.
--    Path convention: <auth_uid>/<file-uuid>.{docx|pdf}
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'application-templates',
  'application-templates',
  false,
  10485760,                                                  -- 10 MiB
  array[
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/pdf'
  ]
)
on conflict (id) do update
   set public             = excluded.public,
       file_size_limit    = excluded.file_size_limit,
       allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "app-templates: users upload to own folder" on storage.objects;
create policy "app-templates: users upload to own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'application-templates'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "app-templates: users read own files" on storage.objects;
create policy "app-templates: users read own files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'application-templates'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "app-templates: users delete own files" on storage.objects;
create policy "app-templates: users delete own files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'application-templates'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

commit;
