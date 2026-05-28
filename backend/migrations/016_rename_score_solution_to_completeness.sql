-- 016_rename_score_solution_to_completeness.sql
--
-- Rename ai_screening.score_solution → ai_screening.score_completeness so
-- the column name matches what it actually stores per the AI scoring spec
-- at docs/superpowers/specs/2026-05-20-ai-scoring-langgraph-design.md §10.
--
-- The frontend leadership review surface already labels this bar
-- "Completeness & depth" (see AIScreeningPanel.jsx) — only the column
-- name was lying.
--
-- Idempotent: only renames if the old column still exists.

begin;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ai_screening'
      and column_name = 'score_solution'
  ) then
    alter table public.ai_screening
      rename column score_solution to score_completeness;
  end if;
end $$;

comment on column public.ai_screening.score_completeness is
  'Completeness & depth signal (0-10). Renamed from score_solution on 2026-05-20 '
  'to align with the AI scoring spec.';

comment on column public.ai_screening.score_integrity is
  'RESERVED / unused in AI scoring v1. The current scoring spec has no '
  'Integrity signal. Column retained to avoid disruptive migrations; '
  'do not write.';

commit;
