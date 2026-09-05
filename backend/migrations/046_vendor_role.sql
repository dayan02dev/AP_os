-- 046_vendor_role.sql
--
-- Adds the `vendor` role. This is the ONLY schema change the Art Infra vendor
-- portal needs today: Phase 1 is UI + API contract only and runs entirely on an
-- in-memory mock, so none of the art_infra_* tables exist yet. Those arrive in
-- 047_art_infra_catalog.sql, after the UI is signed off.
--
-- Staging first. Production is at 042 and must NOT get this until the portal
-- ships. Idempotent: safe to re-run.
--
-- Verified on staging 2026-09-06: user_roles_role_check currently accepts
-- exactly applicant, founder, reviewer, jury, mentor, leadership, admin --
-- and rejects vendor with 23514.

-- ---------------------------------------------------------------------------
-- 1. Widen the role CHECK constraint.
-- ---------------------------------------------------------------------------
-- The ADD fails loudly if any existing row would violate the new list, so this
-- cannot silently drop a role that is already in use.

alter table public.user_roles drop constraint if exists user_roles_role_check;

alter table public.user_roles add constraint user_roles_role_check
  check (role in ('applicant','founder','reviewer','jury','mentor','leadership','admin','vendor'));

-- ---------------------------------------------------------------------------
-- 2. Grant the role to a test account.
-- ---------------------------------------------------------------------------
-- Change the email if you want a different tester. Idempotent via on conflict.
-- If the email does not exist, this inserts nothing rather than erroring.

insert into public.user_roles (user_id, role, granted_by)
select p.id, 'vendor', p.id
from public.profiles p
where p.email = 'artinfra.test@artpark.in'
on conflict (user_id, role) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Verify. Run these after the two statements above.
-- ---------------------------------------------------------------------------

-- 3a. The constraint now lists vendor:
select pg_get_constraintdef(oid) as role_check
from pg_constraint
where conname = 'user_roles_role_check';

-- 3b. The test account holds it:
select p.email, r.role
from public.user_roles r
join public.profiles p on p.id = r.user_id
where p.email = 'artinfra.test@artpark.in'
order by r.role;

-- 3c. Nothing else changed -- role counts across the table:
select role, count(*) as holders
from public.user_roles
group by role
order by role;
