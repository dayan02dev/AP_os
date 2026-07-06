-- 032: evidence re-collection tokens
ALTER TABLE profile_completion_tokens
  ADD COLUMN IF NOT EXISTS needs_evidence boolean NOT NULL DEFAULT false;
