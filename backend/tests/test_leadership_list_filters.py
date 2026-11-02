"""Leadership list filters — backend side of every leadership filter.

GET /leadership/applications (track, status/stage, industry, ai_score_bucket,
recommendation, sort, limit/offset) and GET /leadership/industry-categories,
checked against the /stats pipeline_breakdown the chips are counted from.

Regression tests for LF-2 (chunked id lookups), LF-3 (deterministic paging),
LF-7 (status sort by displayed stage), LF-8 (global industry counts over the
list's rows) and ADM-F7 (paginated track-table read).
"""
from __future__ import annotations

import itertools

import pytest

from app.deps import get_current_user
from app.main import app
from app.routers import leadership as lead_mod
from app.services import admin_query, applications_query, industry_categories, stats

from tests.fixtures.fake_supabase import FakeSupabase


@pytest.fixture
def _clear():
    yield
    app.dependency_overrides.clear()


class _NotQ:
    """`.not_.is_(col, "null")` (attribute, as in postgrest-py) → drop NULLs."""
    def __init__(self, q, col_holder): self._q = q
    def is_(self, col, _val):
        q = self._q
        orig = q.execute
        def execute():
            res = orig()
            res.data = [r for r in res.data if r.get(col) is not None]
            return res
        q.execute = execute
        return q


class _SB(FakeSupabase):
    def table(self, name):
        q = super().table(name)
        type(q).not_ = property(lambda self_: _NotQ(self_, None))
        return q


def _patch(monkeypatch, tables):
    from app.utils.rate_limit import limiter
    monkeypatch.setattr(limiter, "enabled", False)
    sb = _SB(tables)
    for mod in (stats, applications_query, admin_query, lead_mod, industry_categories):
        monkeypatch.setattr(mod, "get_admin_client", lambda: sb)
    app.dependency_overrides[get_current_user] = lambda: {
        "user_id": "u1", "email": "l@x.io", "roles": ["leadership"]}
    return sb


def _rev(i, app_id, track, reco, rv):
    return {"id": f"rv{i}", "application_id": app_id, "application_track": track,
            "reviewer_user_id": rv, "submitted_at": "2026-08-01", "recommendation": reco}


def _tables():
    """12 apps covering every stage, both tracks, a moved app, scores, industries, recos."""
    tir = [
        {"id": "t1", "status": "submitted", "display_seq": 1, "submitted_at": "2026-07-01"},
        {"id": "t2", "status": "under_review", "display_seq": 2, "submitted_at": "2026-07-02"},
        {"id": "t3", "status": "evaluated", "display_seq": 3, "submitted_at": "2026-07-03"},
        {"id": "t4", "status": "rejected", "display_seq": 4, "submitted_at": "2026-07-04"},
        {"id": "t5", "status": "rejected", "display_seq": 5, "submitted_at": "2026-07-05"},
        {"id": "t6", "status": "jury_review", "display_seq": 6, "submitted_at": "2026-07-06"},
        {"id": "t7", "status": "jury_review", "display_seq": 7, "submitted_at": "2026-07-07"},
        # moved TIR → VIP: must list under VIP only
        {"id": "t8", "status": "evaluated", "display_seq": 8, "submitted_at": "2026-07-08",
         "moved_to_track": "sip"},
        {"id": "t9", "status": "onboarded", "display_seq": 9, "submitted_at": "2026-07-09"},
    ]
    sip = [
        {"id": "s1", "status": "evaluated", "display_seq": 101, "submitted_at": "2026-07-10"},
        {"id": "s2", "status": "under_review", "display_seq": 102, "submitted_at": "2026-07-11"},
        {"id": "s3", "status": "ai_screening", "display_seq": 103, "submitted_at": "2026-07-12"},
    ]
    ai = [
        {"application_id": "t1", "application_track": "tir", "score_overall": 10.0, "industry_category_id": "rob"},
        {"application_id": "t2", "application_track": "tir", "score_overall": 7.0, "industry_category_id": "rob"},
        {"application_id": "t3", "application_track": "tir", "score_overall": 7.9, "industry_category_id": "cli"},
        {"application_id": "t4", "application_track": "tir", "score_overall": 3.2, "industry_category_id": "cli"},
        {"application_id": "t5", "application_track": "tir", "score_overall": 6.5, "industry_category_id": None},
        {"application_id": "t6", "application_track": "tir", "score_overall": 8.1, "industry_category_id": "rob"},
        {"application_id": "t7", "application_track": "tir", "score_overall": 8.9, "industry_category_id": "cli"},
        {"application_id": "t8", "application_track": "tir", "score_overall": 7.5, "industry_category_id": "cli"},
        {"application_id": "s1", "application_track": "sip", "score_overall": 7.2, "industry_category_id": "cli"},
        {"application_id": "s2", "application_track": "sip", "score_overall": 5.0, "industry_category_id": "rob"},
        # s3 / t9: no ai_screening row → unclassified, no score
    ]
    decisions = [
        {"id": "d1", "application_id": "t4", "application_track": "tir", "gate_stage": "gate1",
         "decision": "rejected", "decided_at": "2026-08-01"},
        {"id": "d2", "application_id": "t5", "application_track": "tir", "gate_stage": "gate1",
         "decision": "jury_review", "decided_at": "2026-08-01"},
        {"id": "d3", "application_id": "t5", "application_track": "tir", "gate_stage": "gate2",
         "decision": "rejected", "decided_at": "2026-08-05"},
        {"id": "d4", "application_id": "t6", "application_track": "tir", "gate_stage": "gate1",
         "decision": "jury_review", "decided_at": "2026-08-01"},
        {"id": "d5", "application_id": "t7", "application_track": "tir", "gate_stage": "gate1",
         "decision": "jury_review", "decided_at": "2026-08-01"},
    ]
    ic = [  # t7 fully signed → final_selected; t6 has an unsigned doc → final_pending
        {"id": "i1", "application_id": "t7", "application_track": "tir", "signed_at": "2026-08-09", "superseded_at": None},
        {"id": "i2", "application_id": "t6", "application_track": "tir", "signed_at": None, "superseded_at": None},
    ]
    reviews = [
        _rev(1, "t3", "tir", "yes", "a"), _rev(2, "t3", "tir", "yes", "b"),     # yes
        _rev(3, "t8", "tir", "no", "a"), _rev(4, "t8", "tir", "no", "b"),       # no
        _rev(5, "s1", "sip", "yes", "a"), _rev(6, "s1", "sip", "no", "b"),      # maybe
        _rev(7, "t2", "tir", "yes", "a"),                                       # single
    ]
    return {
        "tir_applications": tir, "sip_applications": sip, "ai_screening": ai,
        "admin_decisions": decisions, "ic_documents": ic, "reviews": reviews,
        "reviewer_assignments": [], "reviewer_profiles": [], "profiles": [],
        "industry_categories": [
            {"id": "rob", "label": "Robotics", "is_seed": True},
            {"id": "cli", "label": "Climate", "is_seed": True},
        ],
        "application_status_log": [], "user_roles": [],
    }


def _list(client, **params):
    params.setdefault("limit", 200)
    res = client.get("/leadership/applications", params=params,
                     headers={"Authorization": "Bearer t"})
    assert res.status_code == 200, res.text
    return res.json()


def _ids(body):
    return sorted(r["id"] for r in body["applications"])


def _breakdown(tables):
    apps = ([{**r, "track": "tir"} for r in tables["tir_applications"]]
            + [{**r, "track": "sip"} for r in tables["sip_applications"]])
    return stats.build_pipeline_breakdown(apps, tables["admin_decisions"], tables["ic_documents"])


# ── Track ──────────────────────────────────────────────────────────────

def test_track_filter_is_effective(client, _clear, monkeypatch):
    _patch(monkeypatch, _tables())
    assert _ids(_list(client, track="sip")) == ["s1", "s2", "s3", "t8"]
    assert "t8" not in _ids(_list(client, track="tir"))
    assert _list(client)["total"] == 12


# ── Stage chips: list rows == breakdown chip count, for every stage × track ──

@pytest.mark.parametrize("track", [None, "tir", "sip"])
def test_every_stage_list_matches_chip_count(client, _clear, monkeypatch, track):
    """Mirrors the FE stageQuery: server stages + single-status stages go as
    `status`; `submitted` (3 raw statuses) is fetched unfiltered and narrowed
    client-side — here narrowed on pipeline_stage, the correct key."""
    t = _tables()
    _patch(monkeypatch, t)
    pb = _breakdown(t)
    chips = pb["by_track"][track]["stages"] if track else pb["stages"]
    single = {"under_review": "under_review", "offered": "offered", "onboarded": "onboarded",
              "on_hold": "on_hold", "waitlisted": "waitlisted", "withdrawn": "withdrawn"}
    server = {"reviewed", "gate1_rejected", "final_rejected", "final_pending", "final_selected"}
    for stage, n in chips.items():
        if stage in server:
            body = _list(client, status=stage, **({"track": track} if track else {}))
            got = body["total"]
        elif stage in single:
            body = _list(client, status=single[stage], **({"track": track} if track else {}))
            got = body["total"]
        else:  # submitted
            body = _list(client, **({"track": track} if track else {}))
            got = sum(1 for r in body["applications"] if r["pipeline_stage"] == "submitted")
        assert got == n, f"stage={stage} track={track}: list {got} vs chip {n}"


def test_rows_carry_pipeline_stage(client, _clear, monkeypatch):
    _patch(monkeypatch, _tables())
    st = {r["id"]: r["pipeline_stage"] for r in _list(client)["applications"]}
    assert st["t4"] == "gate1_rejected" and st["t5"] == "final_rejected"
    assert st["t6"] == "final_pending" and st["t7"] == "final_selected"


def test_submitted_stage_row_status_is_overlaid_not_raw(client, _clear, monkeypatch):
    """Raw `submitted` app carrying a gate-1 `rejected` decision: backend counts
    it in the Submitted chip (pipeline_stage=submitted) but the row's `status`
    is the overlaid 'rejected'. The FE `submitted` keep() reads row.status
    (pipelineStages.js:100) → the row vanishes from the Submitted list."""
    t = _tables()
    t["admin_decisions"].append({"id": "dx", "application_id": "t1", "application_track": "tir",
                                 "gate_stage": "gate1", "decision": "rejected",
                                 "decided_at": "2026-08-02"})
    _patch(monkeypatch, t)
    row = next(r for r in _list(client)["applications"] if r["id"] == "t1")
    assert row["pipeline_stage"] == "submitted"
    # Documents the divergence the FE keep() trips on:
    assert row["status"] == "rejected"


# ── Industry ───────────────────────────────────────────────────────────

def test_industry_filter_and_unclassified(client, _clear, monkeypatch):
    _patch(monkeypatch, _tables())
    assert _ids(_list(client, industry="cli")) == ["s1", "t3", "t4", "t7", "t8"]
    assert _ids(_list(client, industry="unclassified")) == ["s3", "t5", "t9"]
    assert _ids(_list(client, industry="cli", track="sip")) == ["s1", "t8"]


def test_track_scoped_industry_counts_match_list(client, _clear, monkeypatch):
    _patch(monkeypatch, _tables())
    for track in ("tir", "sip"):
        res = client.get("/leadership/industry-categories", params={"track": track},
                         headers={"Authorization": "Bearer t"}).json()
        for c in res["categories"]:
            assert c["count"] == _list(client, track=track, industry=c["id"])["total"]
        assert res["unclassified"]["count"] == _list(
            client, track=track, industry="unclassified")["total"]


def test_global_industry_chip_counts_ignore_orphan_screening_rows(client, _clear, monkeypatch):
    """No-track industry chip counts come from raw ai_screening rows
    (industry_categories.categories_with_counts) — an orphan / draft app's row
    inflates the chip vs. the list it filters."""
    t = _tables()
    t["ai_screening"].append({"application_id": "gone", "application_track": "tir",
                              "score_overall": 5, "industry_category_id": "rob"})
    _patch(monkeypatch, t)
    res = client.get("/leadership/industry-categories",
                     headers={"Authorization": "Bearer t"}).json()
    rob = next(c for c in res["categories"] if c["id"] == "rob")
    assert rob["count"] == _list(client, industry="rob")["total"]


# ── AI score bucket ────────────────────────────────────────────────────

@pytest.mark.parametrize("bucket,ids", [
    (9, ["t1"]),            # 10.0 clamps into 9
    (7, ["s1", "t2", "t3", "t8"]),
    (8, ["t6", "t7"]),
    (3, ["t4"]),
    (0, []),
])
def test_ai_bucket(client, _clear, monkeypatch, bucket, ids):
    _patch(monkeypatch, _tables())
    assert _ids(_list(client, ai_score_bucket=bucket)) == ids


# ── Recommendation ─────────────────────────────────────────────────────

@pytest.mark.parametrize("reco,ids", [
    ("yes", ["t3"]), ("no", ["t8"]), ("maybe", ["s1"]), ("single", ["t2"]),
    ("none", ["s2", "s3", "t1", "t4", "t5", "t6", "t7", "t9"]),
])
def test_reco(client, _clear, monkeypatch, reco, ids):
    _patch(monkeypatch, _tables())
    assert _ids(_list(client, recommendation=reco)) == ids


# ── Combinations = intersection of the single filters ─────────────────

def test_filter_combinations_are_intersections(client, _clear, monkeypatch):
    _patch(monkeypatch, _tables())
    dims = {
        "track": [None, "tir", "sip"],
        "industry": [None, "cli", "rob", "unclassified"],
        "ai_score_bucket": [None, 7, 8],
        "recommendation": [None, "yes", "no", "none"],
        "status": [None, "reviewed", "final_pending", "under_review"],
    }
    singles = {}
    for k, vals in dims.items():
        for v in vals:
            if v is not None:
                singles[(k, v)] = set(_ids(_list(client, **{k: v})))
    every = set(_ids(_list(client)))
    for combo in itertools.product(*dims.values()):
        params = {k: v for k, v in zip(dims, combo) if v is not None}
        want = set(every)
        for k, v in params.items():
            want &= singles[(k, v)]
        assert set(_ids(_list(client, **params))) == want, params


# ── Sort / pagination ──────────────────────────────────────────────────

def test_status_sort_groups_by_displayed_stage(client, _clear, monkeypatch):
    """The Status column shows the pipeline stage (rowStage), but sort=status
    ranks by the decision-overlaid raw status (leadership.py:374). Final
    pending and Final selected (both jury_review) share a rank, so the column
    is not grouped by what it shows; nor are 1st-gate vs final rejects."""
    _patch(monkeypatch, _tables())
    rows = _list(client, sort="status")["applications"]
    stages = [r["pipeline_stage"] for r in rows]
    order = ["submitted", "under_review", "reviewed", "gate1_rejected", "final_pending",
             "final_rejected", "final_selected", "offered", "onboarded"]
    ranks = [order.index(s) for s in stages]
    assert ranks == sorted(ranks), stages


def test_paging_is_deterministic_across_reordered_db_rows(client, _clear, monkeypatch):
    """Sort keys tie heavily (industry/status/reco/stage) and neither the DB
    fetch (_query_track_table has no .order) nor the Python sort adds an id
    tiebreak, so page N is only stable if Postgres returns rows in the same
    physical order on every request. Simulate a re-ordered heap (any UPDATE —
    e.g. a reviewer submitting — can move a tuple) between page 1 and page 2."""
    t = _tables()
    sb = _patch(monkeypatch, t)
    pages = []
    for off in range(0, 12, 3):
        pages += _list(client, sort="reco", limit=3, offset=off)["applications"]
        sb.tables["tir_applications"].reverse()
        sb.tables["sip_applications"].reverse()
    seen = [r["id"] for r in pages]
    assert len(seen) == len(set(seen)) == 12, seen


# ── Unchunked .in_() lookups (URL length) ──────────────────────────────

def test_score_and_industry_lookups_are_chunked(monkeypatch):
    """fetch_ai_scores_for / fetch_industry_for_pairs put EVERY id of a track in
    one `in.(…)` URL. Measured offline with postgrest-py: 400 uuids ≈ 15.7 KB,
    450 ≈ 17.7 KB. Sibling helpers chunk at 150 (≈ 6 KB). A 414/400 is
    swallowed (log.warning) → every score / industry = None → AI-score and
    industry filters return 0 rows and the columns render '—'."""
    sizes = []

    class Q:
        def __init__(self): pass
        def select(self, *a, **k): return self
        def eq(self, *a, **k): return self
        def in_(self, col, vals): sizes.append(len(list(vals))); return self
        def execute(self):
            from types import SimpleNamespace
            return SimpleNamespace(data=[])

    class SB:
        def table(self, n): return Q()

    monkeypatch.setattr(applications_query, "get_admin_client", lambda: SB())
    pairs = [("tir", f"{i:08d}-0000-0000-0000-000000000000") for i in range(400)]
    applications_query.fetch_ai_scores_for(pairs)
    applications_query.fetch_industry_for_pairs(pairs)
    applications_query.fetch_project_names_for(pairs)
    assert max(sizes) <= 150, sizes


def test_global_industry_unclassified_matches_list(client, _clear, monkeypatch):
    """No-track unclassified chip = list rows with no industry."""
    t = _tables()
    t["ai_screening"].append({"application_id": "gone", "application_track": "tir",
                              "score_overall": 5, "industry_category_id": "cli"})
    _patch(monkeypatch, t)
    res = client.get("/leadership/industry-categories",
                     headers={"Authorization": "Bearer t"}).json()
    for c in res["categories"]:
        assert c["count"] == _list(client, industry=c["id"])["total"], c
    assert res["unclassified"]["count"] == _list(client, industry="unclassified")["total"]
    assert res["apps_total"] == _list(client)["total"]


def test_chunked_lookup_failure_only_blanks_that_chunk(monkeypatch):
    """One failing chunk must not empty every score / industry (LF-2)."""
    from types import SimpleNamespace
    calls = {"n": 0}

    class Q:
        def __init__(self, name): self.name = name; self.ids = []
        def select(self, *a, **k): return self
        def eq(self, *a, **k): return self
        def in_(self, col, vals): self.ids = list(vals); return self
        def execute(self):
            if self.name == "industry_categories":
                return SimpleNamespace(data=[{"id": "rob", "label": "Robotics"}])
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("414 URI too long")
            return SimpleNamespace(data=[{"application_id": i, "score_overall": 5.0,
                                          "industry_category_id": "rob"} for i in self.ids])

    class SB:
        def table(self, n): return Q(n)

    monkeypatch.setattr(applications_query, "get_admin_client", lambda: SB())
    pairs = [("tir", f"id{i}") for i in range(300)]
    scores = applications_query.fetch_ai_scores_for(pairs)
    assert sum(1 for v in scores.values() if v is not None) == 150
    calls["n"] = 0
    inds = applications_query.fetch_industry_for_pairs(pairs)
    assert sum(1 for v in inds.values() if v) == 150


# ── ADM-F7: track-table read pages past PostgREST max_rows ─────────────

class _CappedQuery:
    """Honors .range() and caps every response at max_rows like PostgREST."""
    MAX_ROWS = 1000

    def __init__(self, rows, log):
        self._rows, self._log = rows, log
        self._range = None
        self._order = None

    def select(self, *a, **k): return self
    def neq(self, col, val): self._rows = [r for r in self._rows if r.get(col) != val]; return self
    def eq(self, col, val): self._rows = [r for r in self._rows if r.get(col) == val]; return self
    def or_(self, *a, **k): return self
    def limit(self, n): self._limit = n; return self
    def order(self, col, desc=False): self._order = col; return self
    def range(self, a, b): self._range = (a, b); self._log.append((a, b)); return self

    def execute(self):
        from types import SimpleNamespace
        rows = sorted(self._rows, key=lambda r: r[self._order]) if self._order else list(self._rows)
        if self._range:
            rows = rows[self._range[0]: self._range[1] + 1]
        return SimpleNamespace(data=rows[: self.MAX_ROWS])


def test_track_table_read_is_paginated_past_1000_rows(monkeypatch):
    tir = [{"id": f"t{i:05d}", "status": "submitted"} for i in range(2300)]
    tir.append({"id": "draft1", "status": "draft"})
    ranges: list = []

    class SB:
        def table(self, name):
            return _CappedQuery(tir if name == "tir_applications" else [], ranges)

    monkeypatch.setattr(applications_query, "get_admin_client", lambda: SB())
    from app.services import staff_exclusions
    monkeypatch.setattr(staff_exclusions, "visible", lambda rows, **k: rows)
    rows = applications_query.fetch_apps_for_track("tir")
    ids = [r["id"] for r in rows]
    assert len(ids) == len(set(ids)) == 2300
    assert ranges, "track-table read must page with .range()"


# ── LFV-1: broad project-name search must not inline every id in or() ──

class _UrlQuery:
    """PostgREST-ish: honours eq/neq/in_/ilike-or/order/range, caps responses
    at max_rows and raises (like a proxy 414) when the URL exceeds URL_LIMIT."""
    URL_LIMIT = 8192
    MAX_ROWS = 1000

    def __init__(self, sb, name):
        self.sb, self.name = sb, name
        self.rows = sb.tables.get(name, [])
        self.f, self._order, self._range, self._limit = [], None, None, None
        self.url = len(name) + 40

    def select(self, cols="*", **_k): self.url += len(cols); return self
    def eq(self, c, v): self.f.append(lambda r: r.get(c) == v); self.url += len(c) + len(str(v)) + 5; return self
    def neq(self, c, v): self.f.append(lambda r: r.get(c) != v); self.url += len(c) + len(str(v)) + 6; return self

    def in_(self, c, vals):
        vals = list(vals)
        self.sb.in_sizes.append((self.name, len(vals)))
        self.f.append(lambda r: r.get(c) in vals)
        self.url += len(c) + sum(len(str(v)) + 1 for v in vals) + 8
        return self

    def ilike(self, c, pat):
        needle = pat.strip("%").lower()
        self.f.append(lambda r: needle in str(r.get(c) or "").lower()); self.url += len(pat) + len(c) + 8
        return self

    def or_(self, expr):
        self.url += len(expr) + 6
        parts = []
        for p in expr.split(","):
            col, op, val = p.split(".", 2)
            parts.append((col, op, val.strip('"').strip("%").lower()))

        def match(r):
            for col, op, val in parts:
                if op == "ilike" and val in str(r.get(col) or "").lower():
                    return True
                if op == "eq" and str(r.get(col)) == val:
                    return True
            return False
        self.f.append(match)
        return self

    def order(self, col, desc=False, **_k): self._order = col; return self
    def range(self, a, b): self._range = (a, b); return self
    def limit(self, n): self._limit = n; return self

    def execute(self):
        from types import SimpleNamespace
        self.sb.urls.append(self.url)
        if self.url > self.URL_LIMIT:
            raise RuntimeError(f"414 URI too long ({self.url}) on {self.name}")
        data = [dict(r) for r in self.rows if all(fn(r) for fn in self.f)]
        if self._order:
            data.sort(key=lambda r: str(r.get(self._order)))
        if self._range:
            data = data[self._range[0]: self._range[1] + 1]
        if self._limit is not None:
            data = data[: self._limit]
        return SimpleNamespace(data=data[: self.MAX_ROWS])


class _UrlSB:
    def __init__(self, tables):
        self.tables, self.urls, self.in_sizes = tables, [], []

    def table(self, name):
        return _UrlQuery(self, name)


def test_broad_project_name_search_is_chunked_not_inlined(monkeypatch):
    import uuid
    tir = [{"id": str(uuid.UUID(int=(0xA << 120) + i)), "status": "under_review",
            "basic_org": f"Org{i}"} for i in range(450)]
    ai = [{"application_id": r["id"], "application_track": "tir",
           "project_name": f"Proj {i}"} for i, r in enumerate(tir)]
    # Matches by org only (no project-name hit) — must still be in the union.
    tir.append({"id": str(uuid.UUID(int=(0xB << 120))), "status": "under_review",
                "basic_org": "Projective Ltd"})
    tir.append({"id": str(uuid.UUID(int=(0xC << 120))), "status": "draft",
                "basic_org": "Project Draft"})
    sb = _UrlSB({"tir_applications": tir, "ai_screening": ai})
    monkeypatch.setattr(applications_query, "get_admin_client", lambda: sb)
    from app.services import staff_exclusions
    monkeypatch.setattr(staff_exclusions, "visible", lambda rows, **k: rows)

    rows = applications_query._query_track_table("tir", search="proj")
    ids = [r["id"] for r in rows]
    assert len(ids) == len(set(ids)) == 451, len(ids)
    assert ids == sorted(ids), "union must stay ordered by id"
    assert max(sb.urls) <= _UrlQuery.URL_LIMIT
    assert sb.in_sizes and max(n for _t, n in sb.in_sizes) <= 150
    # status filter still applies to the chunked id branch
    assert applications_query._query_track_table("tir", status="evaluated", search="proj") == []
