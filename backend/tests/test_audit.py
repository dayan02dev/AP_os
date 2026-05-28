"""Unit tests for the best-effort audit-write service.

Verifies the happy-path insert payload and that any underlying Supabase
failure is swallowed (audit-infra problems must not break the primary
caller).
"""
from __future__ import annotations

from types import SimpleNamespace
from typing import Any

from app.services import audit as audit_module


class _CapturingInsert:
    def __init__(self, store: dict):
        self._store = store

    def insert(self, payload: dict[str, Any]):
        self._store["payload"] = payload
        return self

    def execute(self):
        return SimpleNamespace(data=[self._store.get("payload")], count=1)


class _CapturingClient:
    def __init__(self, store: dict):
        self._store = store

    def table(self, name: str) -> _CapturingInsert:
        self._store["table"] = name
        return _CapturingInsert(self._store)


class _FailingInsert:
    def insert(self, *_args, **_kwargs):
        return self

    def execute(self):
        raise RuntimeError("supabase down")


class _FailingClient:
    def table(self, _name: str) -> _FailingInsert:
        return _FailingInsert()


def test_write_audit_inserts_row(monkeypatch):
    store: dict = {}
    monkeypatch.setattr(
        audit_module, "get_admin_client", lambda: _CapturingClient(store)
    )

    audit_module.write_audit(
        actor_user_id="u-1",
        actor_role="admin",
        action_type="user.created",
        target_table="profiles",
        target_id="u-2",
        after={"email": "x@y.com"},
    )

    assert store["table"] == "audit_log_v2"
    payload = store["payload"]
    assert payload == {
        "actor_user_id": "u-1",
        "actor_role": "admin",
        "action_type": "user.created",
        "target_table": "profiles",
        "target_id": "u-2",
        "before_state": None,
        "after_state": {"email": "x@y.com"},
        "reason": None,
    }


def test_write_audit_swallows_supabase_failures(monkeypatch):
    monkeypatch.setattr(
        audit_module, "get_admin_client", lambda: _FailingClient()
    )

    # Must NOT raise; must return None.
    result = audit_module.write_audit(
        actor_user_id="u-1",
        actor_role="admin",
        action_type="user.created",
        target_id="u-2",
    )
    assert result is None
