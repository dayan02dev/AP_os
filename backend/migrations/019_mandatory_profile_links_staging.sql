-- 019_mandatory_profile_links_staging.sql
--
-- Adds the three columns that back the new mandatory wizard fields:
--   resume_file_id  uuid  -- key into the `resumes` storage bucket
--   linkedin_url    text
--   github_url      text
--
-- All three are NULL-allowed so existing rows (submitted before this rule
-- shipped) remain valid. The submit-time validator in the backend is what
-- enforces non-null + format on NEW submissions going forward.
--
-- Check constraints are deliberately lightweight: a simple substring match on
-- linkedin.com / github.com plus a 500-char length cap. We don't reach out
-- to LinkedIn or the GitHub API at insert time — the regex is enough to
-- catch obvious typos without coupling submit latency to a third party.
--
-- This file is the STAGING variant. It operates on `tir_applications`
-- (the post-migration-010 split table). SIP track is intentionally NOT
-- changed in this round — only TIR wizard requires these fields. The prod
-- variant (019_mandatory_profile_links_prod.sql) operates on the legacy
-- `applications` table since prod is still on the pre-010 schema.
--
-- Applied to staging Supabase project `exqmxvdtcsvpgtftwjml` on 2026-05-22.
-- Re-runnable: DROP CONSTRAINT IF EXISTS + IF NOT EXISTS on columns.

ALTER TABLE tir_applications
  ADD COLUMN IF NOT EXISTS resume_file_id uuid,
  ADD COLUMN IF NOT EXISTS linkedin_url   text,
  ADD COLUMN IF NOT EXISTS github_url     text;

ALTER TABLE tir_applications DROP CONSTRAINT IF EXISTS linkedin_url_format;
ALTER TABLE tir_applications DROP CONSTRAINT IF EXISTS github_url_format;
ALTER TABLE tir_applications DROP CONSTRAINT IF EXISTS linkedin_url_len;
ALTER TABLE tir_applications DROP CONSTRAINT IF EXISTS github_url_len;

ALTER TABLE tir_applications
  ADD CONSTRAINT linkedin_url_format
    CHECK (linkedin_url IS NULL OR linkedin_url ~* 'linkedin\.com/');

ALTER TABLE tir_applications
  ADD CONSTRAINT github_url_format
    CHECK (github_url IS NULL OR github_url ~* 'github\.com/');

ALTER TABLE tir_applications
  ADD CONSTRAINT linkedin_url_len
    CHECK (linkedin_url IS NULL OR length(linkedin_url) <= 500);

ALTER TABLE tir_applications
  ADD CONSTRAINT github_url_len
    CHECK (github_url IS NULL OR length(github_url) <= 500);
