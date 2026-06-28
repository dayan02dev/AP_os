-- 027_jury_review_decision.sql
-- Allow 'jury_review' as a gate-1 admin decision (admin "Approve" now advances
-- an application to the jury_review status). Mirrors the value already legal in
-- the application state machine. Idempotent: drop-if-exists then re-add.

alter table admin_decisions
  drop constraint if exists admin_decisions_decision_check;

alter table admin_decisions
  add constraint admin_decisions_decision_check
  check (decision in ('shortlisted','on_hold','rejected','waitlisted','jury_review'));
