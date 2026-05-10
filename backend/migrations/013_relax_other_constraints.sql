-- 013_relax_other_constraints.sql
--
-- Relax the strict CHECK constraints on basic_degree and basic_hear_about
-- so the wizard's "Other" path persists. The frontend stores an "Other"
-- selection plus its free-text as a single column value of the form
--   "<option label>: <free text>"
-- (e.g. "Self-taught / Other: Python autodidact" or "Other: heard from
-- a friend at IIT"). Postgres CHECK 23514 used to reject those rows,
-- which silently failed the PATCH and lost any other answers in the
-- same debounced batch.
--
-- Both basic_degree and basic_hear_about are open-ended-by-design (the
-- whole point of the "Other" option), so dropping the enum check is
-- the correct semantic. The columns stay typed `text` with NULL still
-- allowed, and Pydantic's per-field length cap on the API side
-- prevents abuse.
--
-- Idempotent: every DROP uses IF EXISTS so this can be re-applied.
-- Covers both sip_applications and tir_applications, plus the legacy
-- `applications_*` constraint names that may have survived the
-- migration-010 table rename.

begin;

-- ─── sip_applications ─────────────────────────────────────────────
alter table public.sip_applications
  drop constraint if exists sip_applications_basic_degree_check;
alter table public.sip_applications
  drop constraint if exists sip_applications_basic_hear_about_check;

-- ─── tir_applications (renamed from `applications` in migration 010) ─
alter table public.tir_applications
  drop constraint if exists tir_applications_basic_degree_check;
alter table public.tir_applications
  drop constraint if exists tir_applications_basic_hear_about_check;
-- Legacy names — Postgres doesn't auto-rename constraints when the
-- table is renamed, so the original CHECKs may still carry the old
-- prefix. Belt + braces:
alter table public.tir_applications
  drop constraint if exists applications_basic_degree_check;
alter table public.tir_applications
  drop constraint if exists applications_basic_hear_about_check;

commit;
