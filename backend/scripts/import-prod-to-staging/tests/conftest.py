"""Shared pytest fixtures for the prod→staging import test suite.

The fake Supabase client below has the small subset of the supabase-py
API that our lib modules touch. Each lib unit test injects this fake
into the function under test, so we never hit a real Supabase project
in unit tests.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pytest


@dataclass
class FakeResponse:
    data: list[dict[str, Any]] = field(default_factory=list)


class FakeQuery:
    def __init__(self, rows: list[dict[str, Any]]):
        self._rows = rows
        self._filters: list[tuple[str, str, Any]] = []
        self.inserts: list[list[dict[str, Any]]] = []
        self.deletes: list[dict[str, Any]] = []

    def select(self, *_cols: str) -> "FakeQuery":
        return self

    def eq(self, column: str, value: Any) -> "FakeQuery":
        self._filters.append(("eq", column, value))
        return self

    def in_(self, column: str, values: list[Any]) -> "FakeQuery":
        self._filters.append(("in", column, values))
        return self

    def neq(self, *_args, **_kwargs) -> "FakeQuery":
        return self

    def like(self, *_args, **_kwargs) -> "FakeQuery":
        return self

    def limit(self, *_args) -> "FakeQuery":
        return self

    def execute(self) -> FakeResponse:
        filtered = list(self._rows)
        for op, column, value in self._filters:
            if op == "eq":
                filtered = [r for r in filtered if r.get(column) == value]
            elif op == "in":
                filtered = [r for r in filtered if r.get(column) in value]
        return FakeResponse(data=filtered)

    def insert(self, rows: list[dict[str, Any]]) -> "FakeQuery":
        self.inserts.append(rows)
        return self

    def delete(self) -> "FakeQuery":
        return self


@dataclass
class FakeSupabase:
    """Minimal stand-in for supabase.Client used in unit tests."""

    tables: dict[str, list[dict[str, Any]]] = field(default_factory=dict)

    def table(self, name: str) -> FakeQuery:
        if name not in self.tables:
            self.tables[name] = []
        return FakeQuery(self.tables[name])


@pytest.fixture
def fake_prod() -> FakeSupabase:
    return FakeSupabase()


@pytest.fixture
def fake_staging() -> FakeSupabase:
    return FakeSupabase()
