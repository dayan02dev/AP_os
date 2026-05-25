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
-- The trigger fires AFTER INSERT on auth.users — i.e. on every signup
-- regardless of provider (email/password, OTP, magic link). It runs
-- with SECURITY DEFINER so the supabase_auth_admin role (which owns
-- auth.users writes) can insert into public.user_roles without RLS
-- friction.
--
-- Idempotent. ON CONFLICT DO NOTHING covers re-running both the
-- backfill and the trigger insert.

begin;

-- ─── 1. Trigger function ────────────────────────────────────────────
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

-- ─── 2. Trigger on auth.users ───────────────────────────────────────
drop trigger if exists auto_assign_applicant_role on auth.users;
create trigger auto_assign_applicant_role
  after insert on auth.users
  for each row
  execute function public.assign_applicant_role_on_signup();

-- ─── 3. Backfill existing accounts ──────────────────────────────────
-- Every auth.users id that doesn't already have an applicant row gets
-- one, with granted_by = their own id (matches the convention used by
-- 014 — self-granted manual roles also reference the same user_id).
insert into public.user_roles (user_id, role, granted_by)
select u.id, 'applicant', u.id
from auth.users u
where not exists (
  select 1 from public.user_roles r
  where r.user_id = u.id and r.role = 'applicant'
)
on conflict (user_id, role) do nothing;

commit;
