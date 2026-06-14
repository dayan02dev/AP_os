-- 023_reviewer_assignments_reconcile.sql
-- Reconcile reviewer_assignments column drift between staging (lacks `state`)
-- and prod (lacks declined_at/reassigned_to/completed_at/decline_reason) so the
-- reviewer decline + submit-complete flows work on both. Additive, idempotent.
-- Apply to STAGING (exqmxvdtcsvpgtftwjml) and PROD (xtmszlpwgbyoumalgbhs) SQL editors.
begin;
alter table public.reviewer_assignments add column if not exists state text not null default 'pending';
alter table public.reviewer_assignments add column if not exists declined_at timestamptz;
alter table public.reviewer_assignments add column if not exists reassigned_to uuid;
alter table public.reviewer_assignments add column if not exists completed_at timestamptz;
alter table public.reviewer_assignments add column if not exists decline_reason text;
commit;
