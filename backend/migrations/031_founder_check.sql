-- 031_founder_check.sql
-- Résumé-derived founder assessment for TIR apps: a 4-bullet verdict produced by
-- the founder_check LangGraph pipeline (multimodal OCR -> talent-scout). Nullable;
-- NULL for all SIP apps and for TIR apps with no résumé / not yet processed.
-- Idempotent.
alter table public.ai_screening
  add column if not exists founder_check jsonb;

comment on column public.ai_screening.founder_check is
  'AI founder assessment (TIR only): {"verdict","confidence","top_signals","gaps","whats_rare","model","ran_at"} - resume multimodal-OCR''d + judged by google/gemini-2.5-flash via the founder_check LangGraph pipeline (mig 031).';
