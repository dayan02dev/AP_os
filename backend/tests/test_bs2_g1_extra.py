"""bs2-g1 extra repros: ordering of paged reads, flags chunking, calibration order."""
from __future__ import annotations

from app.services import admin_query, applications_query, reviewer_query, stats

from tests.fixtures.capped_fake import CappedFakeSupabase


class _Spy:
    """Records (table, orders) for every select so ordering can be asserted."""

    def __init__(self, sb):
        self.sb = sb
        self.orders: dict[str, list[str]] = {}

    def table(self, name):
        q = self.sb.table(name)
        orig = q.order
        spy = self

        def order(col, *a, **k):
            spy.orders.setdefault(name, []).append(col)
            return orig(col, *a, **k)

        q.order = order
        return q


def _install(monkeypatch, sb):
    for mod in (admin_query, applications_query, reviewer_query, stats):
        monkeypatch.setattr(mod, "get_admin_client", lambda: sb, raising=False)


def test_review_stats_pages_are_ordered(monkeypatch):
    """S2-ADM-75 / LEAD-03 / SH-23: reviews and assignments are paged ORDER BY id."""
    spy = _Spy(CappedFakeSupabase({"reviews": [], "reviewer_assignments": [],
                                   "reviewer_profiles": []}))
    _install(monkeypatch, spy)
    admin_query._fetch_review_stats([("tir", "a")])
    assert "id" in spy.orders["reviews"] and "id" in spy.orders["reviewer_assignments"]


def test_flags_read_is_chunked_so_url_stays_short(monkeypatch):
    """S2-ADM-21: one .in_() over every id is chunked."""
    apps = [{"id": f"t{i:04d}", "status": "evaluated", "display_seq": 26001 + i,
             "submitted_at": "2026-06-01T00:00:00Z"} for i in range(400)]
    sb = CappedFakeSupabase({"tir_applications": apps, "sip_applications": [],
                             "reviews": [], "reviewer_assignments": []})
    sizes: list[int] = []
    real = sb.table

    def table(name):
        q = real(name)
        if name == "reviews":
            orig = q.in_

            def in_(col, vals):
                if col == "application_id":
                    sizes.append(len(vals))
                return orig(col, vals)

            q.in_ = in_
        return q

    monkeypatch.setattr(sb, "table", table)
    _install(monkeypatch, sb)
    admin_query.fetch_pipeline({})
    assert sizes and max(sizes) <= 150


def test_reviews_read_failure_raises_not_zero(monkeypatch):
    """S2-SH-11 service-level: no silent {}."""
    import pytest
    from fastapi import HTTPException
    sb = CappedFakeSupabase({"reviews": [], "reviewer_assignments": []})
    real = sb.table

    def table(name):
        if name == "reviews":
            raise RuntimeError("503")
        return real(name)

    monkeypatch.setattr(sb, "table", table)
    _install(monkeypatch, sb)
    with pytest.raises(HTTPException) as ei:
        admin_query._fetch_review_stats([("tir", "a")])
    assert ei.value.status_code == 503
