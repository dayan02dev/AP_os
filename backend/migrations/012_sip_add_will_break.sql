-- 012_sip_add_will_break.sql
--
-- Adds back execution_will_break to sip_applications. Migration 011 dropped
-- it as "TIR-only", but the SIP wizard's Section 04 (Execution Plan) still
-- asks Q.17 ("What technical hurdles did you overcome to get this deployed
-- in the real world?") and saves were silently failing because the column
-- didn't exist. Adding it restores end-to-end persistence for that answer.
--
-- Idempotent.

begin;

alter table public.sip_applications
  add column if not exists execution_will_break text;

commit;
