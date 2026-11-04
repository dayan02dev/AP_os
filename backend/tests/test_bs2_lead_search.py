"""Swarm2 — leadership list search. Asserts CORRECT behaviour (FAIL = bug)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.deps import get_current_user
from app.main import app
from app.routers import leadership as lead_mod
from app.services import admin_query, applications_query, industry_categories, stats

from tests.fixtures.fake_supabase import FakeSupabase

INT4_MAX = 2147483647


class _PgSB(FakeSupabase):
    """Fake that behaves like PostgREST for one thing: an or() filter holding
    `display_seq.eq.<n>` with n outside int4 makes Postgres raise 22003
    ('value out of range for type integer') -> PostgREST 400 -> execute() raises.
    It also records every or() filter string sent."""

    def __init__(self, tables):
        super().__init__(tables)
        self.or_filters: list[str] = []

    def table(self, name):
        q = super().table(name)
        outer = self

        def or_(flt, *_a, **_k):
            outer.or_filters.append(flt)
            for part in flt.split(","):
                if part.startswith("display_seq.eq."):
                    n = int(part.rsplit(".", 1)[1])
                    if n > INT4_MAX:
                        def boom():
                            raise RuntimeError(
                                "{'code': '22003', 'message': 'value \"%d\" is out of range for type integer'}" % n)
                        q.execute = boom
            # Keep the fake's own ilike-free semantics: match on email substring.
            needle = flt.split("basic_email.ilike.", 1)[1].split(",", 1)[0].strip('"%') if "basic_email.ilike." in flt else ""
            orig = q.execute
            if needle and getattr(orig, "__name__", "") != "boom":
                def ex():
                    res = orig()
                    res.data = [r for r in res.data if needle.lower() in (r.get("basic_email") or "").lower()]
                    return res
                q.execute = ex
            return q

        q.or_ = or_
        return q


@pytest.fixture
def lead_client(monkeypatch):
    from app.utils.rate_limit import limiter
    monkeypatch.setattr(limiter, "enabled", False)
    app.dependency_overrides[get_current_user] = lambda: {
        "user_id": "lead-1", "email": "l@x.io", "roles": ["leadership"]}
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_search_by_phone_number_email_finds_the_app(lead_client, monkeypatch):
    """Indian applicants often sign up as <10-digit-phone>@gmail.com. Searching
    '9876543210' (or pasting the e-mail's local part) makes search_seq_digits
    treat it as a display ID, so the or() gets `display_seq.eq.9876543210` —
    out of range for the INTEGER display_seq column. Postgres errors, the
    whole per-track query 400s, _query_track_table swallows it and returns []:
    the list says 'No applications match' although the email matches."""
    sb = _PgSB({
        "tir_applications": [
            {"id": "t1", "status": "evaluated", "display_seq": 26001,
             "basic_email": "9876543210@gmail.com", "basic_full_name": "Ravi"},
        ],
        "sip_applications": [],
        "ai_screening": [], "admin_decisions": [], "ic_documents": [],
        "reviews": [], "reviewer_assignments": [], "reviewer_profiles": [],
        "industry_categories": [],
    })
    for mod in (stats, applications_query, admin_query, lead_mod, industry_categories):
        monkeypatch.setattr(mod, "get_admin_client", lambda: sb)
    body = lead_client.get("/leadership/applications", params={"search": "9876543210"}).json()
    assert [a["id"] for a in body["applications"]] == ["t1"], (
        f"or() filters sent: {sb.or_filters}; got {body}")


def test_search_seq_digits_never_emits_out_of_range_int():
    """Unit form of the same bug: a digit search longer than int4 must not be
    pushed as an equality on the integer display_seq column."""
    d = applications_query.search_seq_digits("9876543210")
    assert d is None or int(d) <= INT4_MAX, d


def test_prefixed_display_id_only_returns_that_tracks_row(lead_client, monkeypatch):
    """S2-LEAD-19: TIR and VIP sequences overlap, so 'VIP-26255' must not return
    the TIR-26255 row. Prefix is read from the raw query before normalisation."""
    sb = _PgSB({
        "tir_applications": [{"id": "t1", "status": "evaluated", "display_seq": 26255,
                              "basic_email": "26255@x.io"}],
        "sip_applications": [{"id": "s1", "status": "evaluated", "display_seq": 26255,
                              "basic_email": "26255@x.io"}],
        "ai_screening": [], "admin_decisions": [], "ic_documents": [],
        "reviews": [], "reviewer_assignments": [], "reviewer_profiles": [],
        "industry_categories": [],
    })
    for mod in (stats, applications_query, admin_query, lead_mod, industry_categories):
        monkeypatch.setattr(mod, "get_admin_client", lambda: sb)
    body = lead_client.get("/leadership/applications", params={"search": "VIP-26255"}).json()
    assert [a["id"] for a in body["applications"]] == ["s1"]


def test_search_seq_track_and_query_only_targets_named_track(monkeypatch):
    assert applications_query.search_seq_track("VIP-26255") == "sip"
    assert applications_query.search_seq_track("tir 26255") == "tir"
    assert applications_query.search_seq_track("26255") is None
    sb = _PgSB({"tir_applications": [], "sip_applications": []})
    monkeypatch.setattr(applications_query, "get_admin_client", lambda: sb)
    applications_query._query_track_table("tir", search="VIP-26255")
    assert not any("display_seq.eq." in f for f in sb.or_filters)
    applications_query._query_track_table("sip", search="VIP-26255")
    assert any("display_seq.eq.26255" in f for f in sb.or_filters)
