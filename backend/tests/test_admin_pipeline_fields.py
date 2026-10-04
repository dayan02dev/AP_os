"""Admin pipeline row fields + search (contract C2; ADM-05/08/17/18/19, LEAD-11)."""
from __future__ import annotations

import pytest

from app.services import admin_query, applications_query

from tests.fixtures.fake_supabase import FakeSupabase


def _rv(app, rid, rec, score, track="tir", submitted="2026-07-01T00:00:00Z"):
    return {"application_id": app, "application_track": track, "reviewer_user_id": rid,
            "submitted_at": submitted, "recommendation": rec,
            "score_problem": score, "score_solution": score, "score_tech": score,
            "score_founders": score, "score_commitment": score}


def _asg(app, rid, track="tir"):
    return {"application_id": app, "application_track": track, "reviewer_user_id": rid,
            "declined_at": None, "reassigned_to": None}


def _backend():
    return FakeSupabase({
        "tir_applications": [
            {"id": "A", "status": "rejected", "display_seq": 27326,
             "basic_full_name": "Asha R", "basic_org": "Acme", "basic_email": "asha@artpark.in",
             "submitted_at": "2026-07-01T00:00:00Z"},
            {"id": "B", "status": "under_review", "display_seq": 26002,
             "basic_full_name": "Bo K", "basic_org": "Beta", "basic_email": "b@x.io",
             "submitted_at": "2026-07-02T00:00:00Z"},
        ],
        "sip_applications": [
            {"id": "S", "status": "evaluated", "display_seq": 26255,
             "basic_full_name": "Sam", "basic_org": "Hyetron Energy", "basic_email": "s@h.io",
             "submitted_at": "2026-07-03T00:00:00Z"},
        ],
        "ai_screening": [
            {"application_id": "B", "application_track": "tir",
             "project_name": "Quantum Widgets", "score_overall": 7.0},
        ],
        "reviewer_profiles": [{"reviewer_user_id": "rv1", "weight": 1.0},
                              {"reviewer_user_id": "rv2", "weight": 1.0},
                              {"reviewer_user_id": "rv3", "weight": 1.0}],
        "reviews": [
            # A: 3 submitted reviews, assignment rows all deleted (Gate-1 reject).
            _rv("A", "rv1", "no", 3), _rv("A", "rv2", "no", 4), _rv("A", "rv3", "maybe", 5),
            # B: 1 submitted review by rv1 (assigned); rv2 assigned, not reviewed.
            _rv("B", "rv1", "yes", 8),
        ],
        "reviewer_assignments": [_asg("B", "rv1"), _asg("B", "rv2")],
        "admin_decisions": [
            {"application_id": "A", "application_track": "tir", "gate_stage": "gate1",
             "decision": "jury_review", "decided_at": "2026-07-10T00:00:00Z",
             "decided_by": "admin-1"},
            {"application_id": "A", "application_track": "tir", "gate_stage": "gate2",
             "decision": "rejected", "decided_at": "2026-08-10T00:00:00Z",
             "decided_by": "admin-2"},
        ],
    })


@pytest.fixture
def sb(monkeypatch):
    sb = _backend()
    monkeypatch.setattr(admin_query, "get_admin_client", lambda: sb)
    monkeypatch.setattr(applications_query, "get_admin_client", lambda: sb)
    return sb


def _rows(filters=None):
    res = admin_query.fetch_pipeline(filters or {})
    return {a["id"]: a for a in res["applications"]}


# ─── Review counts (ADM-08 / LEAD-11 / ADM-18) ─────────────────────────


def test_review_stats_assigned_is_union_never_below_submitted(sb):
    out = admin_query._fetch_review_stats([("tir", "A"), ("tir", "B")])
    a = out[("tir", "A")]
    assert a["submitted"] == 3
    assert a["assigned"] == 3          # no "3 / 0"
    assert a["active"] == 0
    assert a["detached"] == 3          # reviewed but no longer assigned
    b = out[("tir", "B")]
    assert (b["submitted"], b["assigned"], b["active"], b["detached"]) == (1, 2, 2, 0)


def test_review_stats_review_count_drives_reco_bucket(sb):
    out = admin_query._fetch_review_stats([("tir", "A"), ("tir", "B")])
    assert out[("tir", "A")]["review_count"] == 3
    assert out[("tir", "B")]["review_count"] == 1


def test_pipeline_row_exposes_review_counts(sb):
    rows = _rows()
    assert rows["A"]["reviews_submitted"] == 3
    assert rows["A"]["reviewers_assigned"] == 3
    assert rows["A"]["reviewers_detached"] == 3
    assert rows["A"]["review_count"] == 3
    assert rows["B"]["reviews_submitted"] == 1
    assert rows["B"]["reviewers_assigned"] == 2
    assert rows["B"]["review_count"] == 1
    # an app nobody touched still carries zeroes, not missing keys
    assert rows["S"]["review_count"] == 0
    assert rows["S"]["reviews_submitted"] == 0


# ─── Gate decisions (ADM-05 / ADM-19) ──────────────────────────────────


def test_pipeline_row_has_gate1_decision_separate_from_gate2(sb):
    a = _rows()["A"]
    assert a["decision"] == "rejected"           # latest of any gate (unchanged)
    assert a["gate1_decision"] == "jury_review"  # 1st-gate approval survives
    assert a["gate2_decision"] == "rejected"
    assert a["gate1_decided_at"] == "2026-07-10T00:00:00Z"
    assert a["gate1_decided_by"] == "admin-1"
    assert a["decided_at"] == "2026-08-10T00:00:00Z"
    assert a["decided_by"] == "admin-2"


def test_pipeline_row_gate1_decision_null_when_undecided(sb):
    b = _rows()["B"]
    assert b["gate1_decision"] is None
    assert b["decided_at"] is None


def test_pipeline_row_carries_email(sb):
    assert _rows()["A"]["email"] == "asha@artpark.in"


# ─── Search (ADM-17 / C2) ──────────────────────────────────────────────


@pytest.mark.parametrize("needle,expected", [
    ("TIR-27326", {"A"}),
    ("tir-27326", {"A"}),
    ("  27326 ", {"A"}),
    ("VIP-26255", {"S"}),
    ("SIP-26255", {"S"}),
    ("artpark.in", {"A"}),
    ("hyetron", {"S"}),
    ("quantum", {"B"}),
])
def test_pipeline_search_matches_ids_emails_names(sb, needle, expected):
    assert set(_rows({"search": needle})) == expected


class _RecQuery:
    def __init__(self, log, name):
        self._log, self._name = log, name

    def __getattr__(self, attr):
        def _chain(*a, **k):
            self._log.append((self._name, attr, a, k))
            return self
        return _chain

    def execute(self):
        from types import SimpleNamespace
        return SimpleNamespace(data=[], count=0)


class _RecClient:
    def __init__(self):
        self.log = []

    def table(self, name):
        return _RecQuery(self.log, name)


def _or_filter(monkeypatch, search):
    rec = _RecClient()
    monkeypatch.setattr(applications_query, "get_admin_client", lambda: rec)
    applications_query._query_track_table("tir", search=search)
    ors = [c[2][0] for c in rec.log if c[0] == "tir_applications" and c[1] == "or_"]
    assert len(ors) == 1
    return ors[0], rec


def test_db_search_display_id_prefix_maps_to_display_seq(monkeypatch):
    f, _ = _or_filter(monkeypatch, " TIR-27326 ")
    assert "display_seq.eq.27326" in f


def test_db_search_trims_input(monkeypatch):
    f, rec = _or_filter(monkeypatch, "  acme  ")
    assert '"%acme%"' in f
    ilikes = [c for c in rec.log if c[0] == "ai_screening" and c[1] == "ilike"]
    assert ilikes and ilikes[0][2][1] == "%acme%"


def test_db_search_quotes_commas_and_parens(monkeypatch):
    f, _ = _or_filter(monkeypatch, 'Acme (Pvt), "Ltd"')
    assert 'basic_full_name.ilike."%Acme (Pvt), \\"Ltd\\"%"' in f
    # exactly the three identity fields — the comma did not split the filter
    assert f.count("ilike.") == 3


def test_db_search_blank_is_no_filter(monkeypatch):
    rec = _RecClient()
    monkeypatch.setattr(applications_query, "get_admin_client", lambda: rec)
    applications_query._query_track_table("tir", search="   ")
    assert not [c for c in rec.log if c[1] == "or_"]


# ─── Reviewer score: list == detail (ADM-09) ───────────────────────────


def test_detail_reviewer_score_matches_list_weighted_score(monkeypatch):
    sb = FakeSupabase({
        "tir_applications": [
            {"id": "W", "status": "evaluated", "display_seq": 26100,
             "basic_full_name": "W", "basic_email": "w@x.io",
             "submitted_at": "2026-07-01T00:00:00Z"},
        ],
        "reviewer_profiles": [{"reviewer_user_id": "heavy", "weight": 3.0},
                              {"reviewer_user_id": "light", "weight": 1.0}],
        "reviews": [_rv("W", "heavy", "yes", 8), _rv("W", "light", "no", 4),
                    # draft — never scored
                    _rv("W", "draft", "yes", 1, submitted=None)],
        "reviewer_assignments": [],
    })
    monkeypatch.setattr(admin_query, "get_admin_client", lambda: sb)
    monkeypatch.setattr(applications_query, "get_admin_client", lambda: sb)
    list_score = admin_query.fetch_pipeline({})["applications"][0]["reviewer_score"]
    detail = admin_query.fetch_detail("tir", "W")
    assert list_score == 7.0                     # (3*8 + 1*4) / 4
    assert detail["reviewer_score"] == list_score
    assert detail["reviewer_score_basis"] == "weighted_by_reviewer"
    # The weights behind reviewer_score are sent so the detail's category means
    # can use the same weighting (default 1.0 for a reviewer with no profile).
    assert detail["reviewer_weights"] == {"heavy": 3.0, "light": 1.0, "draft": 1.0}
