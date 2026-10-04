"""Reviewer portal round-2 (2026-10-05): History load cost + human decision label.

* fetch_history must stay safe past PostgREST's 1000-row cap (reviews are
  paged), keep every ``in_()`` list short (chunked, so the request URL stays
  bounded), and read only the columns it renders (no ``select("*")`` of the
  wide application / ai_screening rows).
* The content endpoint carries the contract-C5 ``admin_decision`` bucket for a
  decided app so the eval banner can show a human label.
"""
from __future__ import annotations

from types import SimpleNamespace

from app.deps import get_current_user
from app.main import app
from app.services import reviewer_query

from tests.test_reviewer import _clear_overrides, _install_db, _override_user  # noqa: F401
from tests.test_reviewer_numbers import _asg, _review, _tir

ME = "rev-1"
PAGE_CAP = 1000  # PostgREST default max rows per request


class _RecQuery:
    """Fake query that honours eq/in_/is_/range and enforces the 1000-row cap."""

    def __init__(self, db, name):
        self.db, self.name = db, name
        self.cols = "*"
        self.eqs, self.ins, self.nulls = [], [], []
        self.rng = None

    def select(self, cols="*", *_a, **_k):
        self.cols = cols
        return self

    def eq(self, c, v):
        self.eqs.append((c, v)); return self

    def in_(self, c, vals):
        vals = list(vals)
        self.db.in_sizes.append((self.name, len(vals)))
        self.ins.append((c, set(vals))); return self

    def is_(self, c, v):
        self.nulls.append(c); return self

    def range(self, a, b):
        self.rng = (a, b); return self

    def order(self, *_a, **_k): return self
    def limit(self, *_a, **_k): return self

    def execute(self):
        self.db.selects.append((self.name, self.cols))
        rows = [r for r in self.db.tables.get(self.name, [])
                if all(r.get(c) == v for c, v in self.eqs)
                and all(r.get(c) in s for c, s in self.ins)
                and all(r.get(c) is None for c in self.nulls)]
        if self.rng:
            rows = rows[self.rng[0]: self.rng[1] + 1]
        return SimpleNamespace(data=rows[:PAGE_CAP])


class _RecClient:
    def __init__(self, tables):
        self.tables = tables
        self.selects: list[tuple[str, str]] = []
        self.in_sizes: list[tuple[str, int]] = []

    def table(self, name):
        return _RecQuery(self, name)


def _big_db(n):
    ids = [f"app-{i}" for i in range(n)]
    return _RecClient({
        "reviews": [_review(a) for a in ids],
        "tir_applications": [_tir(a, "evaluated", i, answers={"x": "y" * 50})
                             for i, a in enumerate(ids)],
        "sip_applications": [],
        "ai_screening": [{"application_id": a, "application_track": "tir",
                          "project_name": f"P{a}", "score_overall": 6.0,
                          "summary": "long"} for a in ids],
        "reviewer_assignments": [_asg(f"as-{a}", a) for a in ids],
        "admin_decisions": [], "ic_documents": [],
    })


def test_history_pages_past_the_1000_row_cap(monkeypatch):
    db = _big_db(1200)
    monkeypatch.setattr(reviewer_query, "get_admin_client", lambda: db)
    out = reviewer_query.fetch_history(ME)
    assert out["degraded"] is False
    assert out["stats"]["total"] == 1200
    rows = out["rows"]
    assert all(r["applicationId"].startswith("TIR-") for r in rows)
    assert all(r["aiScore"] == 6.0 for r in rows)
    assert all(r["canEdit"] is True for r in rows)


def test_history_chunks_in_lists_and_narrows_columns(monkeypatch):
    db = _big_db(450)
    monkeypatch.setattr(reviewer_query, "get_admin_client", lambda: db)
    out = reviewer_query.fetch_history(ME)
    assert out["stats"]["total"] == 450
    assert db.in_sizes, "expected bulk in_() reads"
    assert max(n for _, n in db.in_sizes) <= 200
    wide = {t for t, cols in db.selects
            if cols == "*" and t in ("tir_applications", "sip_applications", "ai_screening")}
    assert wide == set()


# ─── Content endpoint: admin_decision bucket for the read-only banner ──


def _content(monkeypatch, status, **tables):
    _install_db(monkeypatch, {
        "reviewer_assignments": [_asg("as1", "app1")],
        "tir_applications": [_tir("app1", status, 1)],
        "sip_applications": [], "reviews": [_review("app1")],
        "ai_screening": [], "industry_categories": [],
        "admin_decisions": [], "ic_documents": [], **tables,
    })
    app.dependency_overrides[get_current_user] = _override_user(ME)


def test_content_carries_admin_decision_for_decided_app(client, monkeypatch, _clear_overrides):
    _content(monkeypatch, "jury_review")
    body = client.get("/reviewer/applications/tir/app1/content").json()
    assert body["read_only_reason"] == "decided"
    assert body["admin_decision"] == "gate1_selected"


def test_content_admin_decision_final_rejected(client, monkeypatch, _clear_overrides):
    _content(monkeypatch, "rejected", admin_decisions=[
        {"application_id": "app1", "application_track": "tir", "gate_stage": "gate2",
         "decision": "rejected", "decided_at": "2026-08-02T00:00:00Z"}])
    body = client.get("/reviewer/applications/tir/app1/content").json()
    assert body["admin_decision"] == "final_rejected"


def test_content_admin_decision_none_when_undecided(client, monkeypatch, _clear_overrides):
    _content(monkeypatch, "evaluated")
    body = client.get("/reviewer/applications/tir/app1/content").json()
    assert body["read_only"] is False
    assert body["admin_decision"] is None
