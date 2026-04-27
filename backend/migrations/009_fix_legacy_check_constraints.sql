-- 009_fix_legacy_check_constraints.sql — relax stale enum CHECKs.
--
-- Two CHECK constraints in 001_initial_schema.sql were never updated when
-- the wizard's question copy changed, and both blocked writes of values
-- the current wizard / template parser legitimately produces:
--
--   problem_defined   accepted only {'Yes, clearly defined',
--                                    'Partially defined',
--                                    'Still exploring the problem space'}
--                     → wizard now writes 'Yes' / 'No'.
--
--   solution_stage    accepted seven values, two of which had stale
--                     spellings vs. the wizard:
--                       'Still exploring problem area'
--                         vs. wizard 'Still exploring'
--                       'Lab demos / proof-of-concept'
--                         vs. wizard 'Lab demos / proof of concept'
--
-- Symptom: any UPDATE on a row that ended up with a "current" value here
-- 23514'd, even when the offending column was already in the row from
-- before — Postgres validates CHECK against the resulting row, not the
-- changed columns. This broke the application-template apply-to-form
-- flow whenever Gemini correctly returned a current option.
--
-- Fix: drop both constraints and re-add them with the union of legacy +
-- current values, so legacy drafts keep working AND new writes succeed.
-- If we ever want to enforce only the new options, do it via app-layer
-- validation rather than another DB constraint that drifts.
--
-- Idempotent.

begin;

alter table public.applications
  drop constraint if exists applications_problem_defined_check;
alter table public.applications
  add constraint applications_problem_defined_check
  check (
    problem_defined is null
    or problem_defined in (
      -- Current wizard options
      'Yes',
      'No',
      -- Legacy options (preserved so existing drafts keep validating)
      'Yes, clearly defined',
      'Partially defined',
      'Still exploring the problem space'
    )
  );

alter table public.applications
  drop constraint if exists applications_solution_stage_check;
alter table public.applications
  add constraint applications_solution_stage_check
  check (
    solution_stage is null
    or solution_stage in (
      -- Current wizard options
      'Still exploring',
      'Literature / research stage',
      'Simulations completed',
      'Lab demos / proof of concept',
      'Prototype built',
      'Pilot-ready product',
      'Deployed in real setting with real users',
      -- Legacy spellings preserved for older drafts
      'Still exploring problem area',
      'Lab demos / proof-of-concept'
    )
  );

commit;
