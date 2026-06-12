-- 022_reviewer_portal_v2.sql
-- Reviewer Portal v2 (spec docs/superpowers/specs/2026-06-12-reviewer-portal-production-design.md §3)
-- Additive only. Idempotent. Service-role-only tables — no RLS policy changes.
--
-- Apply to STAGING Supabase (exqmxvdtcsvpgtftwjml) first.
-- Apply to PROD Supabase (xtmszlpwgbyoumalgbhs) BEFORE the cutover window
-- (columns are unused by running code; zero risk).

begin;

-- 1. Reviewer-raised flags on a review (max 8, each ≤80 chars app-enforced)
alter table public.reviews
  add column if not exists flags jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1
    from   pg_constraint c
    join   pg_class r      on r.oid = c.conrelid
    join   pg_namespace n  on n.oid = r.relnamespace
    where  c.conname = 'reviews_flags_cap'
      and  r.relname = 'reviews'
      and  n.nspname = 'public'
  ) then
    alter table public.reviews
      add constraint reviews_flags_cap
      check (jsonb_typeof(flags) = 'array' and jsonb_array_length(flags) <= 8);
  end if;
end $$;

-- 2. Per-assignment due date (drives the queue "Due" column)
alter table public.reviewer_assignments
  add column if not exists due_at timestamptz;

commit;
