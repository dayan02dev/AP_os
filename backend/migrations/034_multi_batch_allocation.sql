-- 034_multi_batch_allocation.sql
-- Multi-batch allocation: an application may belong to many batches, and a
-- reviewer may be a member of many batches. `batch_reviewers` is the source of
-- truth for reviewer<->batch membership; `application_batches` is relaxed from
-- one-batch-per-app to many; membership is backfilled from
-- reviewer_profiles.batch_id. Idempotent / re-runnable.
--
-- DEPLOY-ORDER: apply TOGETHER WITH the matching backend code. Applied against
-- pre-feature code it breaks POST /admin/platform/batches/{id}/applications,
-- whose upsert used ON CONFLICT (application_id, application_track) — the very
-- constraint step 2 drops.

begin;

-- 1. reviewer <-> batch membership (many-to-many)
create table if not exists public.batch_reviewers (
  batch_id         uuid not null references public.batches(id) on delete cascade,
  reviewer_user_id uuid not null references auth.users(id) on delete cascade,
  added_by         uuid,
  added_at         timestamptz not null default now(),
  primary key (batch_id, reviewer_user_id)
);
alter table public.batch_reviewers enable row level security;
create index if not exists idx_batch_reviewers_reviewer
  on public.batch_reviewers(reviewer_user_id);

-- 2. relax application_batches: one-batch-per-app -> many-batches-per-app.
--    Drop the old 2-col unique constraint (matched by column set, name-agnostic),
--    then add the 3-col unique so an app can't be in the same batch twice.
do $$
declare c text;
begin
  select con.conname into c
  from   pg_constraint con
  join   pg_class rel on rel.oid = con.conrelid
  join   pg_namespace ns on ns.oid = rel.relnamespace
  where  ns.nspname = 'public'
    and  rel.relname = 'application_batches'
    and  con.contype = 'u'
    and  ( select array_agg(a.attname::text order by a.attname::text)
           from   unnest(con.conkey) as k(attnum)
           join   pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
         ) = array['application_id','application_track']
  limit 1;
  if c is not null then
    execute format('alter table public.application_batches drop constraint %I', c);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_batches_app_track_batch_key'
      and conrelid = 'public.application_batches'::regclass
  ) then
    alter table public.application_batches
      add constraint application_batches_app_track_batch_key
      unique (application_id, application_track, batch_id);
  end if;
end $$;

-- 3. backfill membership from each reviewer's current home batch (non-destructive)
insert into public.batch_reviewers (batch_id, reviewer_user_id)
select rp.batch_id, rp.reviewer_user_id
from   public.reviewer_profiles rp
where  rp.batch_id is not null
on conflict (batch_id, reviewer_user_id) do nothing;

commit;
