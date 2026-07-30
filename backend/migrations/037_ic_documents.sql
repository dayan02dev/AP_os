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
