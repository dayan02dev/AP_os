-- 2026-10-24 data repair: re-key rows written under the EFFECTIVE track for
-- apps moved TIR->VIP (row lives in tir_applications, moved_to_track='sip').
-- Child tables must be keyed by the NATIVE track ('tir'). Found in prod on
-- 2026-10-24: 5 application_batches rows + 8 reviewer_assignments rows
-- (Defense: TIR-27061/26869/26822/26080 for V. S. Rawat; Manufacturing:
-- TIR-26079 for 4 reviewers).
--
-- Paste into Supabase Studio. Run STEP 1 alone first and check the counts
-- (expected 5 and 8), then run STEP 2 as one block, then STEP 1 again (expect 0/0).

-- STEP 1 — preview (read-only)
select 'application_batches' as tbl, count(*) from public.application_batches ab where ab.application_track = 'sip' and not exists (select 1 from public.sip_applications s where s.id = ab.application_id) and exists (select 1 from public.tir_applications t where t.id = ab.application_id)
union all
select 'reviewer_assignments', count(*) from public.reviewer_assignments ra where ra.application_track = 'sip' and not exists (select 1 from public.sip_applications s where s.id = ra.application_id) and exists (select 1 from public.tir_applications t where t.id = ra.application_id)
union all
-- sanity only (expected 0; STEP 2 does not touch these — tell Claude if non-zero)
select 'reviews (check only)', count(*) from public.reviews rv where rv.application_track = 'sip' and not exists (select 1 from public.sip_applications s where s.id = rv.application_id) and exists (select 1 from public.tir_applications t where t.id = rv.application_id)
union all
select 'admin_decisions (check only)', count(*) from public.admin_decisions d where d.application_track = 'sip' and not exists (select 1 from public.sip_applications s where s.id = d.application_id) and exists (select 1 from public.tir_applications t where t.id = d.application_id);

-- STEP 2 — repair
begin;

-- application_batches: re-key to 'tir' unless the native row already exists, then drop leftovers.
update public.application_batches ab set application_track = 'tir' where ab.application_track = 'sip' and not exists (select 1 from public.sip_applications s where s.id = ab.application_id) and exists (select 1 from public.tir_applications t where t.id = ab.application_id) and not exists (select 1 from public.application_batches x where x.application_id = ab.application_id and x.application_track = 'tir' and x.batch_id = ab.batch_id);
delete from public.application_batches ab where ab.application_track = 'sip' and not exists (select 1 from public.sip_applications s where s.id = ab.application_id) and exists (select 1 from public.tir_applications t where t.id = ab.application_id);

-- reviewer_assignments: same, unique key is (application_id, application_track, reviewer_user_id).
update public.reviewer_assignments ra set application_track = 'tir' where ra.application_track = 'sip' and not exists (select 1 from public.sip_applications s where s.id = ra.application_id) and exists (select 1 from public.tir_applications t where t.id = ra.application_id) and not exists (select 1 from public.reviewer_assignments x where x.application_id = ra.application_id and x.application_track = 'tir' and x.reviewer_user_id = ra.reviewer_user_id);
delete from public.reviewer_assignments ra where ra.application_track = 'sip' and not exists (select 1 from public.sip_applications s where s.id = ra.application_id) and exists (select 1 from public.tir_applications t where t.id = ra.application_id);

commit;
