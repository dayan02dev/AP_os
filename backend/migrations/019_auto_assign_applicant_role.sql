-- 019_auto_assign_applicant_role.sql
--
-- Auto-grant the 'applicant' role to every newly-signed-up user, and
-- backfill existing accounts that don't already carry it.
--
-- Context (incident 2026-05-25): dev@artpark.in (admin + leadership +
-- reviewer, but NOT applicant) submitted an SIP application via
-- /apply-sip on staging. The wizard had no way to surface their own
-- past submissions or let them continue editing as an applicant —
-- 14_admin_platform_phase1.sql carries no default role assignment,
-- and only manually-granted reviewer/leadership/admin rows exist in
-- user_roles. Listed as a Phase 1 gap in the project memory.
--
-- 'applicant' is the lowest-trust role on the user_roles CHECK list
-- (see 014_admin_platform_phase1.sql). Granting it is non-privileged:
-- it does NOT touch active_role (UI navigation hint, set elsewhere)
-- and it does NOT remove any other role the account already has, so
-- multi-role users (e.g. dev@artpark.in) keep their portal access.
--
-- Trigger target — public.profiles, NOT auth.users:
-- Supabase Studio's SQL Editor runs as the `postgres` role, but
-- auth.users is owned by `supabase_auth_admin`. CREATE TRIGGER on
-- auth.users completes without raising an error from the Studio but
-- the trigger never actually attaches. Hooking into public.profiles
-- instead — which Supabase's own handle_new_user trigger populates
-- on every signup — gives us a public-schema attach point that
-- consistently fires. Verified 2026-05-25 via admin-API signup
-- smoke test (uid 4b93d9c6 received the applicant row on
-- profiles insert; cascade-delete cleared it).
--
-- Idempotent. ON CONFLICT DO NOTHING covers re-running both the
-- backfill and the trigger insert.

begin;

create or replace function public.assign_applicant_role_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.user_roles (user_id, role, granted_by)
  values (new.id, 'applicant', new.id)
  on conflict (user_id, role) do nothing;
  return new;
end;
$$;

comment on function public.assign_applicant_role_on_signup() is
  'Grants applicant role on signup. See 019_auto_assign_applicant_role.sql.';

-- Drop any stale attempt on auth.users from earlier revisions of this
-- migration before the public.profiles approach was settled on.
drop trigger if exists auto_assign_applicant_role on auth.users;
drop trigger if exists auto_assign_applicant_role on public.profiles;

create trigger auto_assign_applicant_role
  after insert on public.profiles
  for each row
  execute function public.assign_applicant_role_on_signup();

insert into public.user_roles (user_id, role, granted_by)
select p.id, 'applicant', p.id
from public.profiles p
where not exists (
  select 1 from public.user_roles r
  where r.user_id = p.id and r.role = 'applicant'
)
on conflict (user_id, role) do nothing;

commit;
