"""Unit + integration tests for assignment consistency (detach on unassign/reject)."""
from types import SimpleNamespace

import pytest
from app.deps import get_current_user
from app.main import app


class _Tbl:
    def __init__(self, store, name):
        self._store = store
        self._name = name
        self._eqs = []
        self._mode = "select"

    def select(self, *a, **k):
        return self

    def delete(self):
        self._mode = "delete"
        return self

    def eq(self, col, val):
        self._eqs.append((col, val))
        return self

    def _match(self, row):
        return all(row.get(c) == v for c, v in self._eqs)

    def execute(self):
        rows = self._store.get(self._name, [])
        if self._mode == "delete":
            removed = [r for r in rows if self._match(r)]
            self._store[self._name] = [r for r in rows if not self._match(r)]
            return SimpleNamespace(data=removed, count=len(removed))
        return SimpleNamespace(data=[r for r in rows if self._match(r)], count=0)


class _Client:
    def __init__(self, store):
        self.store = store

    def table(self, name):
        return _Tbl(self.store, name)


def test_detach_removes_all_reviewer_assignments_and_batch_link():
    from app.services import applications_query as aq
    store = {
        "reviewer_assignments": [
            {"application_id": "a1", "application_track": "tir", "reviewer_user_id": "r1"},
            {"application_id": "a1", "application_track": "tir", "reviewer_user_id": "r2"},
            {"application_id": "a2", "application_track": "tir", "reviewer_user_id": "r1"},
        ],
        "application_batches": [
            {"application_id": "a1", "application_track": "tir", "batch_id": "b1"},
        ],
        "reviews": [
            {"application_id": "a1", "application_track": "tir", "reviewer_user_id": "r1",
             "submitted_at": "2026-07-01T00:00:00Z"},
        ],
    }
    client = _Client(store)
    out = aq.detach_application_from_review(client, "a1", "tir", remove_batch_link=True)
    assert out["assignments_removed"] == 2
    assert out["batch_links_removed"] == 1
    # a1 gone for ALL reviewers; a2 untouched.
    assert [r["application_id"] for r in store["reviewer_assignments"]] == ["a2"]
    # batch link gone; review row PRESERVED for audit.
    assert store["application_batches"] == []
    assert len(store["reviews"]) == 1


def test_detach_without_batch_link_keeps_batches():
    from app.services import applications_query as aq
    store = {
        "reviewer_assignments": [
            {"application_id": "a1", "application_track": "tir", "reviewer_user_id": "r1"},
        ],
        "application_batches": [
            {"application_id": "a1", "application_track": "tir", "batch_id": "b1"},
        ],
    }
    client = _Client(store)
    out = aq.detach_application_from_review(client, "a1", "tir", remove_batch_link=False)
    assert out["assignments_removed"] == 1
    assert out["batch_links_removed"] == 0
    assert len(store["application_batches"]) == 1


# ─── Task 2: POST /admin/platform/batches/unassign uses the helper ────────


def _override_user(user_id: str, roles: list[str] | None = None):
    def _f():
        return {
            "user_id": user_id,
            "email": f"{user_id}@x.com",
            "roles": roles or ["admin"],
        }
    return _f


@pytest.fixture
def _clear_overrides():
    yield
    app.dependency_overrides.clear()


def test_unassign_endpoint_removes_all_reviewers_and_batch_link(
    client, monkeypatch, _clear_overrides,
):
    from app.routers import admin_platform as ap

    store = {
        "reviewer_assignments": [
            {"application_id": "app-1", "application_track": "tir", "reviewer_user_id": "rev-1"},
            {"application_id": "app-1", "application_track": "tir", "reviewer_user_id": "rev-2"},
        ],
        "application_batches": [
            {"application_id": "app-1", "application_track": "tir", "batch_id": "b1"},
        ],
    }
    fake = _Client(store)
    monkeypatch.setattr(ap, "get_admin_client", lambda: fake)
    monkeypatch.setattr(ap, "write_audit", lambda **kwargs: None)
    app.dependency_overrides[get_current_user] = _override_user("admin-1")

    r = client.post(
        "/admin/platform/batches/unassign",
        json={"items": [{"track": "tir", "application_id": "app-1"}]},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["removed"] == 1
    assert body["assignments_removed"] == 2
    assert store["reviewer_assignments"] == []
    assert store["application_batches"] == []
