"""043 must make every genuinely-shared founder table track-aware.

Guard test: if someone later adds a sixth table shared between TIR and VIP
they must add it here too, or a VIP founder silently reads TIR rows.
"""
from pathlib import Path

SHARED_TABLES = [
    "founder_mou",
    "founder_cart_items",
    "founder_resource_requests",
    "founder_bookings",
    "founder_tickets",
]


def _sql() -> str:
    return Path("migrations/043_vip_track_generalisation.sql").read_text().lower()


def test_every_shared_table_gains_a_track_column():
    sql = _sql()
    for table in SHARED_TABLES:
        assert f"alter table public.{table}" in sql, table
    assert sql.count("add column if not exists track text") == len(SHARED_TABLES)


def test_track_is_constrained_and_defaults_to_tir():
    sql = _sql()
    assert sql.count("default 'tir'") == len(SHARED_TABLES)
    assert sql.count("check (track in ('tir','sip'))") == len(SHARED_TABLES)


def test_hard_fks_to_tir_applications_are_dropped():
    sql = _sql()
    for table in SHARED_TABLES:
        assert f"{table}_application_id_fkey" in sql, table


def test_mou_uniqueness_moves_to_track_plus_application():
    sql = _sql()
    assert "founder_mou_application_id_key" in sql          # old single-column unique dropped
    assert "founder_mou_track_application_uidx" in sql      # new composite unique


def test_migration_is_transactional():
    # `in` rather than startswith: the file opens with a comment header
    # explaining why the FKs are dropped, which is worth keeping.
    sql = _sql()
    assert "begin;" in sql
    assert sql.strip().endswith("commit;")
