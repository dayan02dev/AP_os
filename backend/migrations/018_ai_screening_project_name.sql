-- 018_ai_screening_project_name.sql
-- Adds ai_screening.project_name — the founder-stated project/venture name
-- extracted by the AI screener in the same LLM call that scores + classifies
-- the application. The leadership Applications table prefers this over the
-- heuristic derived from solution_describe.
-- Idempotent (IF NOT EXISTS). Run once per environment via Supabase SQL editor.
--
-- Existing rows stay NULL until backfilled (scripts/backfill_industry.py now
-- also fills project_name) or re-screened. The leadership router falls back to
-- the solution_describe heuristic when project_name is NULL, so the column is
-- safe to ship before the backfill runs.

BEGIN;

ALTER TABLE ai_screening
  ADD COLUMN IF NOT EXISTS project_name text;

COMMIT;
