"""GET /admin/users — roles survive the PostgREST 1000-row cap (ADM-04) and
the list reports the real total with limit/offset paging (ADM-23)."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.deps import get_current_user
from app.main import app
from app.routers import admin_users as admin_users_router
from tests.fixtures.fake_supabase import FakeSupabase, _Query

_CAP = 1000


class _CappedQuery(_Query):
    """FakeSupabase query that behaves like PostgREST: every select returns at
    most 1000 rows, honours .range(), and supports count='exact'."""

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._range = None
        self._count_exact = False
        self._order_desc = None

    def select(self, *_a, **k):
        self._count_exact = k.get("count") == "exact"
        return self

    def range(self, start, end):
        self._range = (start, end)
        return self

    def order(self, col, desc=False):
        self._order_desc = (col, desc)
        return self

    def execute(self):
        if self._mode != "select":
            return super().execute()
        data = [r for r in self._rows if self._match(r)]
        total = len(data)
        if self._order_desc:
            col, desc = self._order_desc
            data.sort(key=lambda r: r.get(col) or "", reverse=desc)
        if self._range:
            data = data[self._range[0]: self._range[1] + 1]
        if self._limit is not None:
            data = data[: self._limit]
        data = data[:_CAP]
        return SimpleNamespace(data=data, count=total if self._count_exact else None)


class _CappedFake(FakeSupabase):
    def table(self, name):
        return _CappedQuery(self.tables, name)


def _profiles(n):
    return [
        {"id": f"u-{i:04d}", "email": f"user{i}@x.com", "full_name": f"User {i}",
         "phone": None, "location_city": None, "active_role": None,
         "created_at": f"2026-01-01T00:{i // 60:02d}:{i % 60:02d}Z"}
        for i in range(n)
    ]


@pytest.fixture
def capped(monkeypatch):
    profs = _profiles(1250)
    # Applicant role for everyone FIRST (1250 rows), staff roles granted later —
    # an unpaginated user_roles read loses every staff role past row 1000.
    roles = [{"user_id": p["id"], "role": "applicant", "granted_at": "2026-01-01"}
             for p in profs]
    roles += [
        {"user_id": "u-1249", "role": "admin", "granted_at": "2026-06-01"},
        {"user_id": "u-1248", "role": "reviewer", "granted_at": "2026-06-01"},
        {"user_id": "u-0003", "role": "reviewer", "granted_at": "2026-06-01"},
    ]
    fake = _CappedFake({"profiles": profs, "user_roles": roles})
    monkeypatch.setattr(admin_users_router, "get_admin_client", lambda: fake)
    app.dependency_overrides[get_current_user] = lambda: {
        "user_id": "u-admin", "email": "a@x.com", "roles": ["admin"]}
    yield fake
    app.dependency_overrides.clear()


def _get(client, qs=""):
    res = client.get(f"/admin/users{qs}", headers={"Authorization": "Bearer t"})
    assert res.status_code == 200, res.text
    return res.json()


def test_roles_not_lost_past_1000_user_roles_rows(client, capped):
    body = _get(client)
    by_id = {u["id"]: u for u in body["users"]}
    assert sorted(by_id["u-1249"]["roles"]) == ["admin", "applicant"]
    assert sorted(by_id["u-1248"]["roles"]) == ["applicant", "reviewer"]


def test_total_is_exact_profile_count_not_page_size(client, capped):
    body = _get(client, "?limit=200")
    assert len(body["users"]) == 200
    assert body["total"] == 1250


def test_offset_pages_through_profiles(client, capped):
    first = _get(client, "?limit=200&offset=0")["users"]
    second = _get(client, "?limit=200&offset=200")["users"]
    assert not {u["id"] for u in first} & {u["id"] for u in second}
    assert second[0]["id"] == "u-1049"  # newest-first ordering continues


def test_role_filter_sees_roles_past_1000_rows(client, capped):
    body = _get(client, "?role=reviewer")
    assert body["total"] == 2
    assert {u["id"] for u in body["users"]} == {"u-1248", "u-0003"}


def test_search_with_comma_and_parens_does_not_crash(client, capped):
    body = _get(client, "?search=a,b(c)")
    assert "users" in body


def test_role_counts_are_global_distinct_users_per_role(client, capped):
    """The User Roles tiles read these — every account, not the loaded page,
    and past the 1000-row cap."""
    body = _get(client, "?limit=200")
    assert body["role_counts"] == {"applicant": 1250, "admin": 1, "reviewer": 2}
