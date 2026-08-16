"""Every file in backend/migrations/ must parse as valid Postgres DDL.

This project's DDL is hand-pasted into Supabase Studio (see the migrations
README) — there is no CI gate, no exec_sql RPC, no client-side transaction
that could catch a typo before it reaches production. sqlglot is the closest
thing to a safety net: if it cannot parse a migration as Postgres, a human
pasting it into Studio is at real risk of hitting the same syntax error live.

Two things are explicitly NOT failures here, both verified against sqlglot's
own postgres dialect rather than assumed:

1. `ENABLE ROW LEVEL SECURITY` isn't modelled. sqlglot logs a warning and
   falls back to a generic Command node rather than raising — parsing still
   succeeds, so nothing needs to be special-cased for it below.

2. Two narrow, confirmed sqlglot postgres-dialect gaps DO raise, on SQL that
   is valid, standard, and already applied in production:
     - `DROP TRIGGER ... ON schema.table` — sqlglot's DROP TRIGGER grammar
       only accepts an unqualified table name after ON.
       `drop trigger if exists t on public.profiles;` raises; the
       unqualified `drop trigger if exists t on profiles;` parses fine.
     - `COMMENT ON COLUMN ... IS 'a' 'b'` — adjacent string-literal
       concatenation (standard SQL, used in this repo to wrap long column
       comments across lines) isn't accepted as a COMMENT statement's value,
       though the same construct parses fine as a plain expression
       elsewhere (`select 'a' 'b';` parses).
   Both are narrowly patched away by regex *before* parsing, so the rest of
   each file — including genuine mistakes like an unclosed paren — is still
   checked at full strictness. This is not a license to swallow real
   errors: sqlglot's own error-recovery levels (WARN/IGNORE) were tried and
   rejected for this test because they silently accept genuinely malformed
   SQL (e.g. a `create table` with a missing closing paren parses "clean"
   under WARN/IGNORE) — the opposite of what this test exists to catch.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest
import sqlglot

_MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"

_DROP_TRIGGER_SCHEMA = re.compile(
    r"(drop\s+trigger\s+if\s+exists\s+\S+\s+on\s+)\w+\.(\w+)", re.IGNORECASE
)
_ADJACENT_STRING_LITERALS = re.compile(
    r"'(?:[^'\\]|\\.)*'(?:\s*\n\s*'(?:[^'\\]|\\.)*')+"
)


def _merge_adjacent_string_literals(match: re.Match) -> str:
    parts = re.findall(r"'((?:[^'\\]|\\.)*)'", match.group(0))
    return "'" + "".join(parts) + "'"


def _sqlglot_friendly(sql: str) -> str:
    sql = _ADJACENT_STRING_LITERALS.sub(_merge_adjacent_string_literals, sql)
    sql = _DROP_TRIGGER_SCHEMA.sub(r"\1\2", sql)
    return sql


def _migration_files() -> list[Path]:
    return sorted(p for p in _MIGRATIONS_DIR.glob("*.sql"))


@pytest.mark.parametrize("path", _migration_files(), ids=lambda p: p.name)
def test_migration_parses_as_valid_postgres_ddl(path: Path):
    sql = path.read_text()
    # Raises sqlglot.errors.ParseError / TokenError on genuinely invalid
    # SQL — default (strict) error level, deliberately not WARN/IGNORE; see
    # the module docstring for why.
    sqlglot.parse(_sqlglot_friendly(sql), read="postgres")


def test_at_least_the_expected_migrations_were_found():
    """A glob that silently matched nothing would make every parametrized
    case above vanish rather than fail — guard the count isn't zero."""
    assert len(_migration_files()) >= 40
