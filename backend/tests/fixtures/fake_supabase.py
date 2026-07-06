# backend/tests/fixtures/fake_supabase.py
"""A WHERE-aware, MUTATING in-memory Supabase double for lifecycle tests.

Unlike the per-file _FakeAdminClient copies (which record inserts/updates but
never mutate stored rows and treat .eq() as a no-op on SELECT), this fake:
  * stores tables as dict[str, list[dict]]
  * honors .eq()/.in_()/.is_() filters on select/update/delete
  * actually mutates rows on update/upsert and appends on insert
  * supports maybe_single()/single(), limit()
so a caller can update a status and read it back — the property a full
status-lifecycle test depends on.
"""
from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from uuid import uuid4


class _Query:
    def __init__(self, store: dict[str, list[dict]], name: str):
        self._store = store
        self._name = name
        self._rows = store.setdefault(name, [])
        self._mode = "select"
        self._payload: Any = None
        self._on_conflict: list[str] = []
        self._eqs: list[tuple[str, Any]] = []
        self._ins: list[tuple[str, list]] = []
        self._is_null: list[str] = []
        self._single: str | None = None  # None | "maybe" | "one"
        self._limit: int | None = None
        self._ignore_duplicates: bool = False

    # chainable no-ops
    def select(self, *_a, **_k): return self
    def order(self, *_a, **_k): return self
    def range(self, *_a, **_k): return self
    def or_(self, *_a, **_k): return self
    def not_(self): return self
    def neq(self, *_a, **_k): return self

    def limit(self, n): self._limit = n; return self
    def eq(self, col, val): self._eqs.append((col, val)); return self
    def in_(self, col, vals): self._ins.append((col, list(vals))); return self

    def is_(self, col, val):
        if val is None:
            self._is_null.append(col)
        return self

    def maybe_single(self): self._single = "maybe"; return self
    def single(self): self._single = "one"; return self

    def insert(self, payload): self._mode = "insert"; self._payload = payload; return self
    def update(self, payload): self._mode = "update"; self._payload = payload; return self
    def delete(self): self._mode = "delete"; return self

    def upsert(self, payload, on_conflict: str | None = None, ignore_duplicates: bool = False):
        self._mode = "upsert"
        self._payload = payload
        self._on_conflict = [c.strip() for c in on_conflict.split(",")] if on_conflict else []
        self._ignore_duplicates = ignore_duplicates
        return self

    def _match(self, row) -> bool:
        for col, val in self._eqs:
            if row.get(col) != val:
                return False
        for col, vals in self._ins:
            if row.get(col) not in vals:
                return False
        for col in self._is_null:
            if row.get(col) is not None:
                return False
        return True

    def _result(self, data):
        if self._single in ("maybe", "one"):
            return SimpleNamespace(data=(data[0] if data else None), count=len(data))
        return SimpleNamespace(data=data, count=len(data))

    def execute(self):
        if self._mode == "insert":
            payloads = self._payload if isinstance(self._payload, list) else [self._payload]
            inserted = []
            for p in payloads:
                r = dict(p)
                r.setdefault("id", str(uuid4()))
                self._rows.append(r)
                inserted.append(r)
            return self._result(inserted)

        if self._mode == "update":
            hit = [r for r in self._rows if self._match(r)]
            for r in hit:
                r.update(self._payload)
            return self._result(hit)

        if self._mode == "upsert":
            payloads = self._payload if isinstance(self._payload, list) else [self._payload]
            out = []
            for p in payloads:
                existing = None
                if self._on_conflict:
                    for r in self._rows:
                        if all(r.get(k) == p.get(k) for k in self._on_conflict):
                            existing = r
                            break
                if existing is not None:
                    existing.update(p)
                    out.append(existing)
                else:
                    r = dict(p)
                    r.setdefault("id", str(uuid4()))
                    self._rows.append(r)
                    out.append(r)
            return self._result(out)

        if self._mode == "delete":
            hit = [r for r in self._rows if self._match(r)]
            for r in hit:
                self._rows.remove(r)
            return self._result(hit)

        # select
        data = [r for r in self._rows if self._match(r)]
        if self._limit is not None:
            data = data[: self._limit]
        return self._result(data)


class FakeSupabase:
    def __init__(self, tables: dict[str, list[dict]] | None = None):
        self.tables: dict[str, list[dict]] = {
            k: [dict(r) for r in v] for k, v in (tables or {}).items()
        }

    def table(self, name: str) -> _Query:
        return _Query(self.tables, name)

    def row(self, table: str, _id: str) -> dict | None:
        return next((r for r in self.tables.get(table, []) if r.get("id") == _id), None)

    def status_of(self, track: str, _id: str) -> str | None:
        r = self.row(f"{track}_applications", _id)
        return r.get("status") if r else None
