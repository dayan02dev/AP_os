-- 036: TIR<->VIP track-move flag (reversible reclassification).
-- Additive + nullable; moved_to_track IS NULL == "not moved". No backfill.
-- The application row stays in its own table with its original answers; these
-- columns only let the admin UI badge a reclassified application.
ALTER TABLE tir_applications
  ADD COLUMN IF NOT EXISTS moved_to_track text,
  ADD COLUMN IF NOT EXISTS moved_at       timestamptz,
  ADD COLUMN IF NOT EXISTS moved_by       uuid;

ALTER TABLE sip_applications
  ADD COLUMN IF NOT EXISTS moved_to_track text,
  ADD COLUMN IF NOT EXISTS moved_at       timestamptz,
  ADD COLUMN IF NOT EXISTS moved_by       uuid;
