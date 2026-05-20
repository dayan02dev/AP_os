"""Tests for the leadership read endpoints (Session 4 / Tasks 16 + 18).

Two tiers:
  - Unit tests (always run): pure helpers + router auth/capability gates
    via FastAPI dependency_overrides. No network.
  - Integration tests (gated by RUN_STAGING_TESTS=1): hit the deployed
    staging Lambda with real JWTs. Skipped unless tokens are exported.

Set these env vars to run the integration tier:
    RUN_STAGING_TESTS=1
    STAGING_LEADERSHIP_TOKEN=<jwt for a user with the leadership role>
    STAGING_REVIEWER_TOKEN=<jwt for a user with the reviewer role>
    STAGING_BASE_URL=https://cdw51c7gid.execute-api.ap-south-1.amazonaws.com
"""

from __future__ import annotations

import os

import httpx
import pytest

from app.deps import get_current_user
from app.main import app
from app.services import applications_query, stats
from app.services.stats import (
    ADVANCED_PAST_REVIEW,
    FUNNEL_BUCKETS,
    OTHER_BUCKET,
    PHASE_1_STATUSES,
    TRACKS,
    classify_industry,
)


# ─── Helper: dependency override for current user ────────────────────────


def _override_user(roles: list[str]):
    async def _override() -> dict:
        return {"user_id": "test-user", "email": "t@example.com", "roles": roles}
    return _override


@pytest.fixture
def _clear_overrides():
    """Always wipe `app.dependency_overrides` after a test so overrides don't
    leak between cases that share the module-scoped FastAPI app."""
    yield
    app.dependency_overrides.clear()


# ─── Unit tier: stats.classify_industry + module constants ───────────────


def test_classify_industry_robotics():
    assert classify_industry("Robotics startup") == ("robotics", "Robotics & Automation")


def test_classify_industry_health_medtech():
    assert classify_industry("MedTech for clinical trials") == (
        "health",
        "Healthcare / MedTech",
    )


def test_classify_industry_none_falls_back_to_other():
    assert classify_industry(None) == OTHER_BUCKET


def test_other_bucket_constant():
    assert OTHER_BUCKET == ("other", "Other / Frontier")


# ─── New: classify_industry over a row dict (multi-field) ───────────────


def test_classify_industry_dict_uses_solution_describe():
    """The classifier should read solution_describe — not just basic_org —
    so apps with sparse `basic_org` like 'IIT Bombay' still get a real
    industry assignment when the solution text carries the signal."""
    row = {
        "basic_org": "IIT Bombay",
        "solution_describe": "Wearable AFib detector for cardiac patients",
        "solution_core_tech": "",
        "problem_describe": "",
    }
    assert classify_industry(row) == ("health", "Healthcare / MedTech")


def test_classify_industry_dict_uses_core_tech():
    row = {
        "basic_org": "Stealth startup",
        "solution_describe": "Hardware platform for industrial use",
        "solution_core_tech": "MEMS gyroscope and accelerometer fusion",
        "problem_describe": "",
    }
    bucket_id, _label = classify_industry(row)
    assert bucket_id == "semi"


def test_classify_industry_dict_falls_back_to_other_when_all_empty():
    row = {
        "basic_org": None,
        "solution_describe": None,
        "solution_core_tech": None,
        "problem_describe": None,
    }
    assert classify_industry(row) == OTHER_BUCKET


def test_classify_industry_dict_health_keywords():
    """Healthcare bucket should match a wide range of medical terms."""
    cases = [
        "Microfluidic dengue test",
        "Diagnostic imaging for ICU patients",
        "Biotech vaccine pipeline",
        "Surgical robot for tumour resection",
    ]
    for text in cases:
        bucket, _ = classify_industry({"solution_describe": text})
        assert bucket == "health", f"expected health for {text!r}, got {bucket}"


def test_classify_industry_dict_defense_keywords():
    cases = [
        "Anti-jamming GNSS receiver for military use",
        "Satellite payload control system",
        "Launch vehicle telemetry",
    ]
    for text in cases:
        bucket, _ = classify_industry({"solution_describe": text})
        assert bucket == "defense", f"expected defense for {text!r}, got {bucket}"


def test_classify_industry_dict_ai_keywords():
    cases = [
        "Agentic ops copilot for MSME operations",
        "RAG stack for legal precedent search",
        "Foundation model for code completion",
    ]
    for text in cases:
        bucket, _ = classify_industry({"solution_describe": text})
        assert bucket == "ai", f"expected ai for {text!r}, got {bucket}"


# derive_stage_label / derive_project_name / compose_display_id moved to
# test_stats_helpers.py (they were rewritten per spec
# 2026-05-20-leadership-applications-table-redesign).


def test_classify_industry_empty_string_falls_back_to_other():
    assert classify_industry("") == OTHER_BUCKET


def test_classify_industry_unknown_text_falls_back_to_other():
    assert classify_industry("Something we don't recognize") == OTHER_BUCKET


def test_classify_industry_ai_keyword_matches_with_trailing_space():
    # The "ai " keyword has a trailing space, so it matches "ai foundation"
    # but won't accidentally pick up words like "rain" or "maid".
    assert classify_industry("AI foundation model lab") == (
        "ai",
        "Artificial Intelligence / Foundational Models",
    )


def test_classify_industry_is_case_insensitive():
    bucket_id, _label = classify_industry("DRONE SWARM CO")
    assert bucket_id == "robotics"


def test_phase_1_statuses_has_eleven_entries():
    assert len(PHASE_1_STATUSES) == 11


def test_funnel_buckets_in_review():
    assert FUNNEL_BUCKETS["in_review"] == ["ai_screening", "under_review"]


def test_funnel_buckets_advanced():
    assert FUNNEL_BUCKETS["advanced"] == ["shortlisted", "interview"]


def test_funnel_buckets_decided():
    assert FUNNEL_BUCKETS["decided"] == ["offered", "onboarded"]


def test_advanced_past_review_constant():
    assert ADVANCED_PAST_REVIEW == ["shortlisted", "interview", "offered", "onboarded"]


def test_tracks_constant():
    assert TRACKS == ["tir", "sip"]


# ─── Unit tier: applications_query helpers ───────────────────────────────


def test_track_table_tir():
    assert applications_query.track_table("tir") == "tir_applications"


def test_track_table_sip():
    assert applications_query.track_table("sip") == "sip_applications"


def test_track_table_rejects_unknown_track():
    with pytest.raises(ValueError):
        applications_query.track_table("xxx")


def test_fetch_ai_scores_for_empty_input_returns_empty_dict():
    assert applications_query.fetch_ai_scores_for([]) == {}


def test_list_columns_contains_expected_fields():
    cols = applications_query.LIST_COLUMNS
    assert isinstance(cols, str) and cols
    for expected in (
        "id",
        "status",
        "basic_full_name",
        "basic_email",
        "basic_org",
        "submitted_at",
        "created_at",
    ):
        assert expected in cols, f"LIST_COLUMNS missing {expected!r}"


# ─── Unit tier: router auth (401 on missing Bearer) ──────────────────────


def test_get_stats_without_auth_returns_401(client):
    res = client.get("/leadership/stats")
    assert res.status_code == 401


def test_list_applications_without_auth_returns_401(client):
    res = client.get("/leadership/applications")
    assert res.status_code == 401


def test_get_application_detail_without_auth_returns_401(client):
    # Any UUID-shaped string is fine — auth runs before the handler.
    res = client.get("/leadership/applications/00000000-0000-0000-0000-000000000000")
    assert res.status_code == 401


# ─── Unit tier: router capability gates (403 with reviewer-only role) ────


def test_get_stats_with_reviewer_only_returns_403(client, _clear_overrides):
    app.dependency_overrides[get_current_user] = _override_user(["reviewer"])
    res = client.get(
        "/leadership/stats",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 403
    body = res.json()
    assert body["detail"]["code"] == "missing_capability"
    assert body["detail"]["required"] == "view_stats"


def test_list_applications_with_reviewer_only_returns_403(client, _clear_overrides):
    app.dependency_overrides[get_current_user] = _override_user(["reviewer"])
    res = client.get(
        "/leadership/applications",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 403
    body = res.json()
    assert body["detail"]["code"] == "missing_capability"
    assert body["detail"]["required"] == "view_all_apps"


def test_get_application_detail_with_reviewer_only_returns_403(
    client, _clear_overrides,
):
    app.dependency_overrides[get_current_user] = _override_user(["reviewer"])
    res = client.get(
        "/leadership/applications/00000000-0000-0000-0000-000000000000",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 403
    body = res.json()
    assert body["detail"]["code"] == "missing_capability"
    assert body["detail"]["required"] == "view_app_detail"


# ─── Unit tier: /industry-categories endpoint (added 2026-05-20) ─────────


def test_industry_categories_endpoint_shape(client, _clear_overrides, monkeypatch):
    """GET /leadership/industry-categories returns categories + cap + slots."""
    from app.services import industry_categories as ic_mod

    monkeypatch.setattr(
        ic_mod,
        "categories_with_counts",
        lambda: {
            "categories": [
                {"id": "robotics", "label": "Robotics & Automation", "count": 3},
                {"id": "ai", "label": "AI", "count": 2},
            ],
            "total": 5,
            "cap": 12,
            "remaining_slots": 5,
        },
    )
    app.dependency_overrides[get_current_user] = _override_user(["leadership"])

    res = client.get(
        "/leadership/industry-categories",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["cap"] == 12
    assert body["total"] == 5
    assert body["remaining_slots"] == 5
    assert body["categories"][0]["id"] == "robotics"
    assert body["categories"][0]["count"] == 3


def test_industry_categories_requires_view_stats_capability(client, _clear_overrides):
    """Reviewer-only role must be rejected with 403."""
    app.dependency_overrides[get_current_user] = _override_user(["reviewer"])
    res = client.get(
        "/leadership/industry-categories",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 403


def test_list_applications_row_has_new_shape(client, _clear_overrides, monkeypatch):
    """Row shape per spec §6a: display_id, display_seq, founder, industry,
    stage, project_name."""
    fake_rows = [
        {
            "id": "aaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "track": "tir",
            "status": "submitted",
            "basic_full_name": "Devika Shetty",
            "basic_org": "Anna University",
            "basic_email": "d@example.com",
            "submitted_at": "2026-05-12T08:14:00Z",
            "created_at": "2026-05-10T11:00:00Z",
            "solution_describe": (
                "ESD-safe wearable for shop-floor technicians. Long tail."
            ),
            "solution_stage": "Lab demos / proof of concept",
            "display_seq": 26013,
        }
    ]

    def _fake_fetch(track, **kw):
        if track == "tir":
            return [dict(r) for r in fake_rows]
        return []

    monkeypatch.setattr(applications_query, "fetch_apps_for_track", _fake_fetch)
    monkeypatch.setattr(
        applications_query,
        "fetch_ai_scores_for",
        lambda pairs: {p: 7.8 for p in pairs},
    )
    monkeypatch.setattr(
        applications_query,
        "fetch_industry_for_pairs",
        lambda pairs: {
            p: {"id": "industry", "label": "Advanced Manufacturing"} for p in pairs
        },
    )

    app.dependency_overrides[get_current_user] = _override_user(["leadership"])

    res = client.get(
        "/leadership/applications?track=tir",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 200
    body = res.json()
    apps = body["applications"]
    assert len(apps) == 1
    a = apps[0]
    assert a["display_id"] == "TIR-26013"
    assert a["display_seq"] == 26013
    assert a["founder"] == {"name": "Devika Shetty", "affiliation": "Anna University"}
    assert a["industry"] == {"id": "industry", "label": "Advanced Manufacturing"}
    assert a["stage"]["label"] == "Lab demo"
    assert a["stage"]["raw"] == "Lab demos / proof of concept"
    assert a["ai_score_overall"] == 7.8
    assert a["project_name"].startswith("ESD-safe")


def test_list_applications_industry_filter_matches_category_id(
    client, _clear_overrides, monkeypatch
):
    """The ?industry=<id> filter must match the new industry_category_id,
    not the legacy keyword bucket."""
    fake_rows = [
        {
            "id": "id-1",
            "track": "tir",
            "status": "submitted",
            "basic_full_name": "A",
            "submitted_at": "2026-05-12T08:00:00Z",
            "created_at": "2026-05-10T11:00:00Z",
            "display_seq": 26001,
        },
        {
            "id": "id-2",
            "track": "tir",
            "status": "submitted",
            "basic_full_name": "B",
            "submitted_at": "2026-05-12T09:00:00Z",
            "created_at": "2026-05-10T11:00:00Z",
            "display_seq": 26002,
        },
    ]

    def _fake_fetch(track, **kw):
        if track == "tir":
            return [dict(r) for r in fake_rows]
        return []

    monkeypatch.setattr(applications_query, "fetch_apps_for_track", _fake_fetch)
    monkeypatch.setattr(
        applications_query, "fetch_ai_scores_for", lambda pairs: {p: 5.0 for p in pairs}
    )
    monkeypatch.setattr(
        applications_query,
        "fetch_industry_for_pairs",
        lambda pairs: {
            ("tir", "id-1"): {"id": "robotics", "label": "Robotics & Automation"},
            ("tir", "id-2"): {"id": "ai", "label": "Artificial Intelligence"},
        },
    )

    app.dependency_overrides[get_current_user] = _override_user(["leadership"])
    res = client.get(
        "/leadership/applications?industry=robotics&track=tir",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 200
    apps = res.json()["applications"]
    assert len(apps) == 1
    assert apps[0]["id"] == "id-1"


# ─── Integration tier (skipped unless RUN_STAGING_TESTS=1) ───────────────
#
# Fixtures here are LOCAL to this module — conftest.py does not (yet) define
# staging_* fixtures; the broader vertical-slice smoke test in a later task
# will hoist them. Keeping them local means this file is self-contained.

_staging_skip = pytest.mark.skipif(
    not os.getenv("RUN_STAGING_TESTS"),
    reason="set RUN_STAGING_TESTS=1 to enable",
)

_DEFAULT_STAGING_BASE_URL = "https://cdw51c7gid.execute-api.ap-south-1.amazonaws.com"


@pytest.fixture
def staging_base_url() -> str:
    return os.getenv("STAGING_BASE_URL", _DEFAULT_STAGING_BASE_URL)


@pytest.fixture
def staging_leadership_token() -> str:
    tok = os.getenv("STAGING_LEADERSHIP_TOKEN")
    if not tok:
        pytest.skip("STAGING_LEADERSHIP_TOKEN not set; skipping integration test")
    return tok


@pytest.fixture
def staging_reviewer_token() -> str:
    tok = os.getenv("STAGING_REVIEWER_TOKEN")
    if not tok:
        pytest.skip("STAGING_REVIEWER_TOKEN not set; skipping integration test")
    return tok


class TestLeadershipStagingIntegration:
    """Real-network smoke tests against the staging Lambda.

    Gated module-level via RUN_STAGING_TESTS=1 and per-fixture via the JWT
    env vars. With neither set, this whole class is skipped — no outbound
    HTTP happens during `pytest -k "not staging"` runs.
    """

    @_staging_skip
    def test_stats_as_leadership_returns_200_with_expected_shape(
        self, staging_leadership_token, staging_base_url,
    ):

        r = httpx.get(
            f"{staging_base_url}/leadership/stats",
            headers={"Authorization": f"Bearer {staging_leadership_token}"},
            timeout=30.0,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        for key in ("totals", "funnel", "status_counts", "industry"):
            assert key in body, f"missing key {key!r} in stats response"

    @_staging_skip
    def test_stats_as_reviewer_returns_403(
        self, staging_reviewer_token, staging_base_url,
    ):

        r = httpx.get(
            f"{staging_base_url}/leadership/stats",
            headers={"Authorization": f"Bearer {staging_reviewer_token}"},
            timeout=30.0,
        )
        assert r.status_code == 403, r.text
        assert r.json()["detail"]["code"] == "missing_capability"

    @_staging_skip
    def test_applications_list_as_leadership_returns_200_with_expected_shape(
        self, staging_leadership_token, staging_base_url,
    ):

        r = httpx.get(
            f"{staging_base_url}/leadership/applications",
            headers={"Authorization": f"Bearer {staging_leadership_token}"},
            timeout=30.0,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        for key in ("applications", "total", "limit", "offset"):
            assert key in body, f"missing key {key!r} in applications list response"
        assert isinstance(body["applications"], list)

    @_staging_skip
    def test_applications_list_as_reviewer_returns_403(
        self, staging_reviewer_token, staging_base_url,
    ):

        r = httpx.get(
            f"{staging_base_url}/leadership/applications",
            headers={"Authorization": f"Bearer {staging_reviewer_token}"},
            timeout=30.0,
        )
        assert r.status_code == 403, r.text
        assert r.json()["detail"]["code"] == "missing_capability"

    @_staging_skip
    def test_applications_list_track_filter(
        self, staging_leadership_token, staging_base_url,
    ):

        r = httpx.get(
            f"{staging_base_url}/leadership/applications",
            params={"track": "tir", "limit": 5},
            headers={"Authorization": f"Bearer {staging_leadership_token}"},
            timeout=30.0,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        for row in body["applications"]:
            assert row["track"] == "tir", row

    @_staging_skip
    def test_applications_list_pagination_limit(
        self, staging_leadership_token, staging_base_url,
    ):

        r = httpx.get(
            f"{staging_base_url}/leadership/applications",
            params={"limit": 2, "offset": 0},
            headers={"Authorization": f"Bearer {staging_leadership_token}"},
            timeout=30.0,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert len(body["applications"]) <= 2

    @_staging_skip
    def test_application_detail_as_leadership(
        self, staging_leadership_token, staging_base_url,
    ):
        """Fetch the first id from the list query, then ask for its detail.

        If the staging corpus has zero applications we skip cleanly rather
        than failing — this test is a happy-path shape check, not a content
        assertion.
        """

        list_r = httpx.get(
            f"{staging_base_url}/leadership/applications",
            params={"limit": 1, "offset": 0},
            headers={"Authorization": f"Bearer {staging_leadership_token}"},
            timeout=30.0,
        )
        assert list_r.status_code == 200, list_r.text
        apps = list_r.json().get("applications", [])
        if not apps:
            pytest.skip("staging has no applications; nothing to fetch detail for")

        app_id = apps[0]["id"]
        r = httpx.get(
            f"{staging_base_url}/leadership/applications/{app_id}",
            headers={"Authorization": f"Bearer {staging_leadership_token}"},
            timeout=30.0,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        for key in ("id", "track", "application"):
            assert key in body, f"missing key {key!r} in application detail response"
        assert body["id"] == app_id

    @_staging_skip
    def test_application_detail_as_reviewer_returns_403(
        self, staging_reviewer_token, staging_base_url,
    ):

        # Any UUID-shaped string works — capability check fires before the
        # handler so we never need a real row id here.
        r = httpx.get(
            f"{staging_base_url}/leadership/applications/00000000-0000-0000-0000-000000000000",
            headers={"Authorization": f"Bearer {staging_reviewer_token}"},
            timeout=30.0,
        )
        assert r.status_code == 403, r.text
        assert r.json()["detail"]["code"] == "missing_capability"
