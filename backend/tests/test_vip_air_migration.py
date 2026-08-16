"""044 creates the AIR tables. These are VIP-only, so unlike the five shared
tables in 043 they keep real foreign keys."""
from pathlib import Path


def _sql() -> str:
    return Path("migrations/044_vip_air.sql").read_text().lower()


def test_creates_the_three_air_tables():
    sql = _sql()
    for table in ("vip_air_assessments", "vip_air_lever_scores", "vip_air_evidence"):
        assert f"create table if not exists public.{table}" in sql, table


def test_air_tables_keep_real_foreign_keys():
    """VIP-only, so referential integrity is available and must be used."""
    sql = _sql()
    assert "references public.sip_applications(id) on delete cascade" in sql
    assert sql.count("references public.vip_air_assessments(id) on delete cascade") == 2


def test_one_round_per_application_and_one_score_per_lever():
    sql = _sql()
    assert "unique (application_id, round_label)" in sql
    assert "unique (assessment_id, lever)" in sql


def test_status_and_lever_are_constrained():
    sql = _sql()
    assert "check (status in ('draft','submitted','verified'))" in sql
    assert "'scientific_principles'" in sql and "'reliability'" in sql


def test_levels_are_constrained_to_the_air_range():
    sql = _sql()
    assert sql.count("between 1 and 9") >= 3


def test_rls_enabled_with_no_policies():
    sql = _sql()
    assert sql.count("enable row level security") == 3
    assert "create policy" not in sql


def test_private_bucket_is_created():
    sql = _sql()
    assert "vip-founder-docs" in sql
    assert "storage.buckets" in sql
    assert "on conflict (id) do nothing" in sql


def test_migration_is_transactional():
    sql = _sql()
    assert "begin;" in sql
    assert sql.strip().endswith("commit;")
