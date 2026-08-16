"""044 creates the AIR tables. These are VIP-only, so unlike the five shared
tables in 043 they keep real foreign keys."""
import re
from pathlib import Path


def _sql() -> str:
    return Path("migrations/044_vip_air.sql").read_text().lower()


def _evidence_table_block(sql: str) -> str:
    """Just the vip_air_evidence create-table statement, so a check that
    should apply to *that* table specifically can't be satisfied by the same
    pattern appearing in vip_air_lever_scores instead."""
    start = sql.index("create table if not exists public.vip_air_evidence")
    end = sql.index(");", start)
    return sql[start:end]


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


def test_evidence_rows_are_unique_per_lever_level_and_filename():
    """Re-uploading the exact same slot must collide at the DB level so the
    router can treat it as a replace rather than a duplicate; two
    differently-named documents for the same claimed level must not."""
    sql = _sql()
    assert "unique (assessment_id, lever, air_level, filename)" in sql


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


def test_bucket_is_private():
    """Mutation-proven: flipping `public` to true passes the rest of the
    suite today. AIR evidence documents are private artefacts served only
    through a short-lived signed URL — the bucket itself must say so."""
    assert "false" in _sql()


def test_evidence_lever_is_constrained_to_the_six_valid_levers():
    """Item 9: vip_air_evidence.lever had no CHECK at all, unlike
    vip_air_lever_scores.lever — a typo'd lever value would silently create
    a row assessment_bundle can never surface (it only ever looks up
    evidence by one of the six catalog keys)."""
    block = _evidence_table_block(_sql())
    assert "check (lever in (" in block
    for lever in ("scientific_principles", "architecture", "qualification",
                  "user_needs", "supply_chain", "reliability"):
        assert f"'{lever}'" in block, lever


def test_evidence_filename_is_not_null():
    """Item 9: unique (assessment_id, lever, air_level, filename) is
    defeated by NULLs — Postgres treats every NULL as distinct from every
    other NULL — unless filename is itself NOT NULL."""
    block = _evidence_table_block(_sql())
    assert re.search(r"\bfilename\s+text\s+not null\b", block)


def test_migration_is_transactional():
    sql = _sql()
    assert "begin;" in sql
    assert sql.strip().endswith("commit;")
