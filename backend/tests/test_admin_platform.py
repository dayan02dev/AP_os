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

    def upsert(self, payload, on_conflict=None, ignore_duplicates=False, **_k):
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

    def delete(self):
        self._mode = "delete"
        self._parent.deletes.append((self._name, list(self._eqs)))
        return self

    def execute(self):
        if self._mode == "delete":
            # Actually remove matching rows from the in-memory table so the
            # endpoint's `removed` count reflects real deletions, and echo the
            # deleted rows back (mimics PostgREST returning='representation').
            table = self._parent.tables.setdefault(self._name, [])
            removed = [r for r in table if all(r.get(c) == v for c, v in self._eqs)]
            kept = [r for r in table if r not in removed]
            self._parent.tables[self._name] = kept
            return SimpleNamespace(data=removed, count=len(removed))
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
        self.deletes: list[tuple[str, list]] = []

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
    from app.services import admin_query, applications_query, decisions, state_machine, stats
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
    # Stats service uses its own client handle (called by admin stats endpoint).
    monkeypatch.setattr(stats, "get_admin_client", lambda: fake)
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
    # stage must be a plain string (the label), never the {raw,label} dict —
    # a dict child crashes the pipeline table with React error #31.
    assert item["stage"] == "Prototype"  # derive_stage_label maps the raw value
    assert isinstance(item["stage"], str)


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


def test_reviewer_applications_is_admin_only(client, _clear_overrides):
    """GET /reviewers/{id}/applications needs manage_reviewers_roster (admin only).
    A reviewer cannot list another reviewer's apps; leadership (no roster cap) is
    also refused — access stays scoped to the assigned admin user."""
    app.dependency_overrides[get_current_user] = _override_user("rev-1", roles=["reviewer"])
    assert client.get("/admin/platform/reviewers/rev-2/applications").status_code == 403
    app.dependency_overrides[get_current_user] = _override_user("lead-1", roles=["leadership"])
    assert client.get("/admin/platform/reviewers/rev-2/applications").status_code == 403


def test_batch_assign_unknown_batch_404(client, monkeypatch, _clear_overrides):
    """POST /batches/bad-id/applications with no batches seeded → 404 batch_not_found."""
    _install_db(monkeypatch, {"batches": [], "application_batches": []})
    monkeypatch.setattr("app.routers.admin_platform.write_audit", lambda **k: None)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.post("/admin/platform/batches/bad-id/applications",
                    json={"items": [{"track": "tir", "application_id": "app-1"}]})
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "batch_not_found"


def test_batch_unassign_removes_link_and_reviewer_assignments(client, monkeypatch, _clear_overrides):
    """POST /batches/unassign deletes the app's application_batches row AND
    every reviewer_assignments row for that app (all reviewers), so the app
    disappears from every reviewer's queue/roster consistently."""
    fake = _install_db(monkeypatch, {
        "application_batches": [
            {"application_id": "app-1", "application_track": "tir", "batch_id": "b1"},
            {"application_id": "app-2", "application_track": "sip", "batch_id": "b1"},
        ],
        "reviewer_assignments": [
            {"application_id": "app-1", "application_track": "tir",
             "reviewer_user_id": "rev-1", "declined_at": None, "reassigned_to": None},
            {"application_id": "app-1", "application_track": "tir",
             "reviewer_user_id": "rev-2", "declined_at": None, "reassigned_to": None},
        ],
    })
    monkeypatch.setattr("app.routers.admin_platform.write_audit", lambda **k: None)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])

    r = client.post("/admin/platform/batches/unassign",
                    json={"items": [{"track": "tir", "application_id": "app-1"}]})
    assert r.status_code == 200
    body = r.json()
    assert body["removed"] == 1
    assert body["assignments_removed"] == 2
    # app-1 link gone, app-2 link kept
    links = fake.tables["application_batches"]
    assert not any(l["application_id"] == "app-1" for l in links)
    assert any(l["application_id"] == "app-2" for l in links)
    # reviewer assignments for app-1 gone for BOTH reviewers
    assert len(fake.tables["reviewer_assignments"]) == 0


def test_batch_unassign_is_idempotent(client, monkeypatch, _clear_overrides):
    """Unassigning an app that is not in any batch removes 0 rows (no error)."""
    _install_db(monkeypatch, {"application_batches": []})
    monkeypatch.setattr("app.routers.admin_platform.write_audit", lambda **k: None)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.post("/admin/platform/batches/unassign",
                    json={"items": [{"track": "tir", "application_id": "ghost"}]})
    assert r.status_code == 200
    assert r.json()["removed"] == 0


def test_batch_unassign_requires_capability(client, monkeypatch, _clear_overrides):
    """A reviewer (no manage_batches) is refused."""
    _install_db(monkeypatch, {"application_batches": []})
    app.dependency_overrides[get_current_user] = _override_user("rev-1", roles=["reviewer"])
    r = client.post("/admin/platform/batches/unassign",
                    json={"items": [{"track": "tir", "application_id": "app-1"}]})
    assert r.status_code == 403


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


# ─── Task 12: Audit-log read endpoint + CSV ──────────────────────────────


def test_audit_log_merges_sources(client, monkeypatch, _clear_overrides):
    _install_db(monkeypatch, {
        "audit_log_v2":[{"id":1,"actor_user_id":"u1","actor_role":"admin","action_type":"gate1_decision","target_table":"tir_applications","target_id":"app-1","after":{"decision":"shortlisted"},"created_at":"2026-06-10T10:00:00+00:00"}],
        "application_status_log":[{"id":"s1","application_id":"app-1","application_track":"tir","from_status":"evaluated","to_status":"shortlisted","changed_by":"u1","reason":"ok","changed_at":"2026-06-10T09:00:00+00:00"}],
    })
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.get("/admin/platform/audit-log")
    assert r.status_code == 200, r.text
    rows = r.json()["entries"]
    assert len(rows) == 2
    # newest first: the audit_log_v2 (10:00) before status_log (09:00)
    assert rows[0]["action"] == "gate1_decision"
    assert all({"ts","actor","action","target"} <= set(e.keys()) for e in rows)


def test_audit_log_csv(client, monkeypatch, _clear_overrides):
    _install_db(monkeypatch, {"audit_log_v2":[{"id":1,"actor_user_id":"u1","actor_role":"admin","action_type":"x","created_at":"2026-06-10T10:00:00+00:00"}],"application_status_log":[]})
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.get("/admin/platform/audit-log?format=csv")
    assert r.status_code == 200
    assert "text/csv" in r.headers["content-type"]
    assert "ts,actor,action,target" in r.text.splitlines()[0]


def test_audit_log_filters_by_action(client, monkeypatch, _clear_overrides):
    _install_db(monkeypatch, {"audit_log_v2":[
        {"id":1,"action_type":"gate1_decision","actor_user_id":"u1","created_at":"2026-06-10T10:00:00+00:00"},
        {"id":2,"action_type":"admin_meta_update","actor_user_id":"u1","created_at":"2026-06-10T11:00:00+00:00"}],
        "application_status_log":[]})
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.get("/admin/platform/audit-log?action=gate1_decision")
    assert r.status_code == 200
    rows = r.json()["entries"]
    assert len(rows) == 1 and rows[0]["action"]=="gate1_decision"


def test_audit_log_filters_by_date(client, monkeypatch, _clear_overrides):
    """?from=YYYY-MM-DD binds via the Query alias and filters ts >= value.
    ?to=YYYY-MM-DD filters ts <= value.  Proves the trailing-underscore alias fix."""
    _install_db(monkeypatch, {
        "audit_log_v2": [
            {"id": 1, "action_type": "gate1_decision", "actor_user_id": "u1",
             "created_at": "2026-06-09T08:00:00+00:00"},
            {"id": 2, "action_type": "admin_meta_update", "actor_user_id": "u1",
             "created_at": "2026-06-11T12:00:00+00:00"},
        ],
        "application_status_log": [],
    })
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])

    # ?from=2026-06-10 → only the 2026-06-11 row survives
    r = client.get("/admin/platform/audit-log?from=2026-06-10")
    assert r.status_code == 200, r.text
    rows = r.json()["entries"]
    assert len(rows) == 1, f"expected 1 row with from filter, got {len(rows)}"
    assert rows[0]["ts"].startswith("2026-06-11")

    # ?to=2026-06-10 → only the 2026-06-09 row survives
    r2 = client.get("/admin/platform/audit-log?to=2026-06-10")
    assert r2.status_code == 200, r2.text
    rows2 = r2.json()["entries"]
    assert len(rows2) == 1, f"expected 1 row with to filter, got {len(rows2)}"
    assert rows2[0]["ts"].startswith("2026-06-09")


# ─── Task 13: Reviewer-calibration analytics + admin dashboard stats ────────


def test_reviewer_calibration(client, monkeypatch, _clear_overrides):
    _install_db(monkeypatch, {
        "user_roles":[{"user_id":"rev-1","role":"reviewer"}],
        "profiles":[{"id":"rev-1","email":"r1@x.in","full_name":"Rev One"}],
        "reviewer_profiles":[],
        "reviews":[
            {"reviewer_user_id":"rev-1","application_id":"app-1","application_track":"tir","score_problem":8,"score_solution":8,"score_tech":8,"score_founders":8,"score_commitment":8,"submitted_at":"2026-06-03T00:00:00+00:00"},
            {"reviewer_user_id":"rev-1","application_id":"app-2","application_track":"tir","score_problem":6,"score_solution":6,"score_tech":6,"score_founders":6,"score_commitment":6,"submitted_at":"2026-06-04T00:00:00+00:00"}],
        "ai_screening":[
            {"application_id":"app-1","application_track":"tir","score_overall":8.5},
            {"application_id":"app-2","application_track":"tir","score_overall":7.0}],
        "reviewer_assignments":[],
    })
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.get("/admin/platform/analytics/reviewer-calibration")
    assert r.status_code == 200, r.text
    row = {x["user_id"]: x for x in r.json()["reviewers"]}["rev-1"]
    assert row["n_reviews"] == 2
    assert row["avg_score"] == 7.0          # mean(8.0, 6.0)
    assert row["avg_variance_vs_ai"] == 0.75   # mean(|8.0-8.5|, |6.0-7.0|) = mean(0.5,1.0)


# ─── Batch → reviewer assignment (POST/DELETE) + roster batches ───────────


def test_batch_reviewers_assign_creates_n_by_m(client, monkeypatch, _clear_overrides):
    """N apps in a batch × M reviewers → N*M reviewer_assignments, all pending."""
    fake = _install_db(monkeypatch, {
        "batches": [{"id": "b1", "name": "Batch A"}],
        "application_batches": [
            {"application_id": "app-1", "application_track": "tir", "batch_id": "b1"},
            {"application_id": "app-2", "application_track": "sip", "batch_id": "b1"},
        ],
        "reviewer_assignments": [],
    })
    monkeypatch.setattr("app.routers.admin_platform.write_audit", lambda **k: None)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.post("/admin/platform/batches/b1/reviewers",
                    json={"reviewer_user_ids": ["rev-1", "rev-2"]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body == {"created": 4, "reviewers": 2, "applications": 2}
    inserted = [p for (t, p) in fake.inserts if t == "reviewer_assignments"]
    assert len(inserted) == 4
    assert all(p.get("state") == "pending" for p in inserted)
    assert all(p.get("assigned_by") == "admin-1" for p in inserted)


def test_batch_reviewers_assign_dedupes_existing(client, monkeypatch, _clear_overrides):
    """An existing (app, track, reviewer) triple is skipped, not re-inserted."""
    fake = _install_db(monkeypatch, {
        "batches": [{"id": "b1", "name": "Batch A"}],
        "application_batches": [
            {"application_id": "app-1", "application_track": "tir", "batch_id": "b1"},
            {"application_id": "app-2", "application_track": "tir", "batch_id": "b1"},
        ],
        "reviewer_assignments": [
            {"application_id": "app-1", "application_track": "tir",
             "reviewer_user_id": "rev-1", "declined_at": None, "reassigned_to": None},
        ],
    })
    monkeypatch.setattr("app.routers.admin_platform.write_audit", lambda **k: None)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.post("/admin/platform/batches/b1/reviewers",
                    json={"reviewer_user_ids": ["rev-1"]})
    assert r.status_code == 200, r.text
    # 2 apps × 1 reviewer = 2 pairs, but (app-1, tir, rev-1) already exists → 1 created.
    assert r.json() == {"created": 1, "reviewers": 1, "applications": 2}
    inserted = [p for (t, p) in fake.inserts if t == "reviewer_assignments"]
    assert len(inserted) == 1
    assert inserted[0]["application_id"] == "app-2"


def test_batch_reviewers_assign_unknown_batch_404(client, monkeypatch, _clear_overrides):
    _install_db(monkeypatch, {"batches": [], "application_batches": [], "reviewer_assignments": []})
    monkeypatch.setattr("app.routers.admin_platform.write_audit", lambda **k: None)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.post("/admin/platform/batches/bad/reviewers",
                    json={"reviewer_user_ids": ["rev-1"]})
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "batch_not_found"


def test_batch_reviewers_assign_requires_capability(client, monkeypatch, _clear_overrides):
    _install_db(monkeypatch, {"batches": [{"id": "b1", "name": "A"}],
                              "application_batches": [], "reviewer_assignments": []})
    app.dependency_overrides[get_current_user] = _override_user("rev-1", roles=["reviewer"])
    r = client.post("/admin/platform/batches/b1/reviewers",
                    json={"reviewer_user_ids": ["rev-1"]})
    assert r.status_code == 403


def test_batch_reviewer_unassign_skips_reviewed(client, monkeypatch, _clear_overrides):
    """DELETE removes only assignments with no submitted review for that reviewer."""
    fake = _install_db(monkeypatch, {
        "batches": [{"id": "b1", "name": "Batch A"}],
        "application_batches": [
            {"application_id": "app-1", "application_track": "tir", "batch_id": "b1"},
            {"application_id": "app-2", "application_track": "tir", "batch_id": "b1"},
        ],
        "reviewer_assignments": [
            {"application_id": "app-1", "application_track": "tir", "reviewer_user_id": "rev-1"},
            {"application_id": "app-2", "application_track": "tir", "reviewer_user_id": "rev-1"},
        ],
        # rev-1 already submitted a review for app-1 → that assignment is protected.
        "reviews": [
            {"application_id": "app-1", "application_track": "tir",
             "reviewer_user_id": "rev-1", "status": "submitted"},
        ],
    })
    monkeypatch.setattr("app.routers.admin_platform.write_audit", lambda **k: None)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.delete("/admin/platform/batches/b1/reviewers/rev-1")
    assert r.status_code == 200, r.text
    assert r.json() == {"removed": 1}
    # Only app-2's assignment was deleted; app-1 (reviewed) stays. The fake's
    # execute() removes matching rows from the in-memory table, so the surviving
    # rows are the proof of which assignment was (not) deleted.
    remaining = fake.tables["reviewer_assignments"]
    assert {r2["application_id"] for r2 in remaining} == {"app-1"}


def test_batch_reviewer_unassign_unknown_batch_404(client, monkeypatch, _clear_overrides):
    _install_db(monkeypatch, {"batches": [], "application_batches": [],
                              "reviewer_assignments": [], "reviews": []})
    monkeypatch.setattr("app.routers.admin_platform.write_audit", lambda **k: None)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.delete("/admin/platform/batches/bad/reviewers/rev-1")
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "batch_not_found"


def test_roster_includes_batches_grouping(client, monkeypatch, _clear_overrides):
    """Each reviewer object carries a `batches` array of {name, count} derived
    from reviewer_assignments → application_batches → batches.name; apps with no
    batch are omitted from `batches` but still count in `assigned`."""
    _install_db(monkeypatch, {
        "user_roles": [{"user_id": "rev-1", "role": "reviewer"}],
        "profiles": [{"id": "rev-1", "email": "r1@x.in", "full_name": "Rev One"}],
        "reviewer_profiles": [],
        "reviewer_assignments": [
            {"id": "a1", "reviewer_user_id": "rev-1", "application_id": "app-1",
             "application_track": "tir", "declined_at": None, "reassigned_to": None},
            {"id": "a2", "reviewer_user_id": "rev-1", "application_id": "app-2",
             "application_track": "tir", "declined_at": None, "reassigned_to": None},
            # app-3 has no batch membership → omitted from `batches` grouping.
            {"id": "a3", "reviewer_user_id": "rev-1", "application_id": "app-3",
             "application_track": "tir", "declined_at": None, "reassigned_to": None},
        ],
        "reviews": [],
        "ai_screening": [],
        "application_batches": [
            {"application_id": "app-1", "application_track": "tir", "batch_id": "b1"},
            {"application_id": "app-2", "application_track": "tir", "batch_id": "b1"},
        ],
        "batches": [{"id": "b1", "name": "Batch A"}],
    })
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.get("/admin/platform/reviewers")
    assert r.status_code == 200, r.text
    row = {x["user_id"]: x for x in r.json()["reviewers"]}["rev-1"]
    assert row["assigned"] == 3            # all three count toward assigned
    assert row["batches"] == [{"name": "Batch A", "count": 2}]


def test_admin_stats_includes_decision_counts(client, monkeypatch, _clear_overrides):
    _install_db(monkeypatch, {
        "tir_applications":[{"id":"app-1","status":"shortlisted"}], "sip_applications":[],
        "admin_decisions":[
            {"application_id":"app-1","application_track":"tir","decision":"shortlisted"},
            {"application_id":"app-2","application_track":"tir","decision":"rejected"}],
        "ai_screening":[], "reviews":[], "reviewer_assignments":[], "profiles":[], "industry_categories":[]})
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.get("/admin/platform/stats")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "decisions" in body
    assert body["decisions"]["shortlisted"] == 1 and body["decisions"]["rejected"] == 1


# ─── GET /admin/platform/reviewers/{user_id}/applications ──────────────────


def test_roster_completed_counts_submitted_reviews_without_completed_at(
    client, monkeypatch, _clear_overrides,
):
    """A submitted review must count toward `completed` even if the assignment's
    best-effort `completed_at` write never landed."""
    tables = _empty_admin_tables()
    tables["user_roles"] = [{"user_id": "rev-1", "role": "reviewer"}]
    tables["profiles"] = [{"id": "rev-1", "full_name": "Rev One", "email": "r1@x.com"}]
    tables["reviewer_profiles"] = []
    tables["reviewer_assignments"] = [
        {"id": "as-1", "reviewer_user_id": "rev-1", "application_id": "app-1",
         "application_track": "tir", "declined_at": None, "reassigned_to": None,
         "completed_at": None},
    ]
    tables["reviews"] = [
        {"id": "r-1", "reviewer_user_id": "rev-1", "application_id": "app-1",
         "application_track": "tir", "submitted_at": "2026-06-01T00:00:00Z"},
    ]
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.get("/admin/platform/reviewers")
    assert r.status_code == 200, r.text
    rev = r.json()["reviewers"][0]
    assert rev["assigned"] == 1
    assert rev["completed"] == 1
    assert rev["progress"] == "1 / 1"


def test_reviewer_applications_lists_active_assignments(client, monkeypatch, _clear_overrides):
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    _install_db(monkeypatch, {
        "user_roles": [{"user_id": "rev-1", "role": "reviewer"}],
        "reviewer_assignments": [
            {"id": "as-1", "reviewer_user_id": "rev-1", "application_id": "app-1",
             "application_track": "tir", "declined_at": None, "reassigned_to": None,
             "completed_at": None},
            {"id": "as-2", "reviewer_user_id": "rev-1", "application_id": "app-2",
             "application_track": "tir", "declined_at": "2026-06-01", "reassigned_to": None,
             "completed_at": None},  # declined → excluded
        ],
        "tir_applications": [
            {"id": "app-1", "status": "under_review", "basic_org": "Acme",
             "basic_full_name": "A Founder", "display_seq": 101},
            {"id": "app-2", "status": "evaluated", "basic_org": "Beta", "display_seq": 102},
        ],
        "sip_applications": [],
        "ai_screening": [{"application_id": "app-1", "application_track": "tir",
                          "project_name": "Acme Robotics", "industry_category_id": "ind-1"}],
        "industry_categories": [{"id": "ind-1", "label": "Robotics"}],
        "reviews": [{"id": "r-1", "reviewer_user_id": "rev-1", "application_id": "app-1",
                     "application_track": "tir", "submitted_at": None}],
        "application_batches": [{"application_id": "app-1", "application_track": "tir",
                                 "batch_id": "b-1"}],
        "batches": [{"id": "b-1", "name": "Batch A"}],
    })
    r = client.get("/admin/platform/reviewers/rev-1/applications")
    assert r.status_code == 200
    apps = r.json()["applications"]
    assert [a["id"] for a in apps] == ["app-1"]          # declined app-2 excluded
    a = apps[0]
    assert a["project"] == "Acme Robotics"
    assert a["industry"] == "Robotics"
    assert a["status"] == "under_review"
    assert a["batch"] == "Batch A"
    assert a["reviewStatus"] == "pending"


# ─── Task 5: DELETE /admin/platform/batches/{id} ───────────────────────


def test_delete_batch_unlinks_apps_keeps_assignments(client, monkeypatch, _clear_overrides):
    tables = _empty_admin_tables()
    tables["batches"] = [{"id": "b-1", "name": "Batch A"}]
    tables["application_batches"] = [
        {"application_id": "app-1", "application_track": "tir", "batch_id": "b-1"},
    ]
    tables["reviewer_profiles"] = [
        {"reviewer_user_id": "rev-1", "batch_id": "b-1"},
    ]
    tables["reviewer_assignments"] = [
        {"id": "as-1", "reviewer_user_id": "rev-1", "application_id": "app-1",
         "application_track": "tir", "declined_at": None, "reassigned_to": None},
    ]
    fake = _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.delete("/admin/platform/batches/b-1")
    assert r.status_code == 200, r.text
    assert fake.tables["batches"] == []                 # batch deleted
    assert fake.tables["application_batches"] == []      # links removed
    assert len(fake.tables["reviewer_assignments"]) == 1  # assignments untouched
    # reviewer_profiles.batch_id cleared (recorded as an update with batch_id=None)
    assert any(t == "reviewer_profiles" and p.get("batch_id") is None
               for (t, p, _eqs) in fake.updates)


def test_delete_batch_404_unknown(client, monkeypatch, _clear_overrides):
    _install_db(monkeypatch, _empty_admin_tables())
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.delete("/admin/platform/batches/nope")
    assert r.status_code == 404


def test_delete_batch_requires_manage_batches(client, _clear_overrides):
    app.dependency_overrides[get_current_user] = _override_user("rev-1", roles=["reviewer"])
    assert client.delete("/admin/platform/batches/b-1").status_code == 403


# ─── Task 7: Bulk assign / remove reviewer apps ────────────────────────────


def test_bulk_assign_reviewer_apps(client, monkeypatch, _clear_overrides):
    tables = _empty_admin_tables()
    tables["user_roles"] = [{"user_id": "rev-1", "role": "reviewer"}]
    tables["reviewer_assignments"] = [
        {"id": "as-0", "reviewer_user_id": "rev-1", "application_id": "app-0",
         "application_track": "tir", "declined_at": None, "reassigned_to": None},
    ]
    fake = _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.post("/admin/platform/reviewers/rev-1/applications", json={"items": [
        {"application_id": "app-1", "track": "tir"},
        {"application_id": "app-0", "track": "tir"},   # already assigned
    ]})
    assert r.status_code == 200, r.text
    results = {x["application_id"]: x["status"] for x in r.json()["results"]}
    assert results["app-1"] == "created"
    assert results["app-0"] == "already_assigned"
    assert any(t == "reviewer_assignments" and p.get("application_id") == "app-1"
               for (t, p) in fake.inserts)


def test_bulk_assign_marks_non_reviewer(client, monkeypatch, _clear_overrides):
    tables = _empty_admin_tables()
    tables["user_roles"] = []           # target holds no reviewer role
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.post("/admin/platform/reviewers/ghost/applications", json={"items": [
        {"application_id": "app-1", "track": "tir"},
    ]})
    assert r.status_code == 200, r.text
    assert r.json()["results"][0]["status"] == "not_a_reviewer"


def test_bulk_remove_removes_all_including_submitted(client, monkeypatch, _clear_overrides):
    """Remove unassigns every item regardless of submitted-review status.
    app-1 (no review) returns 'removed'; app-2 (submitted review) returns
    'skipped_submitted' (the frontend warns, but the assignment is still deleted).
    The review row is preserved for audit.
    """
    tables = _empty_admin_tables()
    tables["reviewer_assignments"] = [
        {"id": "as-1", "reviewer_user_id": "rev-1", "application_id": "app-1",
         "application_track": "tir", "declined_at": None, "reassigned_to": None},
        {"id": "as-2", "reviewer_user_id": "rev-1", "application_id": "app-2",
         "application_track": "tir", "declined_at": None, "reassigned_to": None},
    ]
    tables["reviews"] = [
        {"id": "r-2", "reviewer_user_id": "rev-1", "application_id": "app-2",
         "application_track": "tir", "submitted_at": "2026-06-01T00:00:00Z"},
    ]
    fake = _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.post("/admin/platform/reviewers/rev-1/applications/remove", json={"items": [
        {"application_id": "app-1", "track": "tir"},
        {"application_id": "app-2", "track": "tir"},   # submitted → skipped_submitted but still deleted
    ]})
    assert r.status_code == 200, r.text
    results = {x["application_id"]: x["status"] for x in r.json()["results"]}
    assert results["app-1"] == "removed"
    assert results["app-2"] == "skipped_submitted"  # warns frontend but assignment is deleted
    assert fake.tables["reviewer_assignments"] == []
    assert len(fake.tables["reviews"]) == 1  # review row preserved for audit


def test_bulk_endpoints_admin_only(client, _clear_overrides):
    body = {"items": [{"application_id": "a", "track": "tir"}]}
    app.dependency_overrides[get_current_user] = _override_user("rev-x", roles=["reviewer"])
    assert client.post("/admin/platform/reviewers/rev-1/applications", json=body).status_code == 403
    app.dependency_overrides[get_current_user] = _override_user("lead-x", roles=["leadership"])
    assert client.post("/admin/platform/reviewers/rev-1/applications/remove", json=body).status_code == 403


def test_roster_progress_is_work_done_union(client, monkeypatch, _clear_overrides):
    """Progress = reviews done / |active assignments ∪ reviewed apps|.
    A submitted review for an app the reviewer is NO LONGER assigned to still
    counts in both numerator and denominator (the unassign churn case)."""
    tables = _empty_admin_tables()
    tables["user_roles"] = [{"user_id": "rev-1", "role": "reviewer"}]
    tables["profiles"] = [{"id": "rev-1", "full_name": "Ramanpreet", "email": "r@x.com"}]
    tables["reviewer_profiles"] = []
    tables["reviewer_assignments"] = [
        {"id": f"as-{c}", "reviewer_user_id": "rev-1", "application_id": f"app-{c}",
         "application_track": "tir", "declined_at": None, "reassigned_to": None,
         "completed_at": None} for c in "abcd"
    ]
    tables["reviews"] = [
        {"id": "r-x", "reviewer_user_id": "rev-1", "application_id": "app-x",
         "application_track": "tir", "submitted_at": "2026-06-20T00:00:00Z"},
        {"id": "r-y", "reviewer_user_id": "rev-1", "application_id": "app-y",
         "application_track": "tir", "submitted_at": "2026-06-21T00:00:00Z"},
    ]
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.get("/admin/platform/reviewers")
    assert r.status_code == 200, r.text
    rev = r.json()["reviewers"][0]
    assert rev["completed"] == 2
    assert rev["assigned"] == 6
    assert rev["progress"] == "2 / 6"


def test_patch_reviewer_rejects_out_of_range_weight(client, monkeypatch, _clear_overrides):
    _install_db(monkeypatch, _empty_admin_tables())
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    assert client.patch("/admin/platform/reviewers/rev-1", json={"weight": 11}).status_code == 422
    assert client.patch("/admin/platform/reviewers/rev-1", json={"weight": -1}).status_code == 422


def test_patch_reviewer_accepts_in_range_weight(client, monkeypatch, _clear_overrides):
    _install_db(monkeypatch, _empty_admin_tables())
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    assert client.patch("/admin/platform/reviewers/rev-1", json={"weight": 7.5}).status_code == 200


def test_decision_accepts_jury_review(client, monkeypatch, _clear_overrides):
    # decision="jury_review" should return NOT 422 (invalid enum).
    # App must be in a state from which jury_review is a legal transition.
    _install_db(monkeypatch, {
        "tir_applications": [{"id": "APP_EVALUATED", "status": "evaluated"}],
        "sip_applications": [], "admin_decisions": [], "application_status_log": [],
    })
    monkeypatch.setattr("app.services.decisions.write_audit", lambda **k: None)
    app.dependency_overrides[get_current_user] = _override_user("lead-1", roles=["leadership"])
    r = client.post(
        "/admin/platform/applications/tir/APP_EVALUATED/decision",
        json={"decision": "jury_review"},
    )
    # 200 (decided) — NOT 422 (invalid enum). Exact body depends on the fake; assert not-422.
    assert r.status_code != 422, r.text


# ─── Task 5 (new): pipeline flags aggregation + remove-reviewed unblock ────


def test_pipeline_flags_aggregated_from_submitted_reviews(
    client, monkeypatch, _clear_overrides,
):
    """Pipeline rows must carry an aggregated `flags` list from submitted
    reviews. An app with a submitted review that has flags=["x"] must have
    flags==["x"] in the pipeline row; an app with no flagged review must have
    flags==[].
    """
    app_id_flagged = "flagged-app-1111-1111-1111-111111111111"
    app_id_clean = "clean-app-2222-2222-2222-222222222222"
    tables = _empty_admin_tables()
    tables["tir_applications"] = [
        {"id": app_id_flagged, "status": "evaluated", "display_seq": 30001,
         "basic_full_name": "Flagged Founder", "basic_email": "f@x.com",
         "basic_org": "Flagged Org", "submitted_at": "2026-06-01T00:00:00Z"},
        {"id": app_id_clean, "status": "evaluated", "display_seq": 30002,
         "basic_full_name": "Clean Founder", "basic_email": "c@x.com",
         "basic_org": "Clean Org", "submitted_at": "2026-06-01T00:00:00Z"},
    ]
    # Submitted review with a flag for app_id_flagged; draft review (no
    # submitted_at) for app_id_clean — the draft must not contribute flags.
    tables["reviews"] = [
        {"id": "rv-flag", "reviewer_user_id": "rev-1",
         "application_id": app_id_flagged, "application_track": "tir",
         "submitted_at": "2026-06-02T00:00:00Z", "flags": ["x"]},
        {"id": "rv-draft", "reviewer_user_id": "rev-1",
         "application_id": app_id_clean, "application_track": "tir",
         "submitted_at": None, "flags": ["y"]},  # draft — must NOT contribute
    ]
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user(
        "admin-1", roles=["admin"],
    )

    r = client.get("/admin/platform/applications")
    assert r.status_code == 200, r.text
    by_id = {a["id"]: a for a in r.json()["applications"]}

    assert by_id[app_id_flagged]["flags"] == ["x"], (
        "flagged app should carry flags=['x'] from submitted review"
    )
    assert by_id[app_id_clean]["flags"] == [], (
        "clean app (only draft review) should carry flags=[]"
    )


def test_bulk_remove_removes_app_with_submitted_review(
    client, monkeypatch, _clear_overrides,
):
    """bulk_remove_reviewer_apps must return status='skipped_submitted' for an
    app whose reviewer already submitted a review, AND still delete the
    reviewer_assignment. The reviews row is left intact for audit.
    """
    tables = _empty_admin_tables()
    tables["reviewer_assignments"] = [
        {"id": "as-1", "reviewer_user_id": "rev-1", "application_id": "app-r",
         "application_track": "tir", "declined_at": None, "reassigned_to": None},
    ]
    tables["reviews"] = [
        {"id": "r-1", "reviewer_user_id": "rev-1", "application_id": "app-r",
         "application_track": "tir", "submitted_at": "2026-06-01T00:00:00Z",
         "flags": []},
    ]
    fake = _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user(
        "admin-1", roles=["admin"],
    )
    r = client.post(
        "/admin/platform/reviewers/rev-1/applications/remove",
        json={"items": [{"application_id": "app-r", "track": "tir"}]},
    )
    assert r.status_code == 200, r.text
    results = {x["application_id"]: x["status"] for x in r.json()["results"]}
    assert results["app-r"] == "skipped_submitted", (
        "should be 'skipped_submitted' to warn frontend — reviewer submitted a review"
    )
    # Assignment deleted even when a review exists.
    assert fake.tables["reviewer_assignments"] == []
    # Review row preserved (audit trail).
    assert len(fake.tables["reviews"]) == 1
# ─── Task 5: Weight-adjusted reviewer score in the pipeline ───────────────


def test_pipeline_includes_weight_adjusted_reviewer_score(client, monkeypatch, _clear_overrides):
    app_id = "22222222-2222-2222-2222-222222222222"
    tables = _empty_admin_tables()
    tables["tir_applications"] = [
        {"id": app_id, "status": "under_review", "display_seq": 26014,
         "basic_full_name": "Bo", "submitted_at": "2026-06-02T00:00:00Z",
         "created_at": "2026-05-21T00:00:00Z"},
    ]

    def _review(rid, v):
        return {"application_id": app_id, "application_track": "tir",
                "reviewer_user_id": rid, "submitted_at": "2026-06-03T00:00:00Z",
                "score_problem": v, "score_solution": v, "score_tech": v,
                "score_founders": v, "score_commitment": v}

    # rev-a: all-6s → weighted_overall 6.0, weight 1.0
    # rev-b: all-10s → weighted_overall 10.0, weight 3.0
    # weight-adjusted mean = (1*6 + 3*10) / (1+3) = 9.0
    tables["reviews"] = [_review("rev-a", 6), _review("rev-b", 10)]
    tables["reviewer_profiles"] = [
        {"reviewer_user_id": "rev-a", "weight": 1.0},
        {"reviewer_user_id": "rev-b", "weight": 3.0},
    ]
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("lead-1", roles=["leadership"])

    r = client.get("/admin/platform/applications")
    assert r.status_code == 200, r.text
    item = r.json()["applications"][0]
    assert item["reviewer_score"] == 9.0


def test_pipeline_reviewer_score_none_without_submitted_review(client, monkeypatch, _clear_overrides):
    app_id = "33333333-3333-3333-3333-333333333333"
    tables = _empty_admin_tables()
    tables["tir_applications"] = [
        {"id": app_id, "status": "under_review", "display_seq": 26015,
         "submitted_at": "2026-06-02T00:00:00Z", "created_at": "2026-05-21T00:00:00Z"},
    ]
    # A draft review (no submitted_at) must NOT count.
    tables["reviews"] = [
        {"application_id": app_id, "application_track": "tir", "reviewer_user_id": "rev-a",
         "submitted_at": None, "score_problem": 8, "score_solution": 8, "score_tech": 8,
         "score_founders": 8, "score_commitment": 8},
    ]
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("lead-1", roles=["leadership"])

    r = client.get("/admin/platform/applications")
    assert r.status_code == 200, r.text
    assert r.json()["applications"][0]["reviewer_score"] is None


# ─── Task 7: batch assign fans out to the batch's reviewers + emails ──────────


def test_assign_applications_fans_out_to_batch_reviewers(client, monkeypatch, _clear_overrides):
    existing_app = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    new_app = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    tables = _empty_admin_tables()
    tables["batches"] = [{"id": "b1", "name": "Batch A"}]
    tables["application_batches"] = [
        {"application_id": existing_app, "application_track": "tir", "batch_id": "b1"},
    ]
    tables["reviewer_assignments"] = [
        {"application_id": existing_app, "application_track": "tir",
         "reviewer_user_id": "rev-1", "declined_at": None, "reassigned_to": None},
    ]
    fake = _install_db(monkeypatch, tables)
    monkeypatch.setattr("app.routers.admin_platform.write_audit", lambda **k: None)
    notified = {}
    monkeypatch.setattr(
        "app.routers.admin_platform.notify_reviewers_assigned",
        lambda sb, rows: notified.update({"rows": rows}),
    )
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])

    r = client.post("/admin/platform/batches/b1/applications",
                    json={"items": [{"track": "tir", "application_id": new_app}]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["assigned"] == 1
    assert body["assignments_created"] == 1
    assert body["reviewers_notified"] == 1
    ra_inserts = [row for (t, row) in fake.inserts if t == "reviewer_assignments"]
    assert any(row["application_id"] == new_app and row["reviewer_user_id"] == "rev-1"
               for row in ra_inserts)
    assert notified.get("rows") and notified["rows"][0]["application_id"] == new_app


def test_assign_applications_skips_existing_assignment(client, monkeypatch, _clear_overrides):
    existing_app = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    new_app = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    tables = _empty_admin_tables()
    tables["batches"] = [{"id": "b1", "name": "Batch A"}]
    tables["application_batches"] = [
        {"application_id": existing_app, "application_track": "tir", "batch_id": "b1"},
    ]
    tables["reviewer_assignments"] = [
        {"application_id": existing_app, "application_track": "tir",
         "reviewer_user_id": "rev-1", "declined_at": None, "reassigned_to": None},
        {"application_id": new_app, "application_track": "tir",
         "reviewer_user_id": "rev-1", "declined_at": None, "reassigned_to": None},
    ]
    _install_db(monkeypatch, tables)
    monkeypatch.setattr("app.routers.admin_platform.write_audit", lambda **k: None)
    monkeypatch.setattr("app.routers.admin_platform.notify_reviewers_assigned", lambda sb, rows: None)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])

    r = client.post("/admin/platform/batches/b1/applications",
                    json={"items": [{"track": "tir", "application_id": new_app}]})
    assert r.status_code == 200, r.text
    assert r.json()["assignments_created"] == 0


def test_assign_applications_no_reviewers_no_fanout(client, monkeypatch, _clear_overrides):
    new_app = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    tables = _empty_admin_tables()
    tables["batches"] = [{"id": "b1", "name": "Batch A"}]
    fake = _install_db(monkeypatch, tables)
    monkeypatch.setattr("app.routers.admin_platform.write_audit", lambda **k: None)
    monkeypatch.setattr("app.routers.admin_platform.notify_reviewers_assigned", lambda sb, rows: None)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])

    r = client.post("/admin/platform/batches/b1/applications",
                    json={"items": [{"track": "tir", "application_id": new_app}]})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["assigned"] == 1
    assert body["assignments_created"] == 0
    assert body["reviewers_notified"] == 0
    assert not any(t == "reviewer_assignments" for (t, _row) in fake.inserts)


# ─── Fix 1: VIP (sip) pipeline rows use company name ─────────────────────


def test_pipeline_vip_row_uses_basic_org_as_name(client, monkeypatch, _clear_overrides):
    """A sip-track pipeline row must show basic_org as name, not ai project_name."""
    app_id = "sip-app-1111-1111-1111-111111111111"
    tables = _empty_admin_tables()
    tables["sip_applications"] = [
        {"id": app_id, "status": "submitted", "display_seq": 10001,
         "basic_full_name": "Founder Name", "basic_email": "f@vip.com",
         "basic_org": "Acme Pvt Ltd",
         "submitted_at": "2026-06-15T00:00:00Z", "created_at": "2026-06-10T00:00:00Z"},
    ]
    tables["ai_screening"] = [
        {"application_id": app_id, "application_track": "sip",
         "score_overall": 7.5, "project_name": "Acme AI Project"},
    ]
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])

    r = client.get("/admin/platform/applications")
    assert r.status_code == 200, r.text
    items = r.json()["applications"]
    assert len(items) == 1
    assert items[0]["name"] == "Acme Pvt Ltd"


def test_pipeline_tir_row_uses_project_name(client, monkeypatch, _clear_overrides):
    """A tir-track pipeline row keeps using ai_screening.project_name, not basic_org."""
    app_id = "tir-app-2222-2222-2222-222222222222"
    tables = _empty_admin_tables()
    tables["tir_applications"] = [
        {"id": app_id, "status": "submitted", "display_seq": 20001,
         "basic_full_name": "Founder TIR", "basic_email": "t@tir.com",
         "basic_org": "TIR Org",
         "submitted_at": "2026-06-15T00:00:00Z", "created_at": "2026-06-10T00:00:00Z"},
    ]
    tables["ai_screening"] = [
        {"application_id": app_id, "application_track": "tir",
         "score_overall": 6.0, "project_name": "TIR Project Name"},
    ]
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])

    r = client.get("/admin/platform/applications")
    assert r.status_code == 200, r.text
    items = r.json()["applications"]
    assert len(items) == 1
    assert items[0]["name"] == "TIR Project Name"


# ─── Fix 2: bulk_remove returns skipped_submitted + still deletes ──────────


def test_bulk_remove_not_found_returns_not_found(client, monkeypatch, _clear_overrides):
    """An unknown assignment returns not_found."""
    tables = _empty_admin_tables()
    tables["reviewer_assignments"] = []
    tables["reviews"] = []
    fake = _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.post("/admin/platform/reviewers/rev-1/applications/remove",
                    json={"items": [{"application_id": "ghost-app", "track": "tir"}]})
    assert r.status_code == 200, r.text
    results = {x["application_id"]: x["status"] for x in r.json()["results"]}
    assert results["ghost-app"] == "not_found"
    assert fake.tables["reviewer_assignments"] == []


# ─── Fix 5: roster lastActivity falls back to assignment assigned_at ──────


def test_roster_last_activity_fallback_to_assigned_at(client, monkeypatch, _clear_overrides):
    """A reviewer with assignments but no submitted reviews must have a non-null
    lastActivity derived from the latest reviewer_assignments.assigned_at."""
    tables = _empty_admin_tables()
    tables["user_roles"] = [{"user_id": "rev-2", "role": "reviewer"}]
    tables["profiles"] = [{"id": "rev-2", "full_name": "Pending Rev", "email": "p@x.com"}]
    tables["reviewer_profiles"] = []
    tables["reviewer_assignments"] = [
        {"id": "a-1", "reviewer_user_id": "rev-2", "application_id": "app-1",
         "application_track": "tir", "declined_at": None, "reassigned_to": None,
         "assigned_at": "2026-06-20T10:00:00Z"},
        {"id": "a-2", "reviewer_user_id": "rev-2", "application_id": "app-2",
         "application_track": "tir", "declined_at": None, "reassigned_to": None,
         "assigned_at": "2026-06-22T08:00:00Z"},
    ]
    tables["reviews"] = []
    tables["ai_screening"] = []
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.get("/admin/platform/reviewers")
    assert r.status_code == 200, r.text
    rev = {x["user_id"]: x for x in r.json()["reviewers"]}["rev-2"]
    assert rev["lastActivity"] is not None, "lastActivity should fall back to assigned_at"
    assert rev["lastActivity"] == "2026-06-22T08:00:00Z"


# ─── Rejected Applications tab: exclude_status filter ──────────────────


def test_pipeline_exclude_status_drops_rejected(client, monkeypatch, _clear_overrides):
    """?exclude_status=rejected omits rejected rows; total reflects the exclusion."""
    tables = _empty_admin_tables()
    tables["tir_applications"] = [
        {"id": "a-ev", "status": "evaluated", "display_seq": 26001,
         "basic_full_name": "Ev", "basic_email": "e@x.com", "basic_org": "OrgE",
         "submitted_at": "2026-06-01T00:00:00Z"},
        {"id": "a-rej", "status": "rejected", "display_seq": 26002,
         "basic_full_name": "Rej", "basic_email": "r@x.com", "basic_org": "OrgR",
         "submitted_at": "2026-06-02T00:00:00Z"},
    ]
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.get("/admin/platform/applications?exclude_status=rejected")
    assert r.status_code == 200, r.text
    body = r.json()
    assert [a["id"] for a in body["applications"]] == ["a-ev"]
    assert body["total"] == 1


def test_pipeline_status_rejected_returns_only_rejected(client, monkeypatch, _clear_overrides):
    """?status=rejected returns only rejected rows (the Rejected tab's fetch)."""
    tables = _empty_admin_tables()
    tables["tir_applications"] = [
        {"id": "a-ev", "status": "evaluated", "display_seq": 26001,
         "basic_full_name": "Ev", "basic_email": "e@x.com", "basic_org": "OrgE",
         "submitted_at": "2026-06-01T00:00:00Z"},
        {"id": "a-rej", "status": "rejected", "display_seq": 26002,
         "basic_full_name": "Rej", "basic_email": "r@x.com", "basic_org": "OrgR",
         "submitted_at": "2026-06-02T00:00:00Z"},
    ]
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", roles=["admin"])
    r = client.get("/admin/platform/applications?status=rejected")
    assert r.status_code == 200, r.text
    assert [a["id"] for a in r.json()["applications"]] == ["a-rej"]
