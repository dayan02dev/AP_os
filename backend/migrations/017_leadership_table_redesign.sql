-- 017_leadership_table_redesign.sql
-- Adds industry_categories taxonomy + ai_screening industry columns + per-track display_seq.
-- Idempotent where possible (IF NOT EXISTS, WHERE display_seq IS NULL).
-- Run once per environment via Supabase SQL editor.
--
-- Staging Supabase (exqmxvdtcsvpgtftwjml) had this content applied
-- out-of-band on 2026-05-20; this file exists so the prod deploy follows
-- the standard migration path.

BEGIN;

-- 1. industry_categories table + 7 seeds
CREATE TABLE IF NOT EXISTS industry_categories (
  id text PRIMARY KEY,
  label text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now(),
  created_by_app_id uuid,
  is_seed boolean DEFAULT false
);

INSERT INTO industry_categories (id, label, is_seed) VALUES
  ('robotics', 'Robotics & Automation',                         true),
  ('health',   'Healthcare / MedTech',                          true),
  ('industry', 'Advanced Manufacturing / Industry 5.0',         true),
  ('defense',  'Defense & Aerospace',                           true),
  ('ai',       'Artificial Intelligence / Foundational Models', true),
  ('semi',     'Semiconductor / Hardware',                      true),
  ('other',    'Other / Frontier',                              true)
ON CONFLICT (id) DO NOTHING;

-- 2. ai_screening new columns
ALTER TABLE ai_screening
  ADD COLUMN IF NOT EXISTS industry_category_id text
    REFERENCES industry_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS industry_confidence numeric(3,2);

CREATE INDEX IF NOT EXISTS idx_ai_screening_industry_category
  ON ai_screening (industry_category_id);

-- 3. display_seq columns + sequences
ALTER TABLE tir_applications ADD COLUMN IF NOT EXISTS display_seq integer UNIQUE;
ALTER TABLE sip_applications ADD COLUMN IF NOT EXISTS display_seq integer UNIQUE;

CREATE SEQUENCE IF NOT EXISTS tir_display_seq START 26001;
CREATE SEQUENCE IF NOT EXISTS sip_display_seq START 26001;

-- 4. Backfill display_seq for existing rows (oldest first)
WITH ordered AS (
  SELECT id,
         ROW_NUMBER() OVER (ORDER BY submitted_at ASC NULLS LAST, created_at ASC) + 26000 AS seq
    FROM tir_applications
)
UPDATE tir_applications t
   SET display_seq = o.seq
  FROM ordered o
 WHERE t.id = o.id
   AND t.display_seq IS NULL;

WITH ordered AS (
  SELECT id,
         ROW_NUMBER() OVER (ORDER BY submitted_at ASC NULLS LAST, created_at ASC) + 26000 AS seq
    FROM sip_applications
)
UPDATE sip_applications s
   SET display_seq = o.seq
  FROM ordered o
 WHERE s.id = o.id
   AND s.display_seq IS NULL;

-- 5. Bump sequences past the backfilled max so future inserts don't collide
SELECT setval('tir_display_seq', COALESCE((SELECT MAX(display_seq) FROM tir_applications), 26000));
SELECT setval('sip_display_seq', COALESCE((SELECT MAX(display_seq) FROM sip_applications), 26000));

-- 6. Defaults + NOT NULL on display_seq for future inserts
ALTER TABLE tir_applications ALTER COLUMN display_seq SET DEFAULT nextval('tir_display_seq');
ALTER TABLE tir_applications ALTER COLUMN display_seq SET NOT NULL;

ALTER TABLE sip_applications ALTER COLUMN display_seq SET DEFAULT nextval('sip_display_seq');
ALTER TABLE sip_applications ALTER COLUMN display_seq SET NOT NULL;

COMMIT;
