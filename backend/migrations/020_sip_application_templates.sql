-- 020_sip_application_templates.sql — offline template upload + parse (SIP).
--
-- SIP equivalent of migration 008. One row per .docx/.pdf upload, mirrors
-- public.application_templates. Foreign-keyed to public.sip_applications
-- rather than public.applications, so RLS scoping and audit trails stay
-- track-isolated.
--
-- Q5..Q24 (minus Q7, Q22, Q23) target columns already exist on
-- public.sip_applications (introduced in migrations 011 + 012). No
-- ALTER TABLE on sip_applications is required.
--
-- Apply semantics on the router differ from TIR: SIP uses NULL-only
-- writes (preserve typed answers). See Decision D6 in the spec.
--
-- Idempotent.

begin;

-- ─────────────────────────────────────────────────────────────
-- 1. Tracking table — one row per upload, mirrors application_templates.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.sip_application_templates (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  application_id           uuid references public.sip_applications(id) on delete set null,
  storage_path             text not null,
  original_filename        text,
  file_size_bytes          integer,
  mime_type                text,
  parse_status             text not null default 'pending'
                            check (parse_status in ('pending','processing','completed','failed')),
  parse_error              text,
  parsed_at                timestamptz,
  parsed_data              jsonb,                       -- raw {"Q5": "...", "Q6": "TRL 4 — ...", ...}
  applied_to_application_at timestamptz,
  created_at               timestamptz not null default now()
);

create index if not exists idx_sip_app_templates_user
  on public.sip_application_templates (user_id);
create index if not exists idx_sip_app_templates_app
  on public.sip_application_templates (application_id);
create index if not exists idx_sip_app_templates_user_created_at
  on public.sip_application_templates (user_id, created_at desc);

alter table public.sip_application_templates enable row level security;

drop policy if exists sip_app_templates_self_select on public.sip_application_templates;
create policy sip_app_templates_self_select on public.sip_application_templates
  for select using (auth.uid() = user_id);

drop policy if exists sip_app_templates_self_insert on public.sip_application_templates;
create policy sip_app_templates_self_insert on public.sip_application_templates
  for insert with check (auth.uid() = user_id);

drop policy if exists sip_app_templates_self_update on public.sip_application_templates;
create policy sip_app_templates_self_update on public.sip_application_templates
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- 2. Private 'sip-application-templates' storage bucket.
--    Path convention: <auth_uid>/<file-uuid>.{docx|pdf}
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sip-application-templates',
  'sip-application-templates',
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

drop policy if exists "sip-app-templates: users upload to own folder" on storage.objects;
create policy "sip-app-templates: users upload to own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'sip-application-templates'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "sip-app-templates: users read own files" on storage.objects;
create policy "sip-app-templates: users read own files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'sip-application-templates'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "sip-app-templates: users delete own files" on storage.objects;
create policy "sip-app-templates: users delete own files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'sip-application-templates'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

commit;
