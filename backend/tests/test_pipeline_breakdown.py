"""Gate-aware pipeline breakdown on /leadership/stats + /admin/platform/stats
(contract C1) and the leadership list sort / search / stage filter (C2, C3).

The fixture `_prod_mix()` reproduces the prod mix of 2026-10-05 so the split
asserted here is the one the dashboards must show:
    605 = submitted 2 + under_review 76 + reviewed 345 + gate1_rejected 134
          + final_pending 10 + final_rejected 20 + final_selected 16 + onboarded 2
"""
from __future__ import annotations

import pytest

from app.main import app
from app.routers import leadership as lead_mod
from app.services import admin_query, applications_query, stats
from app.deps import get_current_user

from tests.fixtures.fake_supabase import FakeSupabase


STAGES = [
    "submitted", "under_review", "reviewed", "gate1_rejected", "final_pending",
    "final_rejected", "final_selected", "offered", "onboarded", "on_hold",
    "waitlisted", "withdrawn",
]


def _prod_mix() -> dict[str, list[dict]]:
    """Synthetic tables with the prod status / decision / IC-memo mix."""
    tir: list[dict] = []
    sip: list[dict] = []
    decisions: list[dict] = []
    ic: list[dict] = []
    ai: list[dict] = []
    seq = [26000]

    def add(table, track, status, *, moved=None, user=None):
        seq[0] += 1
        aid = f"{track}-{seq[0]}"
        row = {"id": aid, "status": status, "moved_to_track": moved,
               "display_seq": seq[0], "user_id": user or f"u-{aid}"}
        table.append(row)
        return aid

    def dec(track, aid, gate, decision, at):
        decisions.append({"application_id": aid, "application_track": track,
                          "gate_stage": gate, "decision": decision,
                          "decided_at": f"2026-09-{at:02d}T00:00:00Z"})

    # Effective TIR: evaluated 185, rejected 140, jury_review 23, onboarded 2, submitted 2
    for _ in range(185):
        add(tir, "tir", "evaluated")
    for _ in range(2):
        add(tir, "tir", "submitted")
    for _ in range(2):
        add(tir, "tir", "onboarded")
    # Effective VIP: evaluated 160, under_review 76, jury_review 3, rejected 14
    for _ in range(160):
        add(sip, "sip", "evaluated")
    for _ in range(76):
        add(sip, "sip", "under_review")

    # 26 jury_review apps: 23 TIR (one of those native VIP moved to TIR? no —
    # prod has 1 native TIR moved to VIP), 3 VIP = 2 native VIP + 1 TIR→VIP.
    jury: list[tuple[str, str]] = []
    for _ in range(23):
        jury.append(("tir", add(tir, "tir", "jury_review")))
    for _ in range(2):
        jury.append(("sip", add(sip, "sip", "jury_review")))
    jury.append(("tir", add(tir, "tir", "jury_review", moved="sip")))
    for t, aid in jury:
        dec(t, aid, "gate1", "jury_review", 1)
    # 16 of them carry only signed current memos; 10 are pending (5 unsigned,
    # 5 with no memo). One fully signed app also has a superseded unsigned doc.
    for i, (t, aid) in enumerate(jury):
        if i < 16:
            ic.append({"application_id": aid, "application_track": t,
                       "signed_at": "2026-09-10", "superseded_at": None})
            if i == 0:
                ic.append({"application_id": aid, "application_track": t,
                           "signed_at": None, "superseded_at": "2026-09-09"})
                ic.append({"application_id": aid, "application_track": t,
                           "signed_at": "2026-09-11", "superseded_at": None})
        elif i < 21:
            ic.append({"application_id": aid, "application_track": t,
                       "signed_at": "2026-09-10", "superseded_at": None})
            ic.append({"application_id": aid, "application_track": t,
                       "signed_at": None, "superseded_at": None})

    # 154 rejected: 20 final-gate (gate1 jury_review then gate2 rejected),
    # 133 gate1 rejected, 1 rejected with no decision row at all.
    # Effective TIR rejected 140, VIP 14.
    rejected: list[tuple[str, str]] = []
    for _ in range(140):
        rejected.append(("tir", add(tir, "tir", "rejected")))
    for _ in range(14):
        rejected.append(("sip", add(sip, "sip", "rejected")))
    for i, (t, aid) in enumerate(rejected):
        if i < 20:
            dec(t, aid, "gate1", "jury_review", 1)
            dec(t, aid, "gate2", "rejected", 5)
            # final-round rejects can still hold fully signed memos (prod: 2)
            if i < 2:
                ic.append({"application_id": aid, "application_track": t,
                           "signed_at": "2026-09-10", "superseded_at": None})
        elif i < 153:
            dec(t, aid, "gate1", "rejected", 2)
        # i == 153 → rejected with no decision row

    # 1421 drafts would bloat the fixture; 3 drafts (one user owns two).
    add(tir, "tir", "draft", user="dup-user")
    add(sip, "sip", "draft", user="dup-user")
    add(tir, "tir", "draft")

    for track, rows in (("tir", tir), ("sip", sip)):
        for r in rows:
            if r["status"] == "draft":
                continue
            ai.append({"application_id": r["id"], "application_track": track,
                       "score_overall": 7.0, "score_problem": 8.0,
                       "score_completeness": 7.0, "score_tech": 6.0,
                       "score_founders": 5.0, "score_commitment": 9.0})
    # a screening row for a draft must not move the means
    ai.append({"application_id": tir[-1]["id"], "application_track": "tir",
               "score_overall": 1.0, "score_problem": 1.0, "score_completeness": 1.0,
               "score_tech": 1.0, "score_founders": 1.0, "score_commitment": 1.0})
    # one non-draft app without a score_overall (screening row exists, unscored)
    ai[0]["score_overall"] = None

    return {
        "tir_applications": tir, "sip_applications": sip,
        "admin_decisions": decisions, "ic_documents": ic, "ai_screening": ai,
        "profiles": [{"id": f"p{i}"} for i in range(10)],
        "reviews": [], "reviewer_assignments": [], "reviewer_profiles": [],
        "industry_categories": [],
    }


def _patch_all(monkeypatch, tables) -> FakeSupabase:
    sb = FakeSupabase(tables)
    for mod in (stats, applications_query, admin_query, lead_mod):
        monkeypatch.setattr(mod, "get_admin_client", lambda: sb)
    return sb


def _override(roles):
    def _f():
        return {"user_id": "u1", "email": "u1@x.com", "roles": roles}
    return _f


@pytest.fixture
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


# ─── Pure classifier ───────────────────────────────────────────────────


def test_build_pipeline_breakdown_prod_mix():
    t = _prod_mix()
    apps = ([{**r, "track": "tir"} for r in t["tir_applications"]]
            + [{**r, "track": "sip"} for r in t["sip_applications"]])
    pb = stats.build_pipeline_breakdown(apps, t["admin_decisions"], t["ic_documents"])

    assert pb["total"] == 605
    assert set(pb["stages"]) == set(STAGES)
    assert sum(pb["stages"].values()) == pb["total"]
    assert pb["stages"] == {
        "submitted": 2, "under_review": 76, "reviewed": 345, "gate1_rejected": 134,
        "final_pending": 10, "final_rejected": 20, "final_selected": 16,
        "offered": 0, "onboarded": 2, "on_hold": 0, "waitlisted": 0, "withdrawn": 0,
    }
    assert pb["gate1_selected"] == 48
    assert pb["rejected_total"] == 154

    by = pb["by_track"]
    for track in ("tir", "sip"):
        assert sum(by[track]["stages"].values()) == by[track]["total"]
    assert by["tir"]["total"] + by["sip"]["total"] == 605
    # effective track: the TIR→VIP mover counts as VIP
    assert by["tir"]["stages"]["final_pending"] + by["tir"]["stages"]["final_selected"] == 23
    assert by["sip"]["stages"]["final_pending"] + by["sip"]["stages"]["final_selected"] == 3
    assert by["tir"]["rejected_total"] == 140 and by["sip"]["rejected_total"] == 14


def test_pipeline_stage_rules():
    assert stats.pipeline_stage("ai_screening", None, False) == "submitted"
    assert stats.pipeline_stage("screening_failed", None, False) == "submitted"
    assert stats.pipeline_stage("evaluated", None, False) == "reviewed"
    assert stats.pipeline_stage("rejected", None, False) == "gate1_rejected"
    assert stats.pipeline_stage("rejected", "rejected", True) == "final_rejected"
    assert stats.pipeline_stage("jury_review", None, True) == "final_selected"
    assert stats.pipeline_stage("jury_review", None, False) == "final_pending"
    assert stats.pipeline_stage("on_hold", None, False) == "on_hold"
    assert stats.pipeline_stage("draft", None, False) is None


def test_effective_status_no_longer_relabels_shortlist_as_accepted():
    assert stats.effective_status("jury_review", {"decision": "jury_review"}) == "jury_review"
    assert stats.effective_status("evaluated", {"decision": "shortlisted"}) == "jury_review"
    assert stats.effective_status("jury_review", {"decision": "rejected"}) == "rejected"
    # a later-stage raw status is never rolled back by an older decision
    assert stats.effective_status("onboarded", {"decision": "jury_review"}) == "onboarded"


# ─── /leadership/stats + /admin/platform/stats ────────────────────────


def _get_stats(client, monkeypatch, path="/leadership/stats", roles=("leadership",)):
    _patch_all(monkeypatch, _prod_mix())
    app.dependency_overrides[get_current_user] = _override(list(roles))
    res = client.get(path, headers={"Authorization": "Bearer t"})
    assert res.status_code == 200, res.text
    return res.json()


def test_leadership_stats_pipeline_breakdown_and_counts(client, _clear_overrides, monkeypatch):
    body = _get_stats(client, monkeypatch)
    pb = body["pipeline_breakdown"]
    assert pb["total"] == 605 and sum(pb["stages"].values()) == 605
    assert pb["gate1_selected"] == 48 and pb["rejected_total"] == 154

    sc = {s["id"]: s["n"] for s in body["status_counts"]}
    assert sc["jury_review"] == 26
    assert sc.get("accepted", 0) == 0
    assert sum(sc.values()) == 605

    by = {s["id"]: s for s in body["status_counts_by_track"]}
    assert by["jury_review"]["tir"] == 23 and by["jury_review"]["sip"] == 3
    assert sum(s["tir"] + s["sip"] for s in body["status_counts_by_track"]) == 605

    t = body["totals"]
    assert t["apps_submitted"] == 605
    assert t["tir_count"] + t["sip_count"] == 605
    assert t["advanced_past_review"] == 48
    assert t["onboarded"] == 2

    f = body["funnel"]
    assert f["submitted"] == 605
    assert f["in_review"] == 76
    assert f["advanced"] == 48
    assert f["decided"] == 18          # final_selected 16 + offered 0 + onboarded 2
    assert f["drafted"] == 3
    assert f["started"] == 607         # distinct users over drafts + submitted


def test_leadership_stats_ai_component_means(client, _clear_overrides, monkeypatch):
    body = _get_stats(client, monkeypatch)
    assert body["ai_component_means"] == {
        "problem": 8.0, "solution": 7.0, "tech": 6.0, "founders": 5.0, "commitment": 9.0,
    }
    assert body["ai_scored_count"] == 604


def test_admin_stats_carries_pipeline_breakdown(client, _clear_overrides, monkeypatch):
    body = _get_stats(client, monkeypatch, path="/admin/platform/stats", roles=("admin",))
    assert body["pipeline_breakdown"]["stages"]["final_selected"] == 16
    assert body["funnel"]["in_review"] == 76
    assert "decisions" in body
