-- 025: capture LinkedIn / GitHub / resume on SIP applications (parity with TIR).
--
-- TIR got these in 019 (resume_file_id / linkedin_url / github_url). SIP applies
-- the same three columns so founder profile links + CV are stored for SIP too.
--
--   resume_file_id  uuid  -- key into the `resumes` storage bucket (no FK, mirrors TIR)
--   linkedin_url    text
--   github_url      text
--
-- No format CHECK constraints: TIR's linkedin/github format checks were dropped
-- during the SIP cutover (they caused false 422s on valid-but-unusual URLs).
-- URL validation lives in the API layer instead. Idempotent — safe to re-run.

ALTER TABLE sip_applications
  ADD COLUMN IF NOT EXISTS resume_file_id uuid,
  ADD COLUMN IF NOT EXISTS linkedin_url   text,
  ADD COLUMN IF NOT EXISTS github_url     text;
