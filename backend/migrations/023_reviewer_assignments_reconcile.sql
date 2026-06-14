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

-- Ensure the state CHECK exists on both envs (014 defined it on prod; staging's
-- freshly-added column needs it). Idempotent + schema-anchored.
do $$
begin
  if not exists (
    select 1
    from   pg_constraint c
    join   pg_class r      on r.oid = c.conrelid
    join   pg_namespace n  on n.oid = r.relnamespace
    where  c.conname = 'reviewer_assignments_state_check'
      and  r.relname = 'reviewer_assignments'
      and  n.nspname = 'public'
  ) then
    alter table public.reviewer_assignments
      add constraint reviewer_assignments_state_check
      check (state in ('pending', 'accepted', 'declined', 'completed'));
  end if;
end $$;
commit;
