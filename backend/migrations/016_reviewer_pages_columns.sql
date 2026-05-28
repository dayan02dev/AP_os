-- 016_reviewer_pages_columns.sql
--
-- Migration 014 created the `reviews` table for Phase 1's leadership-side
-- reviewer assignment work, but the reviewer-side scoring screens (Phase
-- 1.5, branch feature/reviewer-screens) need additional columns the
-- original schema didn't include. See:
--   docs/superpowers/specs/2026-05-18-reviewer-pages-phase-1.5-design.md
--   docs/superpowers/plans/2026-05-18-reviewer-pages-phase-1.5-plan.md
--
-- Adds:
--   assignment_id    — FK to reviewer_assignments(id), nullable for drafts
--                      (set to NULL when a draft is migrated to submitted
--                      without an assignment context, but normally always
--                      populated)
--   recommendation   — yes / maybe / no (check constraint)
--   strengths        — free text reviewer rationale
--   concerns         — free text reviewer rationale
--   quick_notes      — private to the reviewer
--   locked_at        — when the 60-min edit window closes; PATCH after
--                      this time returns 423 Locked
--   disagree_with_ai — jsonb, Phase 2 (stays NULL in Phase 1.5)
--
-- All columns are nullable. Migration is idempotent (add column if not
-- exists). Existing rows from Phase 1 (if any) are unaffected.
--
-- Run on staging via Supabase SQL editor against project
-- exqmxvdtcsvpgtftwjml after this branch's PR is opened. Run on prod via
-- the same path when the branch is merged to main and prod follows.

begin;

alter table public.reviews
  add column if not exists assignment_id    uuid references public.reviewer_assignments(id) on delete set null,
  add column if not exists recommendation   text check (recommendation in ('yes','maybe','no')),
  add column if not exists strengths        text,
  add column if not exists concerns         text,
  add column if not exists quick_notes      text,
  add column if not exists locked_at        timestamptz,
  add column if not exists disagree_with_ai jsonb;

create index if not exists idx_reviews_locked_at     on public.reviews(locked_at);
create index if not exists idx_reviews_assignment_id on public.reviews(assignment_id);

commit;
