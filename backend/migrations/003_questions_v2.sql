-- 003_questions_v2.sql — Bucket 3 schema additions for the manager's spec.
--
-- Adds 5 nullable columns to public.applications. Does NOT drop any
-- existing columns — already-submitted applications keep their data in
-- the legacy columns (basic_incubators, solution_ten_x, solution_hurdles,
-- solution_moat, solution_national_scale, solution_customers,
-- execution_budget, evidence_deck, problem_importance) even though the
-- new wizard no longer asks those questions.
--
-- Run before deploying the Bucket 3 backend changes; idempotent.

begin;

alter table public.applications
  add column if not exists basic_incubator_association   text,
  add column if not exists basic_incubator_details       text,
  add column if not exists solution_contrarian_insight   text,
  add column if not exists execution_infrastructure      text,
  add column if not exists execution_hwsw_integration    text;

-- Constrain the Yes/No question so the column matches the UI options.
alter table public.applications
  drop constraint if exists applications_incubator_assoc_check;
alter table public.applications
  add constraint applications_incubator_assoc_check
  check (
    basic_incubator_association is null
    or basic_incubator_association in ('Yes', 'No')
  );

commit;
