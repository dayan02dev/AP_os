-- 014_admin_platform_phase1.sql
--
-- Phase 1 admin platform schema. Reconstructed from the live state of the
-- staging Supabase project (exqmxvdtcsvpgtftwjml) where the original DDL was
-- applied ad-hoc via the SQL editor during the design iteration.
-- Idempotent: every object uses IF NOT EXISTS / IF EXISTS so this file can be
-- safely re-run against staging AND used to bring a fresh DB to the same
-- shape before applying any later migrations.
--
-- Tables created:
--   user_roles                 (multi-role RBAC join)
--   reviewer_assignments       (1-3 reviewers per app)
--   reviews                    (reviewer scores per category)
--   ai_screening               (one AI score per app+track, idempotent on resubmit)
--   application_status_log     (audit trail of status transitions)
--   audit_log_v2               (append-only audit log for privileged writes)
--
-- Columns added:
--   profiles.active_role       (UI navigation hint — NOT a permission gate)

begin;

-- ─── profiles.active_role ────────────────────────────────────────────
alter table profiles
  add column if not exists active_role text;

-- ─── user_roles ──────────────────────────────────────────────────────
create table if not exists user_roles (
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in (
                'applicant', 'founder', 'reviewer',
                'mentor', 'leadership', 'admin'
              )),
  granted_by  uuid references auth.users(id) on delete set null,
  granted_at  timestamptz not null default now(),
  primary key (user_id, role)
);

create index if not exists idx_user_roles_role on user_roles(role);

-- ─── reviewer_assignments ────────────────────────────────────────────
create table if not exists reviewer_assignments (
  id                  uuid primary key default gen_random_uuid(),
  application_id      uuid not null,
  application_track   text not null check (application_track in ('tir', 'sip')),
  reviewer_user_id    uuid not null references auth.users(id) on delete cascade,
  assigned_by         uuid references auth.users(id) on delete set null,
  assigned_at         timestamptz not null default now(),
  state               text not null default 'pending'
                        check (state in ('pending', 'accepted', 'declined', 'completed')),
  unique (application_id, application_track, reviewer_user_id)
);

create index if not exists idx_reviewer_assignments_reviewer
  on reviewer_assignments(reviewer_user_id, state);
create index if not exists idx_reviewer_assignments_app
  on reviewer_assignments(application_id, application_track);

-- ─── reviews ─────────────────────────────────────────────────────────
create table if not exists reviews (
  id                  uuid primary key default gen_random_uuid(),
  application_id      uuid not null,
  application_track   text not null check (application_track in ('tir', 'sip')),
  reviewer_user_id    uuid not null references auth.users(id) on delete cascade,
  score_problem       numeric(4,1),
  score_solution      numeric(4,1),
  score_tech          numeric(4,1),
  score_founders      numeric(4,1),
  score_commitment    numeric(4,1),
  score_integrity     numeric(4,1),
  ai_score_overall    numeric(4,1),
  comments            text,
  status              text not null default 'draft'
                        check (status in ('draft', 'submitted')),
  submitted_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (application_id, application_track, reviewer_user_id)
);

create index if not exists idx_reviews_app
  on reviews(application_id, application_track);

-- ─── ai_screening ────────────────────────────────────────────────────
create table if not exists ai_screening (
  id                  uuid primary key default gen_random_uuid(),
  application_id      uuid not null,
  application_track   text not null check (application_track in ('tir', 'sip')),
  score_problem       numeric(4,1),
  score_solution      numeric(4,1),
  score_tech          numeric(4,1),
  score_founders      numeric(4,1),
  score_commitment    numeric(4,1),
  score_integrity     numeric(4,1),
  score_overall       numeric(4,1),
  confidence          numeric(4,3),
  summary             text,
  flags               jsonb default '[]'::jsonb,
  raw_response        text,
  model               text,
  ran_at              timestamptz not null default now(),
  error               text,
  unique (application_id, application_track)
);

-- ─── application_status_log ──────────────────────────────────────────
create table if not exists application_status_log (
  id                  uuid primary key default gen_random_uuid(),
  application_id      uuid not null,
  application_track   text not null check (application_track in ('tir', 'sip')),
  from_status         text,
  to_status           text not null,
  changed_by          uuid references auth.users(id) on delete set null,
  changed_at          timestamptz not null default now(),
  reason              text
);

create index if not exists idx_application_status_log_app
  on application_status_log(application_id, application_track, changed_at desc);

-- ─── audit_log_v2 ────────────────────────────────────────────────────
create table if not exists audit_log_v2 (
  id              bigserial primary key,
  actor_user_id   uuid references auth.users(id) on delete set null,
  actor_role      text,
  action_type     text not null,
  target_table    text,
  target_id       text,
  before_state    jsonb,
  after_state     jsonb,
  reason          text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_audit_log_v2_actor
  on audit_log_v2(actor_user_id, created_at desc);
create index if not exists idx_audit_log_v2_target
  on audit_log_v2(target_table, target_id, created_at desc);

commit;
