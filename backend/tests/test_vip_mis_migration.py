"""045 creates the five MIS reporting tables: one row per reporting period
(vip_mis_periods) plus four child tables for metrics, financial series,
headcount and the repeating entity sections (vip_mis_entries)."""
import re
from pathlib import Path

from app.services import mis_catalog as cat


def _sql() -> str:
    return Path("migrations/045_vip_mis.sql").read_text().lower()


def _entries_table_block(sql: str) -> str:
    """Just the vip_mis_entries create-table statement, so the
    no-unique-constraint assertion can't be satisfied by a unique on one of
    the other four tables instead."""
    start = sql.index("create table if not exists public.vip_mis_entries")
    end = sql.index(");", start)
    return sql[start:end]


def test_creates_the_five_mis_tables():
    sql = _sql()
    for table in (
        "vip_mis_periods",
        "vip_mis_metrics",
        "vip_mis_financials",
        "vip_mis_headcount",
        "vip_mis_entries",
    ):
        assert f"create table if not exists public.{table}" in sql, table


def test_periods_has_a_real_foreign_key_to_sip_applications():
    sql = _sql()
    assert "references public.sip_applications(id) on delete cascade" in sql


def test_all_four_children_have_real_foreign_keys_to_periods():
    sql = _sql()
    assert sql.count("references public.vip_mis_periods(id) on delete cascade") == 4


def test_periods_are_unique_per_application_kind_and_period_key():
    sql = _sql()
    assert "unique (application_id, kind, period_key)" in sql


def test_the_three_child_uniques_are_present():
    """Phase 2 shipped vip_air_evidence without a unique and needed a fix
    round when re-uploads silently duplicated rows. These three are keyed
    up front so reconciliation is idempotent by construction."""
    sql = _sql()
    assert "unique (period_id, metric_key)" in sql
    assert "unique (period_id, series, bucket)" in sql
    assert "unique (period_id, category)" in sql


def test_entries_deliberately_has_no_unique_constraint():
    """vip_mis_entries holds an ordered list (milestones, risks, asks, ...)
    where genuine duplicate rows are legal — unlike the other three child
    tables it must NOT get a unique constraint, and that must be explained
    in a comment so nobody "fixes" it later the way vip_air_evidence had to
    be fixed."""
    block = _entries_table_block(_sql())
    assert "unique (" not in block


def test_entries_no_unique_exception_is_commented():
    sql = _sql()
    start = sql.index("create table if not exists public.vip_mis_entries")
    # search the comment lines immediately preceding the *table definition*
    # (not the file's opening docstring, which also mentions the table name)
    # so this can't pass on an unrelated comment elsewhere.
    preamble = sql[:start]
    last_blank = preamble.rfind("\n\n")
    comment_block = preamble[last_blank:]
    assert "deliberate" in comment_block or "no unique" in comment_block


def test_kind_is_constrained():
    sql = _sql()
    assert "check (kind in ('monthly','quarterly'))" in sql


def test_status_is_constrained():
    sql = _sql()
    assert "check (status in ('draft','submitted'))" in sql


def test_rag_is_constrained():
    sql = _sql()
    assert "check (rag in ('green','amber','red'))" in sql


def test_category_check_lists_all_four_headcount_categories():
    """A CHECK missing one category silently rejects that category's rows
    at runtime — assert the full list, not just that a CHECK exists."""
    sql = _sql()
    assert "check (category in (" in sql
    for category in ("artpark_associated", "startup", "consultants", "interns"):
        assert f"'{category}'" in sql, category


def test_section_check_lists_every_catalog_entries_section_and_no_extras():
    """Minor-5, highest value per line in the phase: mirrors
    `mis_catalog.ENTRY_FIELDS` STRUCTURALLY — iterating the actual catalog
    keys — rather than a hard-coded literal list. The old version of this
    test pinned a literal ten-name list, so adding an 11th entries section
    to mis_catalog would fail NOTHING here, and that section's rows would
    then 23514-reject at runtime the first time a founder tried to save
    them (a CHECK constraint the migration never grew to match) — a
    founder's IP register (or whichever section) silently refusing to
    save. `state_machine.py` <-> `statusMachine.js` only got an equivalent
    mirror test after it had already drifted badly; this closes the same
    gap here before it has the chance to.
    """
    sql = _sql()
    assert "check (section in (" in sql
    start = sql.index("check (section in (")
    end = sql.index(")", start)  # closes the `in (...)` list, not the outer CHECK
    check_block = sql[start:end]
    listed = set(re.findall(r"'([a-z_]+)'", check_block))
    expected = set(cat.ENTRY_FIELDS)
    assert listed == expected, (
        f"migration CHECK vs mis_catalog.ENTRY_FIELDS mismatch — "
        f"missing from CHECK: {expected - listed}; "
        f"extra in CHECK, not in catalog: {listed - expected}"
    )


def test_rls_enabled_on_all_five_with_no_policies():
    sql = _sql()
    assert sql.count("enable row level security") == 5
    assert "create policy" not in sql


def test_migration_is_transactional():
    sql = _sql()
    assert "begin;" in sql
    assert sql.strip().endswith("commit;")
