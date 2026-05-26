-- audit_test_data.sql — read-only test-row audit for prod pre-cutover.
--
-- Identifies applications whose owner email looks like test data, so a human
-- operator can decide which (if any) rows to DELETE before the cutover
-- migrations apply. Do NOT DELETE based on this output blindly.
--
-- Run pre-cutover against the OLD `applications` table.
-- After migration 010, the same query applies to `tir_applications`.

SELECT
  a.id,
  a.user_id,
  p.email,
  a.status,
  a.submitted_at,
  a.created_at,
  a.updated_at
FROM applications a
JOIN profiles p ON p.id = a.user_id
WHERE p.email ILIKE '%@artpark.test'
   OR p.email ILIKE '%@example.%'
   OR p.email ILIKE '%+test%@%'
   OR p.email ILIKE 'test%@%'
   OR p.email ILIKE 'demo%@%'
ORDER BY a.created_at DESC;
