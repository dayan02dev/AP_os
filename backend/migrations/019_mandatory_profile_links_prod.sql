-- 019_mandatory_profile_links_prod.sql
--
-- PROD variant of migration 019. Operates on the legacy `applications`
-- table (prod has not yet had migration 010's track-split applied, so
-- there is no tir_applications/sip_applications pair in prod).
--
-- Same logical change as 019_mandatory_profile_links_staging.sql — keep
-- both files in sync if the staging schema is ever ported back to prod.
--
-- Existing 87 submitted application rows are grandfathered: columns are
-- NULL-allowed so nothing about historical data changes. The submit-time
-- validator (backend, shipped separately) is what makes the fields
-- mandatory for new submissions going forward.
--
-- Applied to prod Supabase project `xtmszlpwgbyoumalgbhs` on 2026-05-22.
-- Re-runnable: DROP CONSTRAINT IF EXISTS + IF NOT EXISTS on columns.

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS resume_file_id uuid,
  ADD COLUMN IF NOT EXISTS linkedin_url   text,
  ADD COLUMN IF NOT EXISTS github_url     text;

ALTER TABLE applications DROP CONSTRAINT IF EXISTS linkedin_url_format;
ALTER TABLE applications DROP CONSTRAINT IF EXISTS github_url_format;
ALTER TABLE applications DROP CONSTRAINT IF EXISTS linkedin_url_len;
ALTER TABLE applications DROP CONSTRAINT IF EXISTS github_url_len;

ALTER TABLE applications
  ADD CONSTRAINT linkedin_url_format
    CHECK (linkedin_url IS NULL OR linkedin_url ~* 'linkedin\.com/');

ALTER TABLE applications
  ADD CONSTRAINT github_url_format
    CHECK (github_url IS NULL OR github_url ~* 'github\.com/');

ALTER TABLE applications
  ADD CONSTRAINT linkedin_url_len
    CHECK (linkedin_url IS NULL OR length(linkedin_url) <= 500);

ALTER TABLE applications
  ADD CONSTRAINT github_url_len
    CHECK (github_url IS NULL OR length(github_url) <= 500);
