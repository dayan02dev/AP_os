-- 035_comms_industry_category.sql
-- Adds the "Communication (Wired & Wireless)" domain as a permanent seed
-- category. Additive + idempotent — safe to apply any time (no deploy-order
-- risk; existing code keeps working). The AI classifier reads industry_categories
-- dynamically, so future submissions can be classified into it automatically.
insert into public.industry_categories (id, label, is_seed) values
  ('comms', 'Communication (Wired & Wireless)', true)
on conflict (id) do nothing;
