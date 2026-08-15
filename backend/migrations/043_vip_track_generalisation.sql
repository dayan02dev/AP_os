-- 043_vip_track_generalisation.sql — let VIP (track 'sip') founders use the
-- shared half of the Founder Portal.
--
-- Only five founder_* tables are genuinely shared between the two tracks:
-- the MOU and the four Founders-Resources tables. The eight TIR-only cohort
-- tables (experiments, tasks, review, team_members, approach, bom_items,
-- equipment_items, procurement_items) are deliberately NOT touched — VIP has
-- its own cohort-management sections and never reads them.
--
-- The FK to tir_applications(id) has to go: Postgres has no polymorphic
-- foreign key, and application_id may now point at either tir_applications or
-- sip_applications. The exposure is contained — RLS denies every non
-- service-role writer, the /founder router is the only writer and it enforces
-- ownership, and applications are never hard-deleted in this system.
--
-- Additive and re-runnable. Existing rows take the 'tir' default.

begin;

-- 1) founder_mou ----------------------------------------------------------
alter table public.founder_mou
  add column if not exists track text not null default 'tir';
alter table public.founder_mou
  drop constraint if exists founder_mou_track_check;
alter table public.founder_mou
  add constraint founder_mou_track_check check (track in ('tir','sip'));
alter table public.founder_mou
  drop constraint if exists founder_mou_application_id_fkey;
-- one MOU per application PER TRACK (was: one per application_id globally)
alter table public.founder_mou
  drop constraint if exists founder_mou_application_id_key;
create unique index if not exists founder_mou_track_application_uidx
  on public.founder_mou (track, application_id);

-- 2) founder_cart_items ---------------------------------------------------
alter table public.founder_cart_items
  add column if not exists track text not null default 'tir';
alter table public.founder_cart_items
  drop constraint if exists founder_cart_items_track_check;
alter table public.founder_cart_items
  add constraint founder_cart_items_track_check check (track in ('tir','sip'));
alter table public.founder_cart_items
  drop constraint if exists founder_cart_items_application_id_fkey;
create index if not exists idx_founder_cart_track_app
  on public.founder_cart_items (track, application_id);

-- 3) founder_resource_requests --------------------------------------------
alter table public.founder_resource_requests
  add column if not exists track text not null default 'tir';
alter table public.founder_resource_requests
  drop constraint if exists founder_resource_requests_track_check;
alter table public.founder_resource_requests
  add constraint founder_resource_requests_track_check check (track in ('tir','sip'));
alter table public.founder_resource_requests
  drop constraint if exists founder_resource_requests_application_id_fkey;
create index if not exists idx_founder_requests_track_app
  on public.founder_resource_requests (track, application_id);

-- 4) founder_bookings -----------------------------------------------------
alter table public.founder_bookings
  add column if not exists track text not null default 'tir';
alter table public.founder_bookings
  drop constraint if exists founder_bookings_track_check;
alter table public.founder_bookings
  add constraint founder_bookings_track_check check (track in ('tir','sip'));
alter table public.founder_bookings
  drop constraint if exists founder_bookings_application_id_fkey;
create index if not exists idx_founder_bookings_track_app
  on public.founder_bookings (track, application_id);

-- 5) founder_tickets ------------------------------------------------------
alter table public.founder_tickets
  add column if not exists track text not null default 'tir';
alter table public.founder_tickets
  drop constraint if exists founder_tickets_track_check;
alter table public.founder_tickets
  add constraint founder_tickets_track_check check (track in ('tir','sip'));
alter table public.founder_tickets
  drop constraint if exists founder_tickets_application_id_fkey;
create index if not exists idx_founder_tickets_track_app
  on public.founder_tickets (track, application_id);

commit;
