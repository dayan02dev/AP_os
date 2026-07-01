-- 028_ai_sections.sql
-- Store the four AI analyst sections (problem / solution / moats / watchouts),
-- each a list of bullet strings, produced by ai_pipeline.SectionAgent and written
-- through the existing ai_screening upsert (on_conflict application_id,application_track).
-- Nullable: null until generated (new submit) or backfilled. Idempotent.
alter table public.ai_screening
  add column if not exists sections jsonb;

comment on column public.ai_screening.sections is
  'AI analyst sections: {"problem":[...],"solution":[...],"moats":[...],"watchouts":[...]} — bullet lists, gemini-2.5-flash via ai_pipeline.SectionAgent (mig 028).';
