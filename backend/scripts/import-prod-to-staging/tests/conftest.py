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

    def update(self, *_args, **_kwargs) -> "FakeQuery":
        return self


class _FakeUser:
    """Minimal stand-in for the User model returned by supabase-py auth."""
    def __init__(self, *, id: str, email: str, user_metadata: dict | None = None):
        self.id = id
        self.email = email
        self.user_metadata = user_metadata or {}


class _FakeCreateUserResponse:
    def __init__(self, user: _FakeUser):
        self.user = user


class _FakeAuthAdmin:
    """Stand-in for client.auth.admin — list_users / create_user / delete_user."""
    def __init__(self, owner: "FakeSupabase"):
        self._owner = owner

    def list_users(self, page: int = 1, per_page: int = 1000):
        # Naive pagination over the owner's auth_users list.
        users = self._owner.auth_users
        start = (page - 1) * per_page
        end = start + per_page
        slice_ = users[start:end]
        return [
            _FakeUser(
                id=u["id"],
                email=u.get("email", ""),
                user_metadata=u.get("raw_user_meta_data", {}),
            )
            for u in slice_
        ]

    def create_user(self, kwargs: dict) -> _FakeCreateUserResponse:
        new_id = f"new-staging-uid-{len(self._owner.auth_users) + 1}"
        record = {
            "id": new_id,
            "email": kwargs.get("email"),
            "raw_user_meta_data": dict(kwargs.get("user_metadata") or {}),
        }
        self._owner.auth_users.append(record)
        return _FakeCreateUserResponse(_FakeUser(
            id=new_id, email=record["email"],
            user_metadata=record["raw_user_meta_data"],
        ))

    def delete_user(self, uid: str) -> None:
        self._owner.auth_users = [u for u in self._owner.auth_users if u["id"] != uid]


class _FakeAuth:
    def __init__(self, owner: "FakeSupabase"):
        self.admin = _FakeAuthAdmin(owner)


class FakeSupabase:
    """Minimal stand-in for supabase.Client used in unit tests.

    Holds two collections:
      - tables   — public-schema row collections (used via .table(name))
      - auth_users — auth.users records, reached via .auth.admin.* (the
        Admin API path — PostgREST doesn't expose the auth schema, so
        real code uses client.auth.admin.list_users() instead of
        client.table("auth.users")).
    """

    def __init__(
        self,
        tables: dict[str, list[dict[str, Any]]] | None = None,
        auth_users: list[dict[str, Any]] | None = None,
    ):
        self.tables = tables if tables is not None else {}
        self.auth_users = auth_users if auth_users is not None else []
        self.auth = _FakeAuth(self)

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
