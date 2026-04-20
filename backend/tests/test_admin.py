"""Tests for /admin/* endpoints — auth guard + pagination shape.

Supabase calls are stubbed via a fake admin client so these tests run without
network access.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from app.config import settings
from app.routers import admin as admin_router
from app.utils.rate_limit import reset_buckets_for_tests


@pytest.fixture(autouse=True)
def _reset_rate_limits():
    reset_buckets_for_tests()
    yield
    reset_buckets_for_tests()


class _FakeQuery:
    """Minimal chainable stand-in for the supabase-py table builder."""

    def __init__(self, data: list[dict[str, Any]] | None = None, count: int = 0):
        self._data = data or []
        self._count = count

    def select(self, *_args, **_kwargs): return self
    def eq(self, *_args, **_kwargs): return self
    def order(self, *_args, **_kwargs): return self
    def limit(self, *_args, **_kwargs): return self
    def range(self, *_args, **_kwargs): return self

    def execute(self):
        return SimpleNamespace(data=self._data, count=self._count)


class _FakeAdminClient:
    def __init__(self, rows: dict[str, list[dict]] | None = None,
                 counts: dict[str, int] | None = None):
        self._rows = rows or {}
        self._counts = counts or {}

    def table(self, name: str) -> _FakeQuery:
        return _FakeQuery(
            data=self._rows.get(name, []),
            count=self._counts.get(name, len(self._rows.get(name, []))),
        )


# ─── Auth guard ────────────────────────────────────────────────────

def test_admin_requires_key(client):
    res = client.get("/admin/stats")
    assert res.status_code == 401


def test_admin_rejects_wrong_key(client):
    res = client.get("/admin/stats", headers={"X-Admin-Key": "nope-not-the-key"})
    assert res.status_code == 401


def test_admin_accepts_valid_key(client, monkeypatch):
    fake = _FakeAdminClient(
        rows={
            "applications": [],
            "resume_uploads": [],
            "support_tickets": [],
            "profiles": [],
        },
        counts={
            "applications": 0, "resume_uploads": 0,
            "support_tickets": 0, "profiles": 0,
        },
    )
    monkeypatch.setattr(admin_router, "get_admin_client", lambda: fake)

    res = client.get("/admin/stats", headers={"X-Admin-Key": settings.admin_api_key})
    assert res.status_code == 200, res.text
    body = res.json()
    assert "applications_by_status" in body
    assert "applications_total" in body
    assert "support_tickets_by_status" in body


# ─── Pagination ────────────────────────────────────────────────────

def test_admin_applications_pagination_shape(client, monkeypatch):
    rows = [{"id": f"a{i}", "status": "draft"} for i in range(5)]
    fake = _FakeAdminClient(rows={"applications": rows}, counts={"applications": 5})
    monkeypatch.setattr(admin_router, "get_admin_client", lambda: fake)

    res = client.get(
        "/admin/applications?page=1&page_size=10",
        headers={"X-Admin-Key": settings.admin_api_key},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["page"] == 1
    assert body["page_size"] == 10
    assert body["total"] == 5
    assert body["total_pages"] == 1
    assert len(body["applications"]) == 5


def test_admin_applications_rejects_oversize_page_size(client):
    res = client.get(
        "/admin/applications?page_size=500",
        headers={"X-Admin-Key": settings.admin_api_key},
    )
    # 422 from FastAPI validation (le=100).
    assert res.status_code == 422


def test_admin_application_detail_404(client, monkeypatch):
    fake = _FakeAdminClient(rows={"applications": []})
    monkeypatch.setattr(admin_router, "get_admin_client", lambda: fake)

    res = client.get(
        "/admin/applications/not-a-real-id",
        headers={"X-Admin-Key": settings.admin_api_key},
    )
    assert res.status_code == 404


def test_admin_application_detail_attaches_profile_and_resume(client, monkeypatch):
    fake = _FakeAdminClient(
        rows={
            "applications": [{"id": "app-1", "user_id": "u-1", "status": "draft"}],
            "profiles": [{"id": "u-1", "full_name": "Test"}],
            "resume_uploads": [{"id": "r-1", "parse_status": "completed"}],
        }
    )
    monkeypatch.setattr(admin_router, "get_admin_client", lambda: fake)

    res = client.get(
        "/admin/applications/app-1",
        headers={"X-Admin-Key": settings.admin_api_key},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["application"]["id"] == "app-1"
    assert body["profile"]["id"] == "u-1"
    assert body["latest_resume"]["id"] == "r-1"
