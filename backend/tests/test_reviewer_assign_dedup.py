"""Regression tests for the batch→reviewer assignment duplicate-key 500.

Root cause (confirmed in prod): assign_reviewers_to_batch dedups by reading
`reviewer_assignments.select("*")`, which PostgREST caps at ~1000 rows. Once the
table grew past the cap (prod had 2903 rows), the dedup snapshot missed existing
assignments, so an already-assigned (application_id, application_track,
reviewer_user_id) triple got re-inserted → unique-violation 23505 →
unhandled APIError → HTTP 500 ("Request failed") in the admin roster.

These tests use a fake Supabase client that — unlike the shared fake in
test_admin_platform.py — FAITHFULLY models both failure conditions:
  * a plain select() (no .range()) returns only the first CAP rows, and
  * inserting a duplicate triple into reviewer_assignments raises APIError(23505),
    while an ignore-duplicates upsert silently skips it (ON CONFLICT DO NOTHING).

So the current code MUST fail these; the fix (paginated dedup read + idempotent
upsert) MUST pass them.
"""
from __future__ import annotations

from types import SimpleNamespace

from postgrest.exceptions import APIError

from app.services import admin_query, state_machine

# Tiny cap so a 3rd row is "beyond the cap" without seeding 1000 rows.
_CAP = 2
_UNIQUE = ("application_id", "application_track", "reviewer_user_id")


class _FakeQuery:
    def __init__(self, parent, name):
        self._p = parent
        self._name = name
        self._mode = "select"
        self._eqs: list[tuple[str, object]] = []
        self._ins: list[tuple[str, set]] = []
        self._range: tuple[int, int] | None = None
        self._payload = None
        self._ignore = False

    def select(self, *_a, **_k):
        return self

    def order(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self._eqs.append((col, val))
        return self

    def in_(self, col, vals):
        self._ins.append((col, set(vals)))
        return self

    def range(self, start, end):
        self._range = (start, end)
        return self

    def insert(self, payload):
        self._mode = "insert"
        self._payload = payload
        return self

    def upsert(self, payload, on_conflict=None, ignore_duplicates=False, **_k):
        self._mode = "upsert"
        self._payload = payload
        self._ignore = ignore_duplicates
        return self

    def _filtered(self):
        rows = list(self._p.tables.get(self._name, []))
        for col, val in self._eqs:
            rows = [r for r in rows if r.get(col) == val]
        for col, vals in self._ins:
            rows = [r for r in rows if r.get(col) in vals]
        return rows

    def execute(self):
        if self._mode == "select":
            rows = self._filtered()
            if self._range is not None:
                s, e = self._range
                rows = rows[s : e + 1]
            else:
                rows = rows[:_CAP]  # PostgREST default row cap
            return SimpleNamespace(data=rows, count=len(rows))

        # insert / upsert
        payload = self._payload if isinstance(self._payload, list) else [self._payload]
        table = self._p.tables.setdefault(self._name, [])
        enforce = self._name == "reviewer_assignments"
        seen = {tuple(r.get(c) for c in _UNIQUE) for r in table} if enforce else set()
        written = []
        for row in payload:
            if enforce:
                key = tuple(row.get(c) for c in _UNIQUE)
                if key in seen:
                    if self._mode == "upsert" and self._ignore:
                        continue  # ON CONFLICT DO NOTHING
                    raise APIError({
                        "code": "23505",
                        "message": 'duplicate key value violates unique constraint '
                                   '"reviewer_assignments_application_id_application_track_revie_key"',
                        "details": f"Key {_UNIQUE}={key} already exists.",
                        "hint": None,
                    })
                seen.add(key)
            table.append(row)
            written.append(row)
        return SimpleNamespace(data=written, count=len(written))


class _FakeClient:
    def __init__(self, tables):
        self.tables = tables

    def table(self, name):
        return _FakeQuery(self, name)


def _seed_over_cap():
    """Batch b1 has appX (new for rev-1) + appDup (already assigned to rev-1).
    rev-1's appDup assignment is the 3rd row, so a capped select('*') misses it."""
    return {
        "application_batches": [
            {"application_id": "appX", "application_track": "tir", "batch_id": "b1"},
            {"application_id": "appDup", "application_track": "tir", "batch_id": "b1"},
        ],
        "reviewer_assignments": [
            {"application_id": "z1", "application_track": "tir", "reviewer_user_id": "rev-1",
             "declined_at": None, "reassigned_to": None},
            {"application_id": "z2", "application_track": "tir", "reviewer_user_id": "rev-1",
             "declined_at": None, "reassigned_to": None},
            {"application_id": "appDup", "application_track": "tir", "reviewer_user_id": "rev-1",
             "declined_at": None, "reassigned_to": None},  # index 2 → beyond _CAP
        ],
    }


def test_assign_survives_existing_beyond_row_cap(monkeypatch):
    """The bug: dedup misses appDup (beyond the cap) → re-insert → 23505.
    The fix must NOT raise, must skip appDup, and must create only appX."""
    tables = _seed_over_cap()
    sb = _FakeClient(tables)
    # assign_reviewers_to_batch now also advances submitted->under_review via
    # state_machine, which reads the global admin client — point it at the
    # same fake so no real network call is attempted. Neither app row exists
    # in `tables`, so the lookup finds nothing and the advance is a no-op.
    monkeypatch.setattr(state_machine, "get_admin_client", lambda: sb)

    result = admin_query.assign_reviewers_to_batch(
        sb, "b1", ["rev-1"], assigned_by="admin-1",
    )

    assert result["created"] == 1, result
    triples = {
        (r["application_id"], r["application_track"], r["reviewer_user_id"])
        for r in tables["reviewer_assignments"]
    }
    assert ("appX", "tir", "rev-1") in triples          # new assignment created
    # appDup must NOT be duplicated
    dup_count = sum(
        1 for r in tables["reviewer_assignments"]
        if r["application_id"] == "appDup" and r["reviewer_user_id"] == "rev-1"
    )
    assert dup_count == 1, f"appDup duplicated {dup_count}x"


def test_assign_is_idempotent_when_repeated(monkeypatch):
    """Assigning the same reviewer to the same batch twice must not 500 and must
    create 0 the second time."""
    tables = _seed_over_cap()
    sb = _FakeClient(tables)
    monkeypatch.setattr(state_machine, "get_admin_client", lambda: sb)

    first = admin_query.assign_reviewers_to_batch(sb, "b1", ["rev-1"], assigned_by="admin-1")
    second = admin_query.assign_reviewers_to_batch(sb, "b1", ["rev-1"], assigned_by="admin-1")

    assert first["created"] == 1
    assert second["created"] == 0, second
