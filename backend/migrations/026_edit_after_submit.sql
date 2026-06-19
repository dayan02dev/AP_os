-- 026_edit_after_submit.sql
-- Track post-submit edits so reviewers can see an application changed after submission.
alter table public.tir_applications
  add column if not exists edited_after_submit boolean not null default false,
  add column if not exists last_edited_at timestamptz;

alter table public.sip_applications
  add column if not exists edited_after_submit boolean not null default false,
  add column if not exists last_edited_at timestamptz;
