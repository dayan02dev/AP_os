-- 021_sip_team_and_dpiit.sql
--
-- Adds two missing SIP wizard concepts to the sip_applications table:
--
--   1) co-founder collaboration (mirrors TIR's basic_has_team + basic_teammates).
--      Before this, SIP only carried a cap-table list (sip_founders) and had no
--      way to record whether the applicant is solo OR to invite co-founders to
--      collaborate on the application.
--
--   2) DPIIT registration. The wizard already showed a "Is your startup DPIIT
--      registered?" page (questions_sip.jsx: sipDpiit), but it was flagged
--      `localOnly: true` because no columns existed for it — the value lived in
--      AppSip's in-memory `localExtras` and never reached the database. After
--      this migration, the frontend wires sipDpiit → these three columns via
--      fieldMap-sip.js's expandForPatch special case.
--
-- All five columns are NULL-allowed so existing rows (sip_applications has
-- pre-migration submitted apps) stay valid. basic_teammates carries a non-null
-- empty-jsonb-array default to match the TIR convention from migration 001
-- (lets the frontend append without first creating the column value).
--
-- CHECK constraints mirror the TIR enum strings exactly so a copy-pasted
-- value from one track to the other doesn't surprise anyone.
--
-- Idempotent: `add column if not exists` + `drop constraint if exists`.

begin;

alter table sip_applications
  add column if not exists basic_has_team                 text,
  add column if not exists basic_teammates                jsonb not null default '[]'::jsonb,
  add column if not exists basic_dpiit_registered         text,
  add column if not exists basic_dpiit_recognition_number text,
  add column if not exists basic_dpiit_recognition_date   date;

alter table sip_applications
  drop constraint if exists sip_basic_has_team_check;
alter table sip_applications
  add constraint sip_basic_has_team_check
    check (
      basic_has_team is null
      or basic_has_team in ('Yes — I have co-founders', 'No — going solo for now')
    );

alter table sip_applications
  drop constraint if exists sip_basic_dpiit_registered_check;
alter table sip_applications
  add constraint sip_basic_dpiit_registered_check
    check (
      basic_dpiit_registered is null
      or basic_dpiit_registered in ('Yes — we''re DPIIT recognised', 'No — not yet')
    );

alter table sip_applications
  drop constraint if exists sip_basic_dpiit_recognition_number_len;
alter table sip_applications
  add constraint sip_basic_dpiit_recognition_number_len
    check (
      basic_dpiit_recognition_number is null
      or length(basic_dpiit_recognition_number) <= 100
    );

commit;
