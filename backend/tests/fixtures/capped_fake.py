"""PostgREST-faithful variant of tests/fixtures/fake_supabase.FakeSupabase.

Differences from the shared fake (swarm repro helper, numbers_state area):
  * every SELECT response is capped at MAX_ROWS (PostgREST `db-max-rows`,
    Supabase default 1000) -- `.limit(n)` with n > MAX_ROWS is still capped;
  * `.range(a, b)` is honoured (so `_fetch_all` paging terminates and works);
  * `.neq()` and `.order(col)` (ascending, stable) are honoured;
  * `count="exact"` reports the full match count (as PostgREST does), not the
    capped page length;
  * optional `on_select(table, call_no)` hook lets a test mutate the physical
    row order between paged requests (simulates an UPDATE moving a heap tuple
    while an un-ORDERed OFFSET scan is in flight).
"""
from __future__ import annotations

from types import SimpleNamespace

from tests.fixtures.fake_supabase import FakeSupabase, _Query

MAX_ROWS = 1000


class _CappedQuery(_Query):
    def __init__(self, store, name, owner):
        super().__init__(store, name)
        self._owner = owner
        self._range: tuple[int, int] | None = None
        self._neqs: list[tuple[str, object]] = []
        self._count_exact = False
        self._orders: list[str] = []

    def select(self, *_a, **k):
        if k.get("count") == "exact":
            self._count_exact = True
        return self

    @property
    def not_(self):  # supabase-py exposes `not_` as a property
        return self

    def order(self, col, *_a, **_k):  # honoured: stable ORDER BY col asc
        self._orders.append(col)
        return self

    def range(self, a, b):
        self._range = (a, b)
        return self

    def neq(self, col, val):
        self._neqs.append((col, val))
        return self

    def _match(self, row) -> bool:
        if not super()._match(row):
            return False
        for col, val in self._neqs:
            # SQL semantics: NULL <> 'x' is NULL -> row excluded
            if row.get(col) is None or row.get(col) == val:
                return False
        return True

    def execute(self):
        if self._mode != "select":
            return super().execute()
        self._owner.select_calls.setdefault(self._name, 0)
        self._owner.select_calls[self._name] += 1
        if self._owner.on_select:
            self._owner.on_select(self._name, self._owner.select_calls[self._name], self._rows)
        data = [r for r in self._rows if self._match(r)]
        for col in reversed(self._orders):
            data.sort(key=lambda r, c=col: (r.get(c) is None, str(r.get(c))))
        full = len(data)
        if self._range is not None:
            a, b = self._range
            data = data[a:b + 1]
        if self._limit is not None:
            data = data[: self._limit]
        data = data[:MAX_ROWS]
        if self._single in ("maybe", "one"):
            return SimpleNamespace(data=(data[0] if data else None), count=full)
        return SimpleNamespace(data=[dict(r) for r in data], count=full)


class CappedFakeSupabase(FakeSupabase):
    def __init__(self, tables=None, on_select=None):
        super().__init__(tables)
        self.on_select = on_select
        self.select_calls: dict[str, int] = {}

    def table(self, name: str) -> _CappedQuery:
        return _CappedQuery(self.tables, name, self)
