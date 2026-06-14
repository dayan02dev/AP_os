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
    from app.services import admin_query, applications_query
    fake = _FakeAdminClient(tables=tables)
    monkeypatch.setattr(admin_query, "get_admin_client", lambda: fake)
    monkeypatch.setattr(applications_query, "get_admin_client", lambda: fake)
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
