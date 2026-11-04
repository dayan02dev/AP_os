"""Swarm2 — /leadership/industry-categories. Asserts CORRECT behaviour (FAIL = bug).

Uses a PostgREST-faithful fake (1000-row max_rows cap, range/neq honoured)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.deps import get_current_user
from app.main import app
from app.routers import leadership as lead_mod
from app.services import admin_query, applications_query, industry_categories, stats

from tests.fixtures.capped_fake import CappedFakeSupabase


@pytest.fixture
def lead_client(monkeypatch):
    from app.utils.rate_limit import limiter
    monkeypatch.setattr(limiter, "enabled", False)
    app.dependency_overrides[get_current_user] = lambda: {
        "user_id": "lead-1", "email": "l@x.io", "roles": ["leadership"]}
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_nonseed_category_past_raw_cap_is_not_reported_as_unclassified(lead_client, monkeypatch):
    """categories_with_counts decides which NON-seed categories are visible from a
    single unpaged ai_screening read (.limit(50_000) -> capped at 1000 rows). The
    endpoint then recounts only the VISIBLE categories over the list rows, so an
    app in a non-seed category that fell outside the first 1000 raw rows is
    dropped from every chip AND pushed into 'Unclassified' — yet the list's
    industry=unclassified filter (correctly) does not return it."""
    tir, ai = [], []
    for i in range(1000):
        aid = f"t{i:05d}"
        tir.append({"id": aid, "status": "evaluated", "display_seq": 26001 + i})
        ai.append({"application_id": aid, "application_track": "tir",
                   "industry_category_id": "rob", "score_overall": 6.0})
    tir.append({"id": "space-1", "status": "evaluated", "display_seq": 28000})
    ai.append({"application_id": "space-1", "application_track": "tir",
               "industry_category_id": "space", "score_overall": 6.0})
    sb = CappedFakeSupabase({
        "tir_applications": tir, "sip_applications": [], "ai_screening": ai,
        "industry_categories": [
            {"id": "rob", "label": "Robotics", "is_seed": True},
            {"id": "space", "label": "Space tech", "is_seed": False},
        ],
        "admin_decisions": [], "ic_documents": [], "reviews": [],
        "reviewer_assignments": [], "reviewer_profiles": [],
    })
    for mod in (stats, applications_query, admin_query, lead_mod, industry_categories):
        monkeypatch.setattr(mod, "get_admin_client", lambda: sb)

    body = lead_client.get("/leadership/industry-categories").json()
    ids = {c["id"]: c["count"] for c in body["categories"]}
    unc = body["unclassified"]["count"]
    lst = lead_client.get("/leadership/applications",
                          params={"industry": "unclassified", "limit": 200}).json()
    assert ids.get("space") == 1 and unc == lst["total"] == 0, (
        f"chips={ids} unclassified={unc} but industry=unclassified lists {lst['total']} rows")
