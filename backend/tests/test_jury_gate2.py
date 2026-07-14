"""Task 9 — Gate-2 admin decisions (offered / waitlisted / on_hold / rejected).

Exercises the admin decision endpoint's gate_stage routing:
  * 409 not_in_jury_review when the app is not in jury_review;
  * 422 invalid_gate2_decision for a value outside the gate-2 set;
  * 422 rationale_required for a non-offered gate-2 decision with blank rationale;
  * decision 'offered' forces gate-2 routing even when gate_stage is unset;
  * the admin_decisions row records gate_stage='gate2';
  * status moves jury_review → decision.

Self-contained fake-Supabase scaffolding in the style of test_jury_admin.py:
the fake honours ``.eq()`` on SELECT and MUTATES rows on update/delete so a
status read-back inside the same request sees the moved status. Capabilities
are granted by overriding ``get_current_user`` (admin holds decide_application).
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from app.deps import get_current_user
from app.main import app


# ─── Fake Supabase client (eq honoured, mutating update/delete) ──────────


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
        rows = payload if isinstance(payload, list) else [payload]
        for row in rows:
            self._parent.inserts.append((self._name, row))
        return self

    def upsert(self, payload, on_conflict=None, **_k):
        self._mode = "insert"
        self._payload = payload
        rows = payload if isinstance(payload, list) else [payload]
        for row in rows:
            self._parent.inserts.append((self._name, row))
        return self

    def update(self, payload):
        self._mode = "update"
        self._payload = payload
        self._parent.updates.append((self._name, payload, list(self._eqs)))
        # Mutate in-memory so a re-read in the same request sees the change.
        for row in self._parent.tables.setdefault(self._name, []):
            if all(row.get(c) == v for c, v in self._eqs):
                row.update(payload)
        return self

    def delete(self):
        self._mode = "delete"
        table = self._parent.tables.setdefault(self._name, [])
        removed = [r for r in table if all(r.get(c) == v for c, v in self._eqs)]
        self._parent.deletes.append((self._name, list(self._eqs)))
        self._parent.tables[self._name] = [r for r in table if r not in removed]
        self._removed = removed
        return self

    def execute(self):
        if self._mode == "delete":
            return SimpleNamespace(data=self._removed, count=len(self._removed))
        if self._mode in ("insert", "update"):
            data = self._payload if isinstance(self._payload, list) else (
                [self._payload] if self._payload else [{"ok": True}]
            )
            return SimpleNamespace(data=data, count=len(data))
        rows = self._parent.tables.get(self._name, [])
        for col, val in self._eqs:
            rows = [r for r in rows if r.get(col) == val]
        return SimpleNamespace(data=rows, count=len(rows))


class _FakeAdminClient:
    def __init__(self, tables: dict[str, list[dict]] | None = None):
        self.tables: dict[str, list[dict]] = tables or {}
        self.inserts: list[tuple[str, Any]] = []
        self.updates: list[tuple[str, Any, list]] = []
        self.deletes: list[tuple[str, list]] = []

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(self, name)


def _override_user(user_id: str, roles: list[str]):
    def _f():
        return {"user_id": user_id, "email": f"{user_id}@x.com", "roles": roles}
    return _f


@pytest.fixture
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


def _install_db(monkeypatch, tables: dict[str, list[dict]]) -> _FakeAdminClient:
    from app.routers import admin_platform as ap
    from app.services import applications_query, decisions, state_machine

    fake = _FakeAdminClient(tables=tables)
    monkeypatch.setattr(ap, "get_admin_client", lambda: fake, raising=False)
    monkeypatch.setattr(decisions, "get_admin_client", lambda: fake)
    monkeypatch.setattr(state_machine, "get_admin_client", lambda: fake)
    monkeypatch.setattr(applications_query, "get_admin_client", lambda: fake)
    monkeypatch.setattr(decisions, "write_audit", lambda **k: None)
    return fake


def _base_tables() -> dict[str, list[dict]]:
    return {
        "tir_applications": [],
        "sip_applications": [],
        "admin_decisions": [],
        "application_status_log": [],
    }


APP = "aaaaaaaa-0000-0000-0000-00000000000{}"


# ─── 409 not_in_jury_review ──────────────────────────────────────────────


def test_gate2_requires_jury_review(client, monkeypatch, _clear_overrides):
    app_id = APP.format(1)
    tables = _base_tables()
    tables["tir_applications"] = [{"id": app_id, "status": "shortlisted"}]
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", ["admin"])

    r = client.post(
        f"/admin/platform/applications/tir/{app_id}/decision",
        json={"decision": "offered", "gate_stage": "gate2"},
    )
    assert r.status_code == 409, r.text
    assert r.json()["detail"]["code"] == "not_in_jury_review"


# ─── 422 invalid_gate2_decision ──────────────────────────────────────────


def test_gate2_invalid_decision_422(client, monkeypatch, _clear_overrides):
    app_id = APP.format(2)
    tables = _base_tables()
    tables["tir_applications"] = [{"id": app_id, "status": "jury_review"}]
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", ["admin"])

    # 'shortlisted' is in the DecisionBody Literal but NOT the gate2 valid set,
    # so Pydantic accepts the body and the service must 422 it.
    r = client.post(
        f"/admin/platform/applications/tir/{app_id}/decision",
        json={"decision": "shortlisted", "gate_stage": "gate2"},
    )
    assert r.status_code == 422, r.text
    detail = r.json()["detail"]
    assert isinstance(detail, dict), f"expected dict detail, got: {detail}"
    assert detail.get("code") == "invalid_gate2_decision", detail


# ─── 422 rationale_required (non-offered, blank rationale) ───────────────


def test_gate2_rationale_required_422(client, monkeypatch, _clear_overrides):
    app_id = APP.format(3)
    tables = _base_tables()
    tables["tir_applications"] = [{"id": app_id, "status": "jury_review"}]
    _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", ["admin"])

    r = client.post(
        f"/admin/platform/applications/tir/{app_id}/decision",
        json={"decision": "rejected", "gate_stage": "gate2", "rationale": "   "},
    )
    assert r.status_code == 422, r.text
    detail = r.json()["detail"]
    assert isinstance(detail, dict), f"expected dict detail, got: {detail}"
    assert detail.get("code") == "rationale_required", detail


# ─── offered forces gate-2 routing even with gate_stage unset ────────────


def test_offered_forces_gate2_routing(client, monkeypatch, _clear_overrides):
    app_id = APP.format(4)
    tables = _base_tables()
    tables["tir_applications"] = [{"id": app_id, "status": "jury_review"}]
    fake = _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", ["admin"])

    # gate_stage deliberately omitted (defaults to gate1); 'offered' must still
    # route through record_gate2_decision.
    r = client.post(
        f"/admin/platform/applications/tir/{app_id}/decision",
        json={"decision": "offered"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["decision"] == "offered"
    assert body["gate_stage"] == "gate2"

    inserts = [row for (tbl, row) in fake.inserts if tbl == "admin_decisions"]
    assert inserts, "expected an admin_decisions insert"
    assert inserts[-1].get("gate_stage") == "gate2", inserts[-1]


# ─── admin_decisions row gate_stage + status move jury_review→decision ───


@pytest.mark.parametrize("decision", ["offered", "waitlisted", "on_hold", "rejected"])
def test_gate2_records_row_and_moves_status(client, monkeypatch, _clear_overrides, decision):
    app_id = APP.format(5)
    tables = _base_tables()
    tables["tir_applications"] = [{"id": app_id, "status": "jury_review"}]
    fake = _install_db(monkeypatch, tables)
    app.dependency_overrides[get_current_user] = _override_user("admin-1", ["admin"])

    body_json = {"decision": decision, "gate_stage": "gate2"}
    if decision != "offered":
        body_json["rationale"] = "well reasoned"

    r = client.post(
        f"/admin/platform/applications/tir/{app_id}/decision",
        json=body_json,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["decision"] == decision
    assert body["gate_stage"] == "gate2"
    assert body["from_status"] == "jury_review"

    # admin_decisions row recorded with gate_stage='gate2'.
    inserts = [row for (tbl, row) in fake.inserts if tbl == "admin_decisions"]
    assert inserts and inserts[-1].get("gate_stage") == "gate2", inserts

    # Status moved jury_review → decision.
    moved = [
        u for name, u, _ in fake.updates
        if name == "tir_applications" and u.get("status") == decision
    ]
    assert moved, f"expected status move to {decision}, got updates: {fake.updates}"
    assert fake.tables["tir_applications"][0]["status"] == decision
