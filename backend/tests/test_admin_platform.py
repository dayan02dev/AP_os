"""Tests for the admin-platform pipeline-list + detail endpoints (Task 6).

Self-contained fake-Supabase scaffolding (copied from test_reviewer /
test_leadership_writes so this file reads without cross-module references).
The fake's `.eq()/.in_()` are no-ops on the query builder for SELECTs by
default — production code filters in Python after fetch (mirrors
applications_query/fetch_queue). We DO apply eq filters in the fake's
execute() for the cases the detail path relies on (find_application_with_track
selects `*` then takes rows[0]), matching test_reviewer's behaviour.

Coverage:
  * pipeline list joins decision / admin-meta / batch and resolves industry
  * hidden apps excluded by default, surfaced with include_hidden=true
  * detail bundles decision + reviews + ai_screening
  * detail 404 on unknown id
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from app.deps import get_current_user
from app.main import app


# ─── Fake Supabase admin client ────────────────────────────────────────


class _FakeQuery:
    def __init__(self, parent, name: str):
        self._parent = parent
        self._name = name
        self._mode = "select"
        self._payload: Any = None
        self._eqs: list[tuple[str, Any]] = []

    def select(self, *_a, **_k):  return self
    def order(self, *_a, **_k):   return self
    def limit(self, *_a, **_k):   return self
    def in_(self, *_a, **_k):     return self
    def or_(self, *_a, **_k):     return self
    def range(self, *_a, **_k):   return self
    def neq(self, *_a, **_k):     return self

    def eq(self, col, val):
        self._eqs.append((col, val))
        return self

    def insert(self, payload):
        self._mode = "insert"
        self._payload = payload
        if isinstance(payload, list):
            for row in payload:
                self._parent.inserts.append((self._name, row))
        else:
            self._parent.inserts.append((self._name, payload))
        return self

    def upsert(self, payload, on_conflict=None):
        self._mode = "insert"
        self._payload = payload
        if isinstance(payload, list):
            for row in payload:
                self._parent.inserts.append((self._name, row))
        else:
            self._parent.inserts.append((self._name, payload))
        return self

    def update(self, payload):
        self._mode = "update"
        self._payload = payload
        self._parent.updates.append((self._name, payload, list(self._eqs)))
        return self

    def execute(self):
        if self._mode in ("insert", "update"):
            data = self._payload if isinstance(self._payload, list) else (
                [self._payload] if self._payload else [{"ok": True}]
            )
            return SimpleNamespace(data=data, count=len(data))
        rows = self._parent.tables.get(self._name, [])
        # Apply eq filters so single-row lookups (find_application_with_track,
        # detail sub-fetches) resolve the right row. `.in_()` stays a no-op —
        # bulk callers post-filter in Python, matching production.
        for col, val in self._eqs:
            rows = [r for r in rows if r.get(col) == val]
        return SimpleNamespace(data=rows, count=len(rows))


class _FakeAdminClient:
    def __init__(self, tables: dict[str, list[dict]] | None = None):
        self.tables = tables or {}
        self.inserts: list[tuple[str, Any]] = []
        self.updates: list[tuple[str, Any, list]] = []

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(self, name)


def _override_user(user_id: str, roles: list[str] | None = None):
    def _f():
        return {
            "user_id": user_id,
            "email": f"{user_id}@x.com",
            "roles": roles or ["leadership"],
        }
    return _f


@pytest.fixture
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


def _install_db(monkeypatch, tables):
    from app.routers import admin_platform as ap
    from app.services import admin_query, applications_query, decisions, state_machine
    fake = _FakeAdminClient(tables=tables)
    monkeypatch.setattr(admin_query, "get_admin_client", lambda: fake)
    monkeypatch.setattr(applications_query, "get_admin_client", lambda: fake)
    # Decision endpoint (Task 7) drives the state machine + admin_decisions
    # writes through their own module-level client handles.
    monkeypatch.setattr(decisions, "get_admin_client", lambda: fake)
    monkeypatch.setattr(state_machine, "get_admin_client", lambda: fake)
    # The detail path may reach into the leadership router's client for the
    # industry-label lookup; patch there too if present.
    monkeypatch.setattr(ap, "get_admin_client", lambda: fake, raising=False)
    return fake


def _empty_admin_tables() -> dict[str, list[dict]]:
    return {
        "tir_applications": [],
        "sip_applications": [],
        "ai_screening": [],
        "admin_decisions": [],
        "application_admin_meta": [],
        "application_batches": [],
        "batches": [],
        "industry_categories": [],
        "reviews": [],
        "reviewer_assignments": [],
        "application_status_log": [],
    }


# ─── Router registration smoke ─────────────────────────────────────────


def test_admin_platform_router_registered(client):
    r = client.get("/admin/platform/applications")
    assert r.status_code in (401, 403), f"got {r.status_code}; route may not be registered"


# ─── GET /admin/platform/applications ──────────────────────────────────


def test_pipeline_list_joins_decision_meta_batch(client, monkeypatch, _clear_overrides):
    app_id = "11111111-1111-1111-1111-111111111111"
    tables = _empty_admin_tables()
    tables["tir_applications"] = [
        {"id": app_id, "status": "evaluated", "display_seq": 26013,
         "basic_full_name": "Asha R", "basic_email": "asha@x.com",
         "basic_org": "Karkhana Labs", "solution_stage": "Prototype built",
         "submitted_at": "2026-06-01T00:00:00Z", "created_at": "2026-05-20T00:00:00Z"},
    ]
    tables["ai_screening"] = [
        {"application_id": app_id, "application_track": "tir",
         "score_overall": 8.4, "project_name": "Karkhana Robotics",
         "industry_category_id": "robotics"},
    ]
    tables["admin_decisions"] = [
        {"application_id": app_id, "application_track": "tir",
         "gate_stage": "gate1", "decision": "shortlisted",
         "rationale": "strong team", "decided_at": "2026-06-05T00:00:00Z"},
    ]
    tables["application_admin_meta"] = [
        {"application_id": app_id, "application_track": "tir",
         "is_hidden": False, "is_archived": False},
    ]
    tables["industry_categories"] = [
        {"id": "robotics", "label": "Robotics & Automation"},
    ]
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("lead-1", roles=["leadership"])

    r = client.get("/admin/platform/applications")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 1
    item = body["applications"][0]
    assert item["id"] == app_id
    assert item["track"] == "tir"
    assert item["decision"] == "shortlisted"
    assert item["isHidden"] is False
    assert item["isArchived"] is False
    assert item["name"] == "Karkhana Robotics"  # project_name wins
    assert item["industry"] == "Robotics & Automation"
    assert item["status"] == "evaluated"
    assert item["ai_score_overall"] == 8.4


def test_pipeline_excludes_hidden_by_default(client, monkeypatch, _clear_overrides):
    app_id = "22222222-2222-2222-2222-222222222222"
    tables = _empty_admin_tables()
    tables["tir_applications"] = [
        {"id": app_id, "status": "evaluated", "display_seq": 26014,
         "basic_full_name": "B", "basic_email": "b@x.com", "basic_org": "Org B",
         "submitted_at": "2026-06-01T00:00:00Z"},
    ]
    tables["application_admin_meta"] = [
        {"application_id": app_id, "application_track": "tir",
         "is_hidden": True, "is_archived": False},
    ]
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("lead-1", roles=["leadership"])

    # Default: hidden excluded.
    r = client.get("/admin/platform/applications")
    assert r.status_code == 200, r.text
    assert r.json()["total"] == 0

    # include_hidden=true → present.
    r = client.get("/admin/platform/applications?include_hidden=true")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 1
    assert body["applications"][0]["isHidden"] is True


# ─── GET /admin/platform/applications/{track}/{id} ─────────────────────


def test_detail_includes_decision_and_consensus(client, monkeypatch, _clear_overrides):
    app_id = "app-1"
    tables = _empty_admin_tables()
    tables["tir_applications"] = [
        {"id": app_id, "status": "evaluated", "display_seq": 26020,
         "basic_full_name": "C", "basic_org": "Org C",
         "submitted_at": "2026-06-01T00:00:00Z"},
    ]
    tables["ai_screening"] = [
        {"application_id": app_id, "application_track": "tir",
         "score_overall": 7.2, "project_name": "Proj C",
         "summary": "decent"},
    ]
    tables["reviews"] = [
        {"id": "rev-1", "application_id": app_id, "application_track": "tir",
         "reviewer_user_id": "rev-a", "status": "submitted",
         "submitted_at": "2026-06-02T00:00:00Z", "score_problem": 7},
    ]
    tables["admin_decisions"] = [
        {"application_id": app_id, "application_track": "tir",
         "gate_stage": "gate1", "decision": "shortlisted",
         "rationale": "x", "decided_at": "2026-06-05T00:00:00Z"},
    ]
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("lead-1", roles=["leadership"])

    r = client.get(f"/admin/platform/applications/tir/{app_id}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["decision"]["decision"] == "shortlisted"
    assert "reviews" in body
    assert body["ai_screening"] is not None
    assert len(body["reviews"]) == 1


def test_detail_404_when_missing(client, monkeypatch, _clear_overrides):
    _install_db(monkeypatch, _empty_admin_tables())
    app.dependency_overrides[get_current_user] = _override_user("lead-1", roles=["leadership"])
    r = client.get("/admin/platform/applications/tir/does-not-exist")
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "application_not_found"


def test_pipeline_search_matches_display_seq(client, monkeypatch, _clear_overrides):
    """Python re-filter must include display_seq so a numeric search like '26013'
    (or composed 'TIR-26013') is not dropped after PostgREST returns the row."""
    app_id = "33333333-3333-3333-3333-333333333333"
    tables = _empty_admin_tables()
    tables["tir_applications"] = [
        {"id": app_id, "status": "submitted", "display_seq": 26013,
         "basic_full_name": "Test Founder", "basic_email": "test@x.com",
         "basic_org": "Test Org", "submitted_at": "2026-06-10T00:00:00Z"},
    ]
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("lead-1", roles=["leadership"])

    # Search by raw numeric display_seq.
    r = client.get("/admin/platform/applications?search=26013")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 1, (
        "display_seq '26013' should match via Python re-filter but got 0 results"
    )
    assert body["applications"][0]["id"] == app_id


# ─── POST /admin/platform/applications/{track}/{id}/decision (Task 7) ───


def test_decision_shortlist_writes_status_decision_audit(client, monkeypatch, _clear_overrides):
    fake = _install_db(monkeypatch, {"tir_applications":[{"id":"app-1","status":"evaluated"}],
        "sip_applications":[], "admin_decisions":[], "application_status_log":[]})
    monkeypatch.setattr("app.services.decisions.write_audit", lambda **k: None)
    app.dependency_overrides[get_current_user] = _override_user("lead-1", roles=["leadership"])
    r = client.post("/admin/platform/applications/tir/app-1/decision",
                    json={"decision":"shortlisted","rationale":"strong team"})
    assert r.status_code == 200, r.text
    assert any(t=="admin_decisions" for t,_ in fake.inserts)
    upd = [u for n,u,_ in fake.updates if n=="tir_applications"]
    assert any(u.get("status")=="shortlisted" for u in upd)


def test_decision_illegal_transition_422(client, monkeypatch, _clear_overrides):
    _install_db(monkeypatch, {"tir_applications":[{"id":"app-1","status":"draft"}],"sip_applications":[],"admin_decisions":[],"application_status_log":[]})
    app.dependency_overrides[get_current_user] = _override_user("lead-1", roles=["leadership"])
    r = client.post("/admin/platform/applications/tir/app-1/decision", json={"decision":"shortlisted"})
    assert r.status_code == 422 and r.json()["detail"]["code"]=="illegal_transition"


def test_decision_requires_rationale_for_reject(client, monkeypatch, _clear_overrides):
    _install_db(monkeypatch, {"tir_applications":[{"id":"app-1","status":"evaluated"}],"sip_applications":[],"admin_decisions":[],"application_status_log":[]})
    app.dependency_overrides[get_current_user] = _override_user("lead-1", roles=["leadership"])
    r = client.post("/admin/platform/applications/tir/app-1/decision", json={"decision":"rejected"})
    assert r.status_code == 422 and r.json()["detail"]["code"]=="rationale_required"


def test_decision_shortlist_no_rationale_ok(client, monkeypatch, _clear_overrides):
    _install_db(monkeypatch, {"tir_applications":[{"id":"app-1","status":"evaluated"}],"sip_applications":[],"admin_decisions":[],"application_status_log":[]})
    monkeypatch.setattr("app.services.decisions.write_audit", lambda **k: None)
    app.dependency_overrides[get_current_user] = _override_user("lead-1", roles=["leadership"])
    r = client.post("/admin/platform/applications/tir/app-1/decision", json={"decision":"shortlisted"})
    assert r.status_code == 200


def test_decision_illegal_writes_no_decision_row(client, monkeypatch, _clear_overrides):
    """An illegal transition must 422 with ZERO writes — in particular, no
    admin_decisions row may be inserted before the legality gate."""
    fake = _install_db(monkeypatch, {"tir_applications":[{"id":"app-1","status":"draft"}],"sip_applications":[],"admin_decisions":[],"application_status_log":[]})
    app.dependency_overrides[get_current_user] = _override_user("lead-1", roles=["leadership"])
    r = client.post("/admin/platform/applications/tir/app-1/decision", json={"decision":"shortlisted"})
    assert r.status_code == 422 and r.json()["detail"]["code"]=="illegal_transition"
    assert not any(t=="admin_decisions" for t,_ in fake.inserts)


# ─── POST /admin/platform/decisions/bulk (Task 8) ──────────────────────


def test_bulk_decision_per_id_results(client, monkeypatch, _clear_overrides):
    _install_db(monkeypatch, {
        "tir_applications":[{"id":"app-1","status":"evaluated"},{"id":"app-2","status":"draft"}],
        "sip_applications":[], "admin_decisions":[], "application_status_log":[]})
    monkeypatch.setattr("app.services.decisions.write_audit", lambda **k: None)
    app.dependency_overrides[get_current_user] = _override_user("lead-1", roles=["leadership"])
    r = client.post("/admin/platform/decisions/bulk", json={"items":[
        {"track":"tir","application_id":"app-1","decision":"shortlisted"},
        {"track":"tir","application_id":"app-2","decision":"shortlisted"},
        {"track":"tir","application_id":"app-3","decision":"rejected"},  # missing rationale
        {"track":"tir","application_id":"app-99","decision":"shortlisted"},  # non-existent
    ]})
    assert r.status_code == 200, r.text
    res = {x["application_id"]: x["status"] for x in r.json()["results"]}
    assert res["app-1"] == "decided"
    assert res["app-2"] == "illegal_transition"      # draft can't shortlist
    assert res["app-3"] == "rationale_required"      # reject w/o rationale
    assert res["app-99"] == "not_found"              # non-existent application id


# ─── PATCH /admin/platform/applications/{track}/{id}/meta (Task 9) ──────


def test_meta_hide_then_restore(client, monkeypatch, _clear_overrides):
    fake = _install_db(monkeypatch, {"tir_applications":[{"id":"app-1","status":"evaluated"}],
        "sip_applications":[], "application_admin_meta":[]})
    monkeypatch.setattr("app.routers.admin_platform.write_audit", lambda **k: None)
    app.dependency_overrides[get_current_user] = _override_user("lead-1", roles=["leadership"])
    r = client.patch("/admin/platform/applications/tir/app-1/meta", json={"is_hidden": True, "hidden_reason":"dupe"})
    assert r.status_code == 200, r.text
    # the upserted meta row carries is_hidden True + updated_by
    rows = [p for (t,p) in fake.inserts if t=="application_admin_meta"] + [u for (n,u,_) in fake.updates if n=="application_admin_meta"]
    assert any(p.get("is_hidden") is True for p in rows)
    r2 = client.patch("/admin/platform/applications/tir/app-1/meta", json={"is_hidden": False})
    assert r2.status_code == 200


def test_meta_rejects_unknown_field(client, monkeypatch, _clear_overrides):
    _install_db(monkeypatch, {"tir_applications":[{"id":"app-1"}],"sip_applications":[],"application_admin_meta":[]})
    app.dependency_overrides[get_current_user] = _override_user("lead-1", roles=["leadership"])
    r = client.patch("/admin/platform/applications/tir/app-1/meta", json={"bogus": 1})
    assert r.status_code == 422


def test_meta_empty_body_422(client, monkeypatch, _clear_overrides):
    """PATCH meta with an empty body {} must 422 with code 'no_fields'."""
    _install_db(monkeypatch, {"tir_applications":[{"id":"app-1"}],"sip_applications":[],"application_admin_meta":[]})
    app.dependency_overrides[get_current_user] = _override_user("lead-1", roles=["leadership"])
    r = client.patch("/admin/platform/applications/tir/app-1/meta", json={})
    assert r.status_code == 422, r.text
    assert r.json()["detail"]["code"] == "no_fields"


def test_meta_sets_updated_by(client, monkeypatch, _clear_overrides):
    """PATCH meta is_hidden true → upserted row's updated_by matches caller's user_id."""
    fake = _install_db(monkeypatch, {"tir_applications":[{"id":"app-1","status":"evaluated"}],
        "sip_applications":[], "application_admin_meta":[]})
    monkeypatch.setattr("app.routers.admin_platform.write_audit", lambda **k: None)
    app.dependency_overrides[get_current_user] = _override_user("lead-1", roles=["leadership"])
    r = client.patch("/admin/platform/applications/tir/app-1/meta", json={"is_hidden": True})
    assert r.status_code == 200, r.text
    upserted = [p for (t, p) in fake.inserts if t == "application_admin_meta"]
    assert upserted, "expected at least one upsert into application_admin_meta"
    assert upserted[-1].get("updated_by") == "lead-1"


# ─── Task 10: Batches CRUD + bulk assign ──────────────────────────────────


def test_batches_list_create_rename(client, monkeypatch, _clear_overrides):
    fake = _install_db(monkeypatch, {"batches":[{"id":"b1","name":"Batch A","phase":"phase1"}]})
    monkeypatch.setattr("app.routers.admin_platform.write_audit", lambda **k: None)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    assert client.get("/admin/platform/batches").status_code == 200
    r = client.post("/admin/platform/batches", json={"name":"Batch B","phase":"phase1"})
    assert r.status_code == 200 and any(t=="batches" for t,_ in fake.inserts)
    r2 = client.patch("/admin/platform/batches/b1", json={"name":"Batch A renamed"})
    assert r2.status_code == 200 and any(n=="batches" for n,_,_ in fake.updates)


def test_batch_assign_applications(client, monkeypatch, _clear_overrides):
    fake = _install_db(monkeypatch, {"batches":[{"id":"b1","name":"Batch A"}], "application_batches":[]})
    monkeypatch.setattr("app.routers.admin_platform.write_audit", lambda **k: None)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.post("/admin/platform/batches/b1/applications", json={"items":[
        {"track":"tir","application_id":"app-1"},{"track":"sip","application_id":"app-2"}]})
    assert r.status_code == 200
    inserted = [p for (t, p) in fake.inserts if t == "application_batches"]
    assert len(inserted) == 2 and all(p.get("batch_id") == "b1" for p in inserted)


def test_batches_requires_capability(client, monkeypatch, _clear_overrides):
    _install_db(monkeypatch, {"batches":[]})
    app.dependency_overrides[get_current_user] = _override_user("rev-1", roles=["reviewer"])
    assert client.post("/admin/platform/batches", json={"name":"X"}).status_code == 403


def test_batch_assign_unknown_batch_404(client, monkeypatch, _clear_overrides):
    """POST /batches/bad-id/applications with no batches seeded → 404 batch_not_found."""
    _install_db(monkeypatch, {"batches": [], "application_batches": []})
    monkeypatch.setattr("app.routers.admin_platform.write_audit", lambda **k: None)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.post("/admin/platform/batches/bad-id/applications",
                    json={"items": [{"track": "tir", "application_id": "app-1"}]})
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "batch_not_found"


# ─── Task 11: Reviewer roster (metrics + profile patch + rebalance) ────────


def test_roster_metrics(client, monkeypatch, _clear_overrides):
    _install_db(monkeypatch, {
        "user_roles":[{"user_id":"rev-1","role":"reviewer"}],
        "profiles":[{"id":"rev-1","email":"r1@x.in","full_name":"Rev One"}],
        "reviewer_profiles":[{"reviewer_user_id":"rev-1","expertise_domains":["Robotics"],"weight":2.0}],
        "reviewer_assignments":[
            {"id":"a1","reviewer_user_id":"rev-1","application_id":"app-1","application_track":"tir","declined_at":None,"reassigned_to":None,"completed_at":"2026-06-03T00:00:00+00:00","assigned_at":"2026-06-01T00:00:00+00:00"},
            {"id":"a2","reviewer_user_id":"rev-1","application_id":"app-2","application_track":"tir","declined_at":None,"reassigned_to":None,"completed_at":None,"assigned_at":"2026-06-01T00:00:00+00:00"}],
        "reviews":[{"id":"rv1","reviewer_user_id":"rev-1","application_id":"app-1","application_track":"tir","score_problem":8,"score_solution":8,"score_tech":8,"score_founders":8,"score_commitment":8,"submitted_at":"2026-06-03T00:00:00+00:00"}],
        "ai_screening":[{"application_id":"app-1","application_track":"tir","score_overall":8.5}],
    })
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.get("/admin/platform/reviewers")
    assert r.status_code == 200, r.text
    row = {x["user_id"]: x for x in r.json()["reviewers"]}["rev-1"]
    assert row["name"] == "Rev One"
    assert row["weight"] == 2.0
    assert row["domains"] == ["Robotics"]
    assert row["assigned"] == 2 and row["completed"] == 1
    assert row["progress"] == "1 / 2"
    assert row["consistency"] == 0.95    # |8.0 - 8.5| / 10 = 0.05 → 1 - 0.05 = 0.95


def test_roster_patch_profile(client, monkeypatch, _clear_overrides):
    fake = _install_db(monkeypatch, {"reviewer_profiles":[]})
    monkeypatch.setattr("app.routers.admin_platform.write_audit", lambda **k: None)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.patch("/admin/platform/reviewers/rev-1", json={"weight":3.0,"domains":["AI","Robotics"]})
    assert r.status_code == 200
    rows = [p for (t,p) in fake.inserts if t=="reviewer_profiles"] + [u for (n,u,_) in fake.updates if n=="reviewer_profiles"]
    assert any(p.get("weight")==3.0 for p in rows)


def test_roster_rebalance(client, monkeypatch, _clear_overrides):
    fake = _install_db(monkeypatch, {
        "user_roles":[{"user_id":"rev-1","role":"reviewer"},{"user_id":"rev-2","role":"reviewer"}],
        "tir_applications":[{"id":f"app-{i}","status":"under_review"} for i in range(4)],
        "sip_applications":[], "reviewer_assignments":[], "profiles":[]})
    monkeypatch.setattr("app.routers.admin_platform.write_audit", lambda **k: None)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.post("/admin/platform/reviewers/rebalance", json={})
    assert r.status_code == 200
    created = [p for (t,p) in fake.inserts if t=="reviewer_assignments"]
    assert len(created) == 4    # 4 unassigned apps distributed across 2 reviewers
