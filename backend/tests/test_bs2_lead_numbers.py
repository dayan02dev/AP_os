"""Swarm2 — leadership dashboard numbers. Each test asserts CORRECT behaviour,
so a FAIL means the bug is present at 837ccf0."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.deps import get_current_user
from app.main import app
from app.routers import leadership as lead_mod
from app.services import admin_query, applications_query, industry_categories, stats

from tests.fixtures.fake_supabase import FakeSupabase


@pytest.fixture
def lead_client(monkeypatch):
    from app.utils.rate_limit import limiter
    monkeypatch.setattr(limiter, "enabled", False)
    app.dependency_overrides[get_current_user] = lambda: {
        "user_id": "lead-1", "email": "l@x.io", "roles": ["leadership"]}
    yield TestClient(app)
    app.dependency_overrides.clear()


class _FailingSB(FakeSupabase):
    """FakeSupabase whose reads of `fail` tables raise (transient PostgREST error)."""

    def __init__(self, tables, fail=()):
        super().__init__(tables)
        self._fail = set(fail)

    def table(self, name):
        if name in self._fail:
            raise RuntimeError(f"transient PostgREST error on {name}")
        return super().table(name)


def _patch(monkeypatch, sb):
    for mod in (stats, applications_query, admin_query, lead_mod, industry_categories):
        monkeypatch.setattr(mod, "get_admin_client", lambda: sb)


def _tables():
    return {
        "tir_applications": [
            {"id": "t1", "user_id": "u1", "status": "rejected", "display_seq": 1},
            {"id": "t2", "user_id": "u2", "status": "jury_review", "display_seq": 2},
            {"id": "t3", "user_id": "u3", "status": "evaluated", "display_seq": 3},
        ],
        "sip_applications": [
            {"id": "s1", "user_id": "u4", "status": "evaluated", "display_seq": 101},
            {"id": "s2", "user_id": "u5", "status": "under_review", "display_seq": 102},
        ],
        "admin_decisions": [
            {"id": "d1", "application_id": "t1", "application_track": "tir", "gate_stage": "gate1",
             "decision": "jury_review", "decided_at": "2026-09-01T00:00:00Z"},
            {"id": "d2", "application_id": "t1", "application_track": "tir", "gate_stage": "gate2",
             "decision": "rejected", "decided_at": "2026-09-05T00:00:00Z"},
            {"id": "d3", "application_id": "t2", "application_track": "tir", "gate_stage": "gate1",
             "decision": "jury_review", "decided_at": "2026-09-01T00:00:00Z"},
        ],
        "ic_documents": [
            {"id": "i1", "application_id": "t2", "application_track": "tir",
             "signed_at": "2026-09-10", "superseded_at": None},
        ],
        "ai_screening": [],
        "profiles": [
            {"id": "u1"}, {"id": "u2"}, {"id": "u3"}, {"id": "u4"}, {"id": "u5"},
            # staff accounts (reviewers / leadership) — not applicant sign-ups
            {"id": "rev-1"}, {"id": "rev-2"}, {"id": "lead-1"},
        ],
        "user_roles": [
            {"user_id": "rev-1", "role": "reviewer"},
            {"user_id": "rev-2", "role": "reviewer"},
            {"user_id": "lead-1", "role": "leadership"},
        ],
    }


def test_baseline_stats_are_right(lead_client, monkeypatch):
    """Sanity: with every read healthy the stages are right (so the next two
    tests isolate the swallowed-failure behaviour)."""
    _patch(monkeypatch, _FailingSB(_tables()))
    body = lead_client.get("/leadership/stats").json()
    st = body["pipeline_breakdown"]["stages"]
    assert st["final_rejected"] == 1 and st["final_selected"] == 1
    assert body["totals"]["apps_submitted"] == 5


def test_stats_decisions_read_failure_is_not_silently_misreported(lead_client, monkeypatch):
    """admin_decisions read fails -> fetch_decision_rows returns [] -> the final-round
    reject t1 is silently re-bucketed as '1st-gate rejected' and the dashboard
    answers 200 with no hint that the numbers are degraded."""
    _patch(monkeypatch, _FailingSB(_tables(), fail={"admin_decisions"}))
    res = lead_client.get("/leadership/stats")
    body = res.json() if res.status_code == 200 else {}
    st = (body.get("pipeline_breakdown") or {}).get("stages") or {}
    degraded = res.status_code >= 500 or body.get("degraded") or body.get("errors")
    assert degraded or st.get("final_rejected") == 1, (
        f"HTTP {res.status_code}, final_rejected={st.get('final_rejected')} "
        f"gate1_rejected={st.get('gate1_rejected')} — wrong split served as if healthy")


def test_stats_ic_documents_read_failure_is_not_silently_misreported(lead_client, monkeypatch):
    """ic_documents read fails -> every Final-selected app silently becomes 'Final pending'."""
    _patch(monkeypatch, _FailingSB(_tables(), fail={"ic_documents"}))
    res = lead_client.get("/leadership/stats")
    body = res.json() if res.status_code == 200 else {}
    st = (body.get("pipeline_breakdown") or {}).get("stages") or {}
    degraded = res.status_code >= 500 or body.get("degraded") or body.get("errors")
    assert degraded or st.get("final_selected") == 1, (
        f"HTTP {res.status_code}, final_selected={st.get('final_selected')} "
        f"final_pending={st.get('final_pending')} — wrong split served as if healthy")


def test_stats_track_table_read_failure_is_not_silent(lead_client, monkeypatch):
    """sip_applications read fails -> fetch_app_status_rows logs and `continue`s:
    'Applications submitted' drops every VIP app and the dashboard still 200s."""
    _patch(monkeypatch, _FailingSB(_tables(), fail={"sip_applications"}))
    res = lead_client.get("/leadership/stats")
    body = res.json() if res.status_code == 200 else {}
    degraded = res.status_code >= 500 or body.get("degraded") or body.get("errors")
    total = (body.get("totals") or {}).get("apps_submitted")
    assert degraded or total == 5, (
        f"HTTP {res.status_code}, apps_submitted={total} (true 5), sip_count="
        f"{(body.get('totals') or {}).get('sip_count')} — a whole track vanished silently")


def test_profiles_signed_up_excludes_staff_accounts(lead_client, monkeypatch):
    """'Profiles signed up' / funnel 'Profiles' = count(*) of every profiles row,
    so reviewer / leadership / admin / jury accounts are counted as sign-ups
    (every other dashboard number is applicant-only)."""
    _patch(monkeypatch, _FailingSB(_tables()))
    body = lead_client.get("/leadership/stats").json()
    assert body["totals"]["profiles_signed_up"] == 5, (
        f"profiles_signed_up={body['totals']['profiles_signed_up']} includes 3 staff accounts")


def test_avg_ai_score_population_matches_scored_count(lead_client, monkeypatch):
    """LEAD-06 still open: avg_ai_score / ai_score_overalls (histogram, MEAN, N)
    read every ai_screening row; ai_scored_count is non-draft only."""
    t = _tables()
    t["tir_applications"].append({"id": "t9", "user_id": "u9", "status": "draft"})
    t["ai_screening"] = [
        {"application_id": "t3", "application_track": "tir", "score_overall": 8.0},
        {"application_id": "t9", "application_track": "tir", "score_overall": 2.0},   # draft
        {"application_id": "gone", "application_track": "sip", "score_overall": 2.0},  # orphan
    ]
    _patch(monkeypatch, _FailingSB(t))
    body = lead_client.get("/leadership/stats").json()
    assert body["ai_scored_count"] == 1
    assert len(body["ai_score_overalls"]) == body["ai_scored_count"], body["ai_score_overalls"]
    assert body["totals"]["avg_ai_score"] == 8.0


def _dec(aid, gate, decision, day):
    return {"application_id": aid, "application_track": "tir", "gate_stage": gate,
            "decision": decision, "decided_at": f"2026-09-{day:02d}T00:00:00Z"}


def test_gate2_hold_or_waitlist_still_counts_as_1st_gate_selected():
    """LEAD-05 / NS-8 still open at 837ccf0."""
    apps = [{"id": "w", "track": "tir", "status": "waitlisted"},
            {"id": "h", "track": "tir", "status": "on_hold"}]
    decs = [_dec("w", "gate1", "jury_review", 1), _dec("w", "gate2", "waitlisted", 2),
            _dec("h", "gate1", "jury_review", 1), _dec("h", "gate2", "on_hold", 2)]
    pb = stats.build_pipeline_breakdown(apps, decs, [])
    assert pb["gate1_selected"] == 2, pb["stages"]


def test_reject_after_final_round_is_final_rejected_even_if_written_as_gate1():
    """NS-9 still open: a reject recorded on the gate-1 path after the app reached
    the final round (gate1 jury_review earlier) is bucketed '1st-gate rejected'."""
    apps = [{"id": "x", "track": "tir", "status": "rejected"}]
    decs = [_dec("x", "gate1", "jury_review", 1), _dec("x", "gate1", "rejected", 5)]
    pb = stats.build_pipeline_breakdown(apps, decs, [])
    assert pb["stages"]["final_rejected"] == 1, pb["stages"]
