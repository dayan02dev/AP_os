-- 015_expand_application_status_check.sql
--
-- Migration 014 introduced the Phase 1 admin platform (spec §4.8 status
-- state machine) but left the application tables' status CHECK constraints
-- at the pre-Phase-1 set. Result: PATCH /leadership/applications/{id}/status
-- accepts legal transitions like `under_review → evaluated` per the
-- backend state machine, but the underlying UPDATE fails with 23514 because
-- the CHECK constraint rejects the new status value. The Session 8 seed
-- script surfaced this against staging when 18 of 40 synthetic apps failed
-- to insert with their assigned statuses.
--
-- This migration drops + recreates both tables' status CHECK constraints
-- with the full spec §4.8 status set:
--   draft, submitted, ai_screening, screening_failed, under_review,
--   evaluated, shortlisted, interview, offered, onboarded, rejected,
--   waitlisted, withdrawn
--
-- The legacy 'accepted' status (present in the original tir_applications
-- constraint but unused in spec §4.8) is preserved in the new set for
-- backward compatibility with any historical rows. Phase 2 may retire it.
--
-- Idempotent: every drop uses IF EXISTS so re-running this against an
-- already-migrated DB is a no-op. Safe to re-run against staging or to
-- apply to a fresh prod DB after migrations 010 / 011.
--
-- Applied: 2026-05-14 to staging Supabase (exqmxvdtcsvpgtftwjml) via
-- Supabase SQL editor.

begin;

-- ─── tir_applications.status ────────────────────────────────────────
-- The original constraint name dates back to migration 001 when the table
-- was called `applications`; migration 010 renamed the table to
-- tir_applications but the constraint name stayed `applications_status_check`.

alter table public.tir_applications
  drop constraint if exists applications_status_check;

alter table public.tir_applications
  drop constraint if exists tir_applications_status_check;

alter table public.tir_applications
  add constraint tir_applications_status_check
  check (status in (
    'draft', 'submitted', 'ai_screening', 'screening_failed',
    'under_review', 'evaluated',
    'shortlisted', 'interview', 'offered', 'onboarded',
    'rejected', 'waitlisted', 'withdrawn',
    'accepted'  -- legacy; retained for back-compat, see header comment
  ));

-- ─── sip_applications.status ────────────────────────────────────────

alter table public.sip_applications
  drop constraint if exists sip_applications_status_check;

alter table public.sip_applications
  add constraint sip_applications_status_check
  check (status in (
    'draft', 'submitted', 'ai_screening', 'screening_failed',
    'under_review', 'evaluated',
    'shortlisted', 'interview', 'offered', 'onboarded',
    'rejected', 'waitlisted', 'withdrawn',
    'accepted'
  ));

commit;
