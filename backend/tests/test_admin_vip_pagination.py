"""admin_vip_query's list reads page past PostgREST's ~1000-row default cap
(this repo has shipped that exact bug three times — see admin_query's own
`_fetch_all`, reused here rather than re-implemented).

`_PagedFake` simulates the real behaviour that makes the bug possible: a
SELECT that never calls `.range()` is capped at 1000 rows by the server's
own default, exactly like real PostgREST — NOT an unbounded in-memory list
the way `tests/fixtures/fake_supabase.py` and most per-file fakes in this
suite are. That is deliberate: those fakes cannot catch this class of bug
at all (a query missing `.range()` returns everything either way), so this
file uses its own, distinct from `test_roster_pagination.py`'s bare
`_RangeQuery` only in that it also supports `.eq()`/`.in_()` filtering,
which `fetch_air_queue`/`fetch_mis_matrix` both need.
"""
from __future__ import annotations

from types import SimpleNamespace

from app.services import admin_vip_query as vq
from app.services import air_catalog as air_cat
from app.services import applications_query


class _PagedQuery:
    def __init__(self, rows: list[dict]):
        self._rows = rows
        self._eqs: list[tuple[str, object]] = []
        self._ins: list[tuple[str, list]] = []
        # PostgREST's own server-side default cap when `.range()` is never
        # called — a query that forgets to page is silently truncated at
        # row 1000, not returned in full.
        self._s = 0
        self._e = 999

    def select(self, *_a, **_k): return self
    def order(self, *_a, **_k): return self

    def eq(self, col, val):
        self._eqs.append((col, val))
        return self

    def in_(self, col, vals):
        self._ins.append((col, list(vals)))
        return self

    def range(self, start, end):
        self._s, self._e = start, end
        return self

    def _filtered(self) -> list[dict]:
        rows = self._rows
        for col, val in self._eqs:
            rows = [r for r in rows if r.get(col) == val]
        for col, vals in self._ins:
            rows = [r for r in rows if r.get(col) in vals]
        return rows

    def execute(self):
        rows = self._filtered()[self._s: self._e + 1]
        return SimpleNamespace(data=rows)


class _PagedFake:
    def __init__(self, tables: dict[str, list[dict]]):
        self._tables = tables

    def table(self, name: str) -> _PagedQuery:
        return _PagedQuery(self._tables.get(name, []))


def _install(monkeypatch, tables: dict[str, list[dict]]):
    fake = _PagedFake(tables)
    monkeypatch.setattr(vq, "get_admin_client", lambda: fake)
    monkeypatch.setattr(applications_query, "get_admin_client", lambda: fake)
    return fake


def test_air_queue_reads_every_submitted_lever_past_1000_rows(monkeypatch):
    n = 1500
    assessments = [
        {"id": f"asm{i}", "application_id": f"sapp{i}", "round_label": "FY26-27-Q1",
         "status": "submitted", "submitted_at": f"2026-07-{(i % 27) + 1:02d}T00:00:00Z"}
        for i in range(n)
    ]
    lever_rows = []
    for a in assessments:
        for lever in air_cat.LEVER_KEYS:
            first = air_cat.QUESTIONS[lever][0]["options"][0]["id"]
            lever_rows.append({
                "assessment_id": a["id"], "lever": lever,
                "q1_option": first, "q2_option": None, "q3_option": None,
                "verified_level": None,
            })
    sip_apps = [
        {"id": f"sapp{i}", "basic_org": f"Startup {i}", "solution_describe": ""}
        for i in range(n)
    ]
    _install(monkeypatch, {
        "vip_air_assessments": assessments,
        "vip_air_lever_scores": lever_rows,
        "sip_applications": sip_apps,
        "ai_screening": [],
    })

    result = vq.fetch_air_queue()
    assert len(result["rows"]) == n * len(air_cat.LEVER_KEYS)
    assert len({r["application_id"] for r in result["rows"]}) == n
    assert {r["startup"] for r in result["rows"]} == {f"Startup {i}" for i in range(n)}


def test_mis_matrix_reads_every_period_past_1000_rows(monkeypatch):
    n = 1500
    periods = [
        {"id": f"per{i}", "application_id": f"sapp{i}", "kind": "monthly",
         "period_key": "2026-08", "label": "Aug 2026", "period_start": "2026-08-01",
         "period_end": "2026-08-31", "due_date": "2026-09-05", "status": "draft"}
        for i in range(n)
    ]
    sip_apps = [
        {"id": f"sapp{i}", "basic_org": f"Startup {i}", "solution_describe": ""}
        for i in range(n)
    ]
    _install(monkeypatch, {
        "vip_mis_periods": periods,
        "sip_applications": sip_apps,
        "ai_screening": [],
    })

    result = vq.fetch_mis_matrix("monthly")
    assert len(result["startups"]) == n
    assert {s["application_id"] for s in result["startups"]} == {f"sapp{i}" for i in range(n)}
