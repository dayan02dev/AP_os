-- Migration 022 — Seed reviewer role for the V2 pilot accounts.
--
-- RUN MANUALLY in the Supabase SQL editor against the production
-- project. This file is committed for traceability; it is NOT
-- auto-applied by any deploy step.
--
-- Safe to re-run. Skips emails whose auth.users row doesn't exist yet.
-- Skips accounts that already have the reviewer role (ON CONFLICT DO NOTHING).
--
-- Table: public.user_roles (created in 014_admin_platform_phase1.sql)
-- Role value: 'reviewer' (one of the allowed values in the CHECK constraint)

do $$
declare
  v_uid   uuid;
  v_email text;
  v_pilot_emails text[] := array[
    'udayan.pawar@artpark.in',
    'sanjay.haritwal@artpark.in',
    'dev@artpark.in'
  ];
begin
  foreach v_email in array v_pilot_emails loop
    -- Resolve the Supabase Auth user id for this email.
    select id
      into v_uid
      from auth.users
     where email = v_email
     limit 1;

    if v_uid is null then
      raise notice 'User not found in auth.users: % — skipping', v_email;
      continue;
    end if;

    insert into public.user_roles (user_id, role, granted_by, granted_at)
    values (v_uid, 'reviewer', null, now())
    on conflict (user_id, role) do nothing;

    raise notice 'Granted reviewer role to % (%)', v_email, v_uid;
  end loop;
end $$;
