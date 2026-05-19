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


# ─── Stage label, project name, display id derivations ─────────────────


def test_derive_stage_label_sip_traction():
    from app.services.stats import derive_stage_label
    row = {"sip_traction": "Active pilots (paid or unpaid) with design partners"}
    assert derive_stage_label(row) == "Pilot"


def test_derive_stage_label_sip_trl_fallback():
    from app.services.stats import derive_stage_label
    row = {"sip_traction": None, "sip_trl": "TRL 5 — pilot-tested in a relevant environment"}
    assert derive_stage_label(row) == "Pilot"


def test_derive_stage_label_tir_solution_stage_truncates():
    from app.services.stats import derive_stage_label
    row = {"solution_stage": "We're somewhere between prototype and pilot"}
    out = derive_stage_label(row)
    assert out is not None
    assert len(out) <= 17  # 16 chars + ellipsis


def test_derive_stage_label_none_when_no_data():
    from app.services.stats import derive_stage_label
    assert derive_stage_label({}) is None
    assert derive_stage_label(None) is None


def test_derive_project_name_first_sentence():
    from app.services.stats import derive_project_name
    row = {"solution_describe": "Microfluidic dengue test. Designed to detect..."}
    assert derive_project_name(row) == "Microfluidic dengue test"


def test_derive_project_name_falls_back_to_basic_org():
    from app.services.stats import derive_project_name
    assert derive_project_name({"basic_org": "IIT Bombay"}) == "IIT Bombay"
    assert derive_project_name({"solution_describe": "", "basic_org": "NIT"}) == "NIT"


def test_derive_project_name_none_when_no_data():
    from app.services.stats import derive_project_name
    assert derive_project_name({}) is None
    assert derive_project_name(None) is None


def test_compose_display_id_deterministic():
    from app.services.stats import compose_display_id
    uuid = "e6045bda-1234-5678-9abc-deadbeef1234"
    out = compose_display_id("tir", uuid)
    assert out.startswith("TIR-")
    assert len(out) == 9  # TIR-NNNNN
    assert out == compose_display_id("tir", uuid)  # idempotent


def test_compose_display_id_handles_missing():
    from app.services.stats import compose_display_id
    assert compose_display_id("sip", None) == "SIP-?????"
    assert compose_display_id("sip", "") == "SIP-?????"


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
