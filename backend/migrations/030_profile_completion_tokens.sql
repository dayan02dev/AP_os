-- 030_profile_completion_tokens.sql
-- Single-use, 72h magic-link tokens for the TIR profile-completion request
-- (applicant uploads a missing résumé / LinkedIn via a no-login form).
-- Service-role only (no public RLS grants); all access via the backend.
create table if not exists public.profile_completion_tokens (
  id uuid primary key default gen_random_uuid(),
  application_id uuid,                       -- tir_applications.id; NULL for preview tokens
  application_track text not null default 'tir',
  token text not null unique,                -- secrets.token_urlsafe(32)
  needs_resume boolean not null default true,
  needs_linkedin boolean not null default true,
  is_preview boolean not null default false, -- preview/sample tokens write nothing
  sent_to text,                              -- email the link was sent to (audit)
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists idx_pct_token on public.profile_completion_tokens(token);
create index if not exists idx_pct_application
  on public.profile_completion_tokens(application_id, application_track);
