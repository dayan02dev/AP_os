-- Revoke JURY access from test accounts — Supabase Studio SQL editor fallback
-- for scripts/revoke_jury_access.py (same effect, no local env needed).
--
-- Removes jury_selections / jury_assignments / jury_recommendations /
-- jury_profiles / jury_invites and the `jury` row in user_roles.
--
-- NEVER touches auth.users, and never touches any other role — an admin or
-- leadership account that happened to also be a juror keeps working everywhere
-- else. Applications stay in jury_review; they just become unassigned.
--
-- HOW TO USE
--   1. Edit the email list in the `targets` CTE below.
--   2. Run the SELECT block first (it is read-only) and eyeball the counts.
--   3. Then run the DO block to delete.

-- ── STEP 1 · PREVIEW (read-only) ────────────────────────────────────────────
with targets as (
  select p.id, p.email, p.full_name
    from public.profiles p
   where lower(p.email) in (
     'udita.uniyal1630@gmail.com',
     'udita@artpark.in',
     'dev@artpark.in'
     -- add any other test juror emails here
   )
)
select t.full_name,
       t.email,
       t.id as user_id,
       (select array_agg(r.role order by r.role)
          from public.user_roles r where r.user_id = t.id)              as roles_now,
       (select array_agg(r.role order by r.role)
          from public.user_roles r
         where r.user_id = t.id and r.role <> 'jury')                   as roles_after,
       (select count(*) from public.jury_selections      s where s.juror_user_id = t.id) as selections,
       (select count(*) from public.jury_assignments     a where a.juror_user_id = t.id) as assignments,
       (select count(*) from public.jury_recommendations c where c.juror_user_id = t.id) as recommendations,
       (select count(*) from public.jury_profiles        j where j.juror_user_id = t.id) as profile_rows,
       (select count(*) from public.jury_invites         i where lower(i.email) = lower(t.email)) as invites
  from targets t
 order by t.email;

-- To preview EVERY current jury-role holder instead, swap the `targets` CTE for:
--   with targets as (
--     select p.id, p.email, p.full_name from public.profiles p
--      where p.id in (select user_id from public.user_roles where role = 'jury')
--   )

-- ── STEP 2 · APPLY (deletes) ────────────────────────────────────────────────
-- Wrapped in a single transaction: either the whole revoke lands or none of it.
do $$
declare
  target_ids uuid[];
  target_emails text[];
begin
  -- Keep this list identical to the preview above.
  select array_agg(p.id), array_agg(lower(p.email))
    into target_ids, target_emails
    from public.profiles p
   where lower(p.email) in (
     'udita.uniyal1630@gmail.com',
     'udita@artpark.in',
     'dev@artpark.in'
   );
  -- For every jury-role holder instead, use:
  --   select array_agg(user_id), null into target_ids, target_emails
  --     from public.user_roles where role = 'jury';

  if target_ids is null or array_length(target_ids, 1) = 0 then
    raise notice 'No matching users — nothing revoked.';
    return;
  end if;

  delete from public.jury_selections      where juror_user_id = any(target_ids);
  delete from public.jury_assignments     where juror_user_id = any(target_ids);
  delete from public.jury_recommendations where juror_user_id = any(target_ids);
  delete from public.jury_profiles        where juror_user_id = any(target_ids);

  if target_emails is not null then
    delete from public.jury_invites where lower(email) = any(target_emails);
  end if;

  -- ONLY the jury role. Every other role row is left alone.
  delete from public.user_roles
   where user_id = any(target_ids) and role = 'jury';

  raise notice 'Jury access revoked for % user(s).', array_length(target_ids, 1);
end $$;

-- ── STEP 3 · VERIFY ─────────────────────────────────────────────────────────
-- Expect zero rows: nobody in the list still holds the jury role.
select p.email, r.role
  from public.user_roles r
  join public.profiles p on p.id = r.user_id
 where r.role = 'jury'
 order by p.email;
