"""Residency journey: experiments/tasks CRUD, mentor review state machine,
residency-dashboard rollup math, procurement sync, and mentor pod."""
from __future__ import annotations

import pytest

from app.deps import get_current_user
from app.main import app
from tests.fixtures.fake_supabase import FakeSupabase


@pytest.fixture
def _clear():
    yield
    app.dependency_overrides.clear()


def _override_user(uid):
    def _f():
        return {"user_id": uid, "email": f"{uid}@x.com", "track": "tir", "roles": ["applicant"]}
    return _f


def _install(monkeypatch, tables):
    from app.routers import founder as fr
    from app.routers import founder_journey as frj
    from app.services import founder_journey_query as fjq
    from app.services import founder_query as fq
    fake = FakeSupabase(tables)
    for mod in (fr, frj, fjq, fq):
        monkeypatch.setattr(mod, "get_admin_client", lambda: fake)
    return fake


_APP = {"id": "app1", "user_id": "u1", "status": "onboarded",
        "grant_amount": 2500000, "submitted_at": "2026-07-01"}


# ── Experiments ─────────────────────────────────────────────────────────
def test_experiment_crud_roundtrip(client, monkeypatch, _clear):
    fake = _install(monkeypatch, {
        "tir_applications": [_APP],
        "founder_experiments": [],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")

    r = client.post("/founder/experiments", json={"track": "technical"})
    assert r.status_code == 200, r.text
    row = r.json()
    assert row["track"] == "technical"
    assert row["gate"] == 1
    assert row["risk"] == "medium"
    assert row["status"] == "not-started"
    assert row["test_type"] == "literature"
    assert row["start_week"] == 1
    assert row["weeks"] == 4
    rid = row["id"]

    listed = client.get("/founder/experiments").json()
    assert len(listed) == 1

    patched = client.patch(f"/founder/experiments/{rid}", json={
        "status": "running", "assumption": "Signal exists.",
    })
    assert patched.status_code == 200, patched.text
    assert patched.json()["status"] == "running"
    assert patched.json()["assumption"] == "Signal exists."

    assert client.delete(f"/founder/experiments/{rid}").status_code == 204
    assert client.get("/founder/experiments").json() == []
    assert fake.tables["founder_experiments"] == []


def test_experiments_ordered_by_track_then_sort_order(client, monkeypatch, _clear):
    _install(monkeypatch, {
        "tir_applications": [_APP],
        "founder_experiments": [
            {"id": "e2", "application_id": "app1", "track": "technical", "sort_order": 1,
             "gate": 1, "risk": "medium", "status": "not-started", "test_type": "literature",
             "start_week": 1, "weeks": 4},
            {"id": "c1", "application_id": "app1", "track": "commercial", "sort_order": 0,
             "gate": 1, "risk": "medium", "status": "not-started", "test_type": "literature",
             "start_week": 1, "weeks": 4},
            {"id": "e1", "application_id": "app1", "track": "technical", "sort_order": 0,
             "gate": 1, "risk": "medium", "status": "not-started", "test_type": "literature",
             "start_week": 1, "weeks": 4},
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    ids = [e["id"] for e in client.get("/founder/experiments").json()]
    assert ids == ["c1", "e1", "e2"]  # commercial before technical (alpha), then sort_order


def test_cannot_edit_or_delete_another_apps_experiment(client, monkeypatch, _clear):
    _install(monkeypatch, {
        "tir_applications": [_APP],
        "founder_experiments": [{"id": "ex-other", "application_id": "app-OTHER",
                                 "track": "technical"}],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    assert client.patch("/founder/experiments/ex-other", json={"risk": "low"}).status_code == 404
    assert client.delete("/founder/experiments/ex-other").status_code == 404


# ── Tasks ───────────────────────────────────────────────────────────────
def test_task_crud_roundtrip_with_exp_fk(client, monkeypatch, _clear):
    fake = _install(monkeypatch, {
        "tir_applications": [_APP],
        "founder_experiments": [{"id": "e1", "application_id": "app1", "track": "technical",
                                 "sort_order": 0, "gate": 1, "risk": "high", "status": "running",
                                 "test_type": "retro", "start_week": 1, "weeks": 6,
                                 "assumption": "x"}],
        "founder_tasks": [],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")

    r = client.post("/founder/tasks", json={
        "task": "Curate recordings", "exp_id": "e1", "owner": "Meera", "effort": 3,
    })
    assert r.status_code == 200, r.text
    row = r.json()
    assert row["exp_id"] == "e1"
    assert row["status"] == "todo"
    rid = row["id"]

    assert len(client.get("/founder/tasks").json()) == 1
    patched = client.patch(f"/founder/tasks/{rid}", json={"status": "done"})
    assert patched.json()["status"] == "done"
    assert client.delete(f"/founder/tasks/{rid}").status_code == 204
    assert fake.tables["founder_tasks"] == []


def test_tasks_ordered_by_sort_order(client, monkeypatch, _clear):
    _install(monkeypatch, {
        "tir_applications": [_APP],
        "founder_tasks": [
            {"id": "t2", "application_id": "app1", "sort_order": 1, "task": "b",
             "owner": "", "effort": 1, "status": "todo"},
            {"id": "t1", "application_id": "app1", "sort_order": 0, "task": "a",
             "owner": "", "effort": 1, "status": "todo"},
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    ids = [t["id"] for t in client.get("/founder/tasks").json()]
    assert ids == ["t1", "t2"]


def test_cannot_delete_another_apps_task(client, monkeypatch, _clear):
    _install(monkeypatch, {
        "tir_applications": [_APP],
        "founder_tasks": [{"id": "t-other", "application_id": "app-OTHER", "task": "x"}],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    assert client.delete("/founder/tasks/t-other").status_code == 404


# ── Mentor review state machine ─────────────────────────────────────────
def test_review_defaults_to_draft(client, monkeypatch, _clear):
    _install(monkeypatch, {"tir_applications": [_APP], "founder_review": []})
    app.dependency_overrides[get_current_user] = _override_user("u1")
    body = client.get("/founder/review").json()
    assert body["status"] == "draft"
    assert body["approved_by"] is None


def test_review_submit_then_advance_to_approved(client, monkeypatch, _clear):
    fake = _install(monkeypatch, {"tir_applications": [_APP], "founder_review": []})
    app.dependency_overrides[get_current_user] = _override_user("u1")

    r1 = client.post("/founder/review/submit")
    assert r1.status_code == 200, r1.text
    assert r1.json()["status"] == "pending"
    assert client.get("/founder/review").json()["status"] == "pending"

    r2 = client.post("/founder/review/advance")
    assert r2.status_code == 200, r2.text
    approved = r2.json()
    assert approved["status"] == "approved"
    assert approved["approved_by"] == "Dr. Anitha Krishnan"
    assert approved["approved_on"]  # a date string was set
    assert "shadow deployment is the right first bet" in approved["mentor_comment"]

    # persisted as a single row keyed on application_id (upsert, not append)
    assert len(fake.tables["founder_review"]) == 1
    assert client.get("/founder/review").json()["status"] == "approved"


def test_advance_without_pending_review_is_conflict(client, monkeypatch, _clear):
    _install(monkeypatch, {"tir_applications": [_APP], "founder_review": []})
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.post("/founder/review/advance")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "review_not_pending"


def test_resubmitting_after_approval_resets_to_pending(client, monkeypatch, _clear):
    _install(monkeypatch, {
        "tir_applications": [_APP],
        "founder_review": [{"application_id": "app1", "status": "approved",
                            "approved_by": "Dr. Anitha Krishnan", "approved_on": "14 Jul 2026",
                            "mentor_comment": "..."}],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.post("/founder/review/submit")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "pending"
    assert body["approved_by"] is None
    assert body["mentor_comment"] is None


# ── Mentors ─────────────────────────────────────────────────────────────
def test_mentors_returns_three(client, monkeypatch, _clear):
    _install(monkeypatch, {"tir_applications": [_APP]})
    app.dependency_overrides[get_current_user] = _override_user("u1")
    body = client.get("/founder/mentors").json()
    assert len(body) == 3
    names = {m["name"] for m in body}
    assert names == {"Dr. Anitha Krishnan", "Rahul Menon", "Prof. S. Iyer"}
    ak = next(m for m in body if m["id"] == "ak")
    assert ak["review_focus"] == "Clinical + ethics"
    assert "brings" in ak and "bio" in ak
    assert len(ak["tags"]) == 3


# ── Residency dashboard rollup math ─────────────────────────────────────
def test_residency_rollup_math(client, monkeypatch, _clear):
    app_with_name = {**_APP, "ai_screening_project_name": {"project_name": "Neonatal sepsis monitor"}}
    _install(monkeypatch, {
        "tir_applications": [app_with_name],
        "founder_experiments": [
            {"id": "e1", "application_id": "app1", "track": "technical", "sort_order": 0,
             "gate": 1, "risk": "high", "status": "validated", "test_type": "retro",
             "start_week": 1, "weeks": 6, "assumption": "Cry-acoustic features carry signal."},
            {"id": "e2", "application_id": "app1", "track": "technical", "sort_order": 1,
             "gate": 3, "risk": "medium", "status": "not-started", "test_type": "breadboard",
             "start_week": 14, "weeks": 6, "assumption": ""},
            {"id": "e3", "application_id": "app1", "track": "commercial", "sort_order": 0,
             "gate": 1, "risk": "high", "status": "running", "test_type": "customer",
             "start_week": 1, "weeks": 5, "assumption": "Neonatologists will act on an alert."},
            {"id": "e4", "application_id": "app1", "track": "commercial", "sort_order": 1,
             "gate": 2, "risk": "high", "status": "not-started", "test_type": "customer",
             "start_week": 8, "weeks": 8, "assumption": ""},
        ],
        "founder_tasks": [
            {"id": "t1", "application_id": "app1", "sort_order": 0, "task": "a",
             "owner": "Priya", "effort": 2, "status": "done"},
            {"id": "t2", "application_id": "app1", "sort_order": 1, "task": "b",
             "owner": "Arjun", "effort": 2, "status": "doing"},
            {"id": "t3", "application_id": "app1", "sort_order": 2, "task": "c",
             "owner": "Meera", "effort": 3, "status": "todo"},
        ],
        "founder_team_members": [
            {"id": "m1", "application_id": "app1", "name": "Priya Ramachandran", "monthly_cost": 180000},
            {"id": "m2", "application_id": "app1", "name": "Arjun Nair", "monthly_cost": 170000},
            {"id": "m3", "application_id": "app1", "name": "Meera Das", "monthly_cost": 120000},
        ],
        "founder_bom_items": [
            {"id": "b1", "application_id": "app1", "qty": 6, "unit_cost": 8500},
            {"id": "b2", "application_id": "app1", "qty": 6, "unit_cost": 12000},
            {"id": "b3", "application_id": "app1", "qty": 4, "unit_cost": 15500},
        ],
        "founder_equipment_items": [
            {"id": "eq1", "application_id": "app1", "cost": 220000},
            {"id": "eq2", "application_id": "app1", "cost": 145000},
        ],
        "founder_procurement_items": [
            {"id": "p1", "application_id": "app1", "qty": 6, "estimate": 8500,
             "quote": 8200, "status": "quoted"},
            {"id": "p2", "application_id": "app1", "qty": 6, "estimate": 12000,
             "quote": 12500, "status": "po"},
        ],
        "founder_review": [{"application_id": "app1", "status": "approved",
                            "approved_by": "Dr. Anitha Krishnan", "approved_on": "14 Jul 2026",
                            "mentor_comment": "..."}],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    body = client.get("/founder/residency").json()

    assert body["app"]["project_name"] == "Neonatal sepsis monitor"
    assert body["app"]["cohort"] == "Cohort 04"
    assert set(body["app"]["team_names"]) == {"Priya Ramachandran", "Arjun Nair", "Meera Das"}
    assert body["app"]["week"] == 3
    assert body["app"]["weeks_total"] == 24
    assert body["app"]["weeks_remaining"] == 21

    # derisking: 1 of 4 experiments validated
    assert body["tiles"]["derisking_pct"] == 25
    assert body["tiles"]["validated"] == 1
    assert body["tiles"]["total_experiments"] == 4
    # tasks: 1 of 3 done
    assert body["tiles"]["tasks_done"] == 1
    assert body["tiles"]["tasks_total"] == 3

    # budget math: monthly_payroll = 180000+170000+120000 = 470000
    # payroll_drawn = 470000 * (3/4.345) = 324,510.9...
    # one_time = bom(6*8500 + 6*12000 + 4*15500) + equip(220000+145000)
    #          = (51000+72000+62000) + 365000 = 185000 + 365000 = 550000
    # total_drawn = min(2500000, 324510.93 + 550000) = 874510.93 -> rounds
    monthly_payroll = 470000
    payroll_drawn = monthly_payroll * (3 / 4.345)
    bom_total = 6 * 8500 + 6 * 12000 + 4 * 15500
    equip_total = 220000 + 145000
    one_time = bom_total + equip_total
    total_drawn = min(2500000, payroll_drawn + one_time)
    assert body["expense"]["monthly_payroll"] == monthly_payroll
    assert body["expense"]["payroll_drawn"] == round(payroll_drawn)
    assert body["expense"]["bom_total"] == bom_total
    assert body["expense"]["equip_total"] == equip_total
    assert body["tiles"]["budget_drawn"] == round(total_drawn)
    assert body["tiles"]["budget_pct"] == round(min(100.0, total_drawn / 2500000 * 100))
    seg = body["expense"]["segments"]
    assert seg["payroll_amount"] == round(payroll_drawn)
    assert seg["capital_amount"] == one_time
    assert abs(seg["payroll_pct"] + seg["capital_pct"] + seg["remaining_pct"] - 100) < 0.01

    # next milestone: CURWEEK=3 -> Gate 1 @ week 8, in 5 weeks
    assert body["tiles"]["next_milestone"] == {"label": "Gate 1 · Discovery", "week": 8, "in_weeks": 5}

    # procurement rollups feed through — proc_committed uses the existing
    # founder_query._COMMITTED set ({quoted, po, received}), so both lines count
    assert body["expense"]["proc_committed"] == 8200 + 12500
    assert body["expense"]["proc_quoted"] == 8200 + 12500
    assert body["expense"]["proc_count"] == 2

    assert body["review_status"] == "approved"

    exp_short = {e["id"]: e for e in body["experiments"]}
    assert exp_short["e1"]["status_label"] == "Validated"
    assert exp_short["e1"]["range_label"] == "Wk 1–6"
    assert exp_short["e2"]["short"] == "Untitled assumption"

    assert len(body["feed"]) == 4


def test_residency_rollup_with_no_experiments_or_tasks(client, monkeypatch, _clear):
    _install(monkeypatch, {
        "tir_applications": [_APP],
        "founder_team_members": [], "founder_bom_items": [], "founder_equipment_items": [],
        "founder_procurement_items": [], "founder_experiments": [], "founder_tasks": [],
        "founder_review": [],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    body = client.get("/founder/residency").json()
    assert body["tiles"]["derisking_pct"] == 0
    assert body["tiles"]["tasks_total"] == 0
    assert body["review_status"] == "draft"
    assert body["expense"]["monthly_payroll"] == 0
    assert body["tiles"]["budget_drawn"] == 0


# ── Procurement sync ─────────────────────────────────────────────────────
def test_procurement_sync_inserts_and_updates(client, monkeypatch, _clear):
    fake = _install(monkeypatch, {
        "tir_applications": [_APP],
        "founder_bom_items": [
            {"id": "b1", "application_id": "app1", "item": "Acoustic sensor module", "qty": 6, "unit_cost": 8500},
            {"id": "b2", "application_id": "app1", "item": "New BOM part", "qty": 2, "unit_cost": 5000},
        ],
        "founder_equipment_items": [
            {"id": "eq1", "application_id": "app1", "item": "Bench oscilloscope", "cost": 145000},
        ],
        "founder_procurement_items": [
            # existing row matches b1 by item+category (case-insensitive) -> updated, not duplicated
            {"id": "p1", "application_id": "app1", "item": "acoustic sensor module", "category": "BOM",
             "qty": 1, "estimate": 1, "vendor": "Knowles India", "quote": 8200, "lead_weeks": 4,
             "status": "quoted"},
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")

    r = client.post("/founder/procurement/sync")
    assert r.status_code == 200, r.text
    rows = r.json()
    assert len(rows) == 3  # p1 updated in place + 2 new inserts (New BOM part, Bench oscilloscope)

    p1 = next(p for p in rows if p["id"] == "p1")
    assert p1["qty"] == 6
    assert p1["estimate"] == 8500
    assert p1["vendor"] == "Knowles India"  # untouched — sync only sets qty/estimate

    new_bom = next(p for p in rows if p["item"] == "New BOM part")
    assert new_bom["category"] == "BOM"
    assert new_bom["qty"] == 2
    assert new_bom["estimate"] == 5000
    assert new_bom["status"] == "estimate"

    new_equip = next(p for p in rows if p["item"] == "Bench oscilloscope")
    assert new_equip["category"] == "Equipment"
    assert new_equip["qty"] == 1
    assert new_equip["estimate"] == 145000

    assert len(fake.tables["founder_procurement_items"]) == 3


def test_procurement_sync_skips_blank_items(client, monkeypatch, _clear):
    _install(monkeypatch, {
        "tir_applications": [_APP],
        "founder_bom_items": [{"id": "b1", "application_id": "app1", "item": "  ", "qty": 1, "unit_cost": 100}],
        "founder_equipment_items": [],
        "founder_procurement_items": [],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    r = client.post("/founder/procurement/sync")
    assert r.status_code == 200, r.text
    assert r.json() == []


# ── Expense bundle procurement counts (extended for the Expense tab) ─────
def test_expense_bundle_includes_open_and_committed_counts(client, monkeypatch, _clear):
    _install(monkeypatch, {
        "tir_applications": [_APP],
        "founder_bom_items": [], "founder_equipment_items": [],
        "founder_procurement_items": [
            {"id": "p1", "application_id": "app1", "estimate": 8500, "quote": 8200, "status": "quoted"},
            {"id": "p2", "application_id": "app1", "estimate": 15500, "quote": 0, "status": "estimate"},
            {"id": "p3", "application_id": "app1", "estimate": 12000, "quote": 12500, "status": "po"},
        ],
    })
    app.dependency_overrides[get_current_user] = _override_user("u1")
    body = client.get("/founder/expense").json()
    # open/committed follow the existing _COMMITTED set ({quoted, po, received}),
    # matching the dollar figure `proc_committed` already returned alongside it.
    assert body["totals"]["proc_open_count"] == 1        # only "estimate"
    assert body["totals"]["proc_committed_count"] == 2   # quoted + po
    assert body["totals"]["proc_variance"] == (8200 + 0 + 12500) - (8500 + 15500 + 12000)
