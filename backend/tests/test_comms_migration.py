from pathlib import Path


def test_migration_035_is_idempotent_insert():
    sql = Path("migrations/035_comms_industry_category.sql").read_text().lower()
    assert "insert into public.industry_categories" in sql
    assert "'comms'" in sql
    assert "communication (wired & wireless)" in sql
    assert "on conflict (id) do nothing" in sql   # re-runnable
    assert "is_seed" in sql                          # permanent taxonomy
