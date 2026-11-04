"""SWARM2 admin_pipeline — backend repros (Applications / Rejected tabs, batches,
/stats, applications_query search) at 837ccf0.

Each test asserts the CORRECT behaviour, so it FAILS while the bug is present.
"""
from __future__ import annotations

import pytest

from app.deps import get_current_user
from app.main import app
from app.routers import admin_platform as ap
from app.services import admin_query, applications_query, audit, stats
from tests.fixtures.fake_supabase import FakeSupabase, _Query


def _admin():
    return {"user_id": "admin-1", "email": "admin@x.com", "roles": ["admin"]}


def _leader():
    return {"user_id": "lead-1", "email": "lead@x.com", "roles": ["leadership"]}


def _install(monkeypatch, tables, sb=None, user=_admin):
    sb = sb or FakeSupabase(tables)
    for mod in (admin_query, applications_query, stats, audit, ap):
        monkeypatch.setattr(mod, "get_admin_client", lambda: sb, raising=False)
    app.dependency_overrides[get_current_user] = user
    return sb


@pytest.fixture(autouse=True)
def _clear():
    yield
    app.dependency_overrides.clear()


def _app(id_, status, seq=27000, **kw):
    return {"id": id_, "status": status, "display_seq": seq, "basic_full_name": f"Founder {id_}",
            "basic_email": f"{id_.lower()}@x.io", "basic_org": "Acme",
            "submitted_at": "2026-06-01T00:00:00Z", **kw}


# ─── 1. fetch_pipeline puts rows WITHOUT submitted_at FIRST (comment: "NULLs last") ──


def test_pipeline_default_order_puts_undated_rows_last(monkeypatch):
    """admin_query.fetch_pipeline sorts with key (0, submitted_at) / (1, "") and
    reverse=True, so (1, "") — the undated row — sorts BEFORE every dated row.
    The comment (and the leadership list it claims to match) say NULLs last.
    The admin Applications tab renders this server order when no column sort
    is chosen, so undated rows sit on top of the list."""
    _install(monkeypatch, {
        "tir_applications": [
            _app("DATED", "submitted", seq=27001),
            _app("UNDATED", "submitted", seq=27002, submitted_at=None),
        ],
        "sip_applications": [],
    })
    ids = [r["id"] for r in admin_query.fetch_pipeline({})["applications"]]
    assert ids == ["DATED", "UNDATED"]


# ─── 2. Leadership can hide/archive apps from the ADMIN pipeline ─────────────


# ─── 3. Numeric search larger than int4 empties BOTH tracks ─────────────────


class _PgQuery(_Query):
    """Fake that mimics Postgres: comparing the INTEGER display_seq column with
    a literal beyond int4 range raises 22003 (PostgREST -> 400 -> APIError)."""

    def or_(self, filt, *_a, **_k):
        self._or = filt
        return self

    def execute(self):
        f = getattr(self, "_or", "") or ""
        for part in f.split(","):
            if part.startswith("display_seq.eq."):
                if int(part.split(".")[-1]) > 2_147_483_647:
                    raise RuntimeError('22003: value "%s" is out of range for type integer'
                                       % part.split(".")[-1])
        if f and self._mode == "select" and self._name.endswith("_applications"):
            needle = f.split("ilike.")[1].split(",")[0].strip('"').strip("%").lower()
            res = super().execute()
            res.data = [r for r in res.data if needle in (r.get("basic_email") or "").lower()
                        or needle in (r.get("basic_full_name") or "").lower()]
            return res
        return super().execute()


class _PgFake(FakeSupabase):
    def table(self, name):
        return _PgQuery(self.tables, name)


def test_phone_number_search_finds_phone_number_email(monkeypatch):
    """search_seq_digits('9876543210') returns the digits, so _query_track_table
    adds `display_seq.eq.9876543210` to the or(). display_seq is `integer`
    (migration 017), Postgres rejects the out-of-range literal, PostgREST
    400s, the broad `except` returns [] — both tracks come back EMPTY. An
    applicant whose login email is their phone number (common) cannot be
    found by it on the admin /applications?search= and leadership lists."""
    sb = _PgFake({
        "tir_applications": [_app("P1", "submitted", basic_email="9876543210@gmail.com")],
        "sip_applications": [],
        "ai_screening": [],
    })
    _install(monkeypatch, {}, sb=sb)
    rows = applications_query.fetch_apps_for_track("tir", search="9876543210")
    assert [r["id"] for r in rows] == ["P1"]


# ─── 4. Exact prefixed display-ID search still returns the other track (NS-7) ─


def test_vip_prefixed_search_does_not_return_tir_row(monkeypatch):
    _install(monkeypatch, {
        "tir_applications": [_app("T1", "submitted", seq=26255)],
        "sip_applications": [_app("S1", "submitted", seq=26255)],
        "ai_screening": [],
    })
    ids = sorted(r["id"] for r in admin_query.fetch_pipeline({"search": "VIP-26255"})["applications"])
    assert ids == ["S1"]


# ─── 5. A failing track query is silent (ADMPIPE-10) ─────────────────────────


def test_pipeline_track_failure_is_not_silent(monkeypatch):
    sb = FakeSupabase({"tir_applications": [_app("T1", "submitted")], "sip_applications": []})
    real_table = sb.table

    def table(name):
        if name == "sip_applications":
            raise RuntimeError("PostgREST 500")
        return real_table(name)

    sb.table = table
    _install(monkeypatch, {}, sb=sb)
    try:
        out = admin_query.fetch_pipeline({})
    except Exception:
        return  # surfacing the failure is acceptable
    # Correct: the response must flag the missing track rather than look complete.
    assert out.get("partial") or out.get("errors"), out


# ─── 6. Hidden apps: list excludes them, badges count them (ADMPIPE-19) ──────


# ─── 7. 'Unassigned' reports batch LINKS removed as applications removed ─────


def test_unassign_removed_counts_applications_not_links(monkeypatch, client):
    """POST /batches/unassign returns removed = number of application_batches
    rows deleted. With multi-batch (mig 034) one app in 2 batches reports
    removed=2; AdminPipeline prints 'Removed 2 from their batch' for 1 app."""
    _install(monkeypatch, {
        "tir_applications": [_app("A1", "under_review")],
        "sip_applications": [],
        "application_batches": [
            {"id": "l1", "application_id": "A1", "application_track": "tir", "batch_id": "b1"},
            {"id": "l2", "application_id": "A1", "application_track": "tir", "batch_id": "b2"},
        ],
        "reviewer_assignments": [],
    })
    r = client.post("/admin/platform/batches/unassign",
                    json={"items": [{"track": "tir", "application_id": "A1"}]})
    assert r.status_code == 200
    assert r.json()["removed"] == 1, r.json()
