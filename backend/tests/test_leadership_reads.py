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


def test_phase_1_statuses_has_twelve_entries():
    assert len(PHASE_1_STATUSES) == 12


def test_phase_1_statuses_includes_jury_review():
    ids = [s for s, _ in PHASE_1_STATUSES]
    assert "jury_review" in ids


def test_funnel_buckets_in_review():
    assert FUNNEL_BUCKETS["in_review"] == ["ai_screening", "under_review"]


def test_funnel_buckets_advanced():
    assert FUNNEL_BUCKETS["advanced"] == ["shortlisted", "interview", "jury_review"]


def test_funnel_buckets_decided():
    assert FUNNEL_BUCKETS["decided"] == ["offered", "onboarded"]


def test_advanced_past_review_constant():
    assert ADVANCED_PAST_REVIEW == ["shortlisted", "interview", "jury_review", "offered", "onboarded"]


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


# ─── Unit tier: enrich_reviewers (name + timestamp-derived status) ───────


class _FakeProfilesQuery:
    def __init__(self, rows):
        self._rows = rows

    def select(self, *_a, **_k):
        return self

    def in_(self, *_a, **_k):
        return self

    def execute(self):
        class _R:
            data = self._rows
        return _R()


class _FakeProfilesClient:
    def __init__(self, rows):
        self._rows = rows

    def table(self, _name):
        return _FakeProfilesQuery(self._rows)


def _stub_profiles(monkeypatch, rows):
    monkeypatch.setattr(
        applications_query, "get_admin_client", lambda: _FakeProfilesClient(rows),
    )


def test_enrich_reviewers_resolves_name_and_evaluated_via_completed_at(monkeypatch):
    _stub_profiles(monkeypatch, [
        {"id": "uid-1", "full_name": "Manish S Shetty", "email": "manish@x.com"},
    ])
    assignments = [{"reviewer_user_id": "uid-1", "completed_at": "2026-06-27T00:00:00Z",
                    "declined_at": None, "state": "pending"}]
    reviews = []
    a, _ = applications_query.enrich_reviewers(assignments, reviews)
    assert a[0]["reviewer_name"] == "Manish S Shetty"
    assert a[0]["reviewer_email"] == "manish@x.com"
    assert a[0]["reviewer_status"] == "evaluated"


def test_enrich_reviewers_evaluated_via_submitted_review_without_completed_at(monkeypatch):
    _stub_profiles(monkeypatch, [
        {"id": "uid-2", "full_name": None, "email": "rev@x.com"},
    ])
    assignments = [{"reviewer_user_id": "uid-2", "completed_at": None,
                    "declined_at": None, "state": "pending"}]
    reviews = [{"reviewer_user_id": "uid-2", "submitted_at": "2026-06-27T00:00:00Z"}]
    a, r = applications_query.enrich_reviewers(assignments, reviews)
    # full_name missing → email fallback.
    assert a[0]["reviewer_name"] == "rev@x.com"
    assert a[0]["reviewer_status"] == "evaluated"
    assert r[0]["reviewer_name"] == "rev@x.com"


def test_enrich_reviewers_pending_and_declined_and_uid_fallback(monkeypatch):
    # No profile rows → name falls back to short UID; draft review doesn't count.
    _stub_profiles(monkeypatch, [])
    assignments = [
        {"reviewer_user_id": "abcdef12-0000", "completed_at": None,
         "declined_at": None, "state": "pending"},
        {"reviewer_user_id": "deadbeef-1111", "completed_at": None,
         "declined_at": "2026-06-27T00:00:00Z", "state": "pending"},
    ]
    reviews = [{"reviewer_user_id": "abcdef12-0000", "submitted_at": None}]
    a, _ = applications_query.enrich_reviewers(assignments, reviews)
    assert a[0]["reviewer_name"] == "abcdef12"          # uid[:8] fallback
    assert a[0]["reviewer_status"] == "pending"          # draft review ≠ evaluated
    assert a[1]["reviewer_status"] == "declined"


def test_enrich_reviewers_never_raises_on_profiles_failure(monkeypatch):
    class _Boom:
        def table(self, _n):
            raise RuntimeError("db down")
    monkeypatch.setattr(applications_query, "get_admin_client", lambda: _Boom())
    assignments = [{"reviewer_user_id": "uid-9", "completed_at": None,
                    "declined_at": None}]
    a, _ = applications_query.enrich_reviewers(assignments, [])
    assert a[0]["reviewer_name"] == "uid-9"[:8]
    assert a[0]["reviewer_status"] == "pending"


# ─── Unit tier: fetch_app_ids_by_project_name (search-by-project) ────────


class _FakeAiQuery:
    def __init__(self, rows, capture):
        self._rows = rows
        self._cap = capture
    def select(self, *_a, **_k): return self
    def eq(self, k, v): self._cap.setdefault("eq", {})[k] = v; return self
    def ilike(self, k, patt): self._cap["ilike"] = (k, patt); return self
    def limit(self, n): self._cap["limit"] = n; return self
    def execute(self):
        class _R: data = self._rows
        return _R()


class _FakeAiClient:
    def __init__(self, rows, capture):
        self._rows = rows; self._cap = capture
    def table(self, name):
        self._cap["table"] = name
        return _FakeAiQuery(self._rows, self._cap)


def test_fetch_app_ids_by_project_name_matches(monkeypatch):
    cap = {}
    rows = [{"application_id": "a1"}, {"application_id": "a2"}, {"application_id": None}]
    monkeypatch.setattr(applications_query, "get_admin_client", lambda: _FakeAiClient(rows, cap))
    ids = applications_query.fetch_app_ids_by_project_name("tir", "cognitive")
    assert ids == ["a1", "a2"]            # drops the null id
    assert cap["table"] == "ai_screening"
    assert cap["eq"]["application_track"] == "tir"
    assert cap["ilike"] == ("project_name", "%cognitive%")


def test_fetch_app_ids_by_project_name_blank_needle_returns_empty(monkeypatch):
    # Must not even hit the DB for an empty needle.
    def _boom(): raise AssertionError("should not query")
    monkeypatch.setattr(applications_query, "get_admin_client", _boom)
    assert applications_query.fetch_app_ids_by_project_name("tir", "   ") == []


def test_fetch_app_ids_by_project_name_never_raises(monkeypatch):
    class _Boom:
        def table(self, _n): raise RuntimeError("db down")
    monkeypatch.setattr(applications_query, "get_admin_client", lambda: _Boom())
    assert applications_query.fetch_app_ids_by_project_name("sip", "x") == []


# ─── Unit tier: /stats funnel + score sample shape ──────────────────────


def test_get_stats_funnel_and_score_sample(client, _clear_overrides, monkeypatch):
    """The /stats funnel reports all six stages from DB counts (drafted +
    in_review wired to real data), and bundles the AI score sample for the
    histogram."""
    # 2 drafts per track (status='draft'), some submitted/shortlisted.
    def _count_by_status(track, status_id):
        return {"draft": 2, "shortlisted": 1, "interview": 1, "offered": 1}.get(
            status_id, 0
        )

    monkeypatch.setattr(stats, "count_apps_by_status", _count_by_status)
    monkeypatch.setattr(stats, "count_apps_total", lambda track: 30)
    monkeypatch.setattr(stats, "count_profiles", lambda: 288)
    monkeypatch.setattr(stats, "count_ai_screening_rows", lambda: 47)
    monkeypatch.setattr(stats, "fetch_ai_score_overalls", lambda: [5.0, 6.0, 7.0])

    app.dependency_overrides[get_current_user] = _override_user(["leadership"])
    res = client.get(
        "/leadership/stats", headers={"Authorization": "Bearer test-token"}
    )
    assert res.status_code == 200
    body = res.json()

    funnel = body["funnel"]
    assert funnel["profiles"] == 288
    assert funnel["drafted"] == 4          # 2 per track × 2 tracks
    assert funnel["submitted"] == 60       # 30 per track × 2 tracks
    assert funnel["in_review"] == 47       # screened-row count drives this
    assert funnel["advanced"] == 4         # (shortlisted+interview) × 2 tracks
    assert funnel["decided"] == 2          # offered × 2 tracks
    assert body["ai_score_overalls"] == [5.0, 6.0, 7.0]


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


# ─── Unit tier: attachment signed-url helper + endpoint (Phase 1.5) ──────


def test_collect_application_file_paths_tir():
    row = {
        "evidence_files": [
            {"path": "u1/evidence/a.pdf", "name": "a.pdf"},
            {"storage_path": "u1/evidence/b.png"},
            "not-a-dict",
            {"name": "no-path"},
        ],
        "execution_milestone_files": [{"path": "u1/milestone/c.xlsx"}],
        "evidence_deck": {"storage_path": "u1/evidence/deck.pdf"},
        "sip_pitch_deck": {"path": "should/be/ignored/on/tir.pdf"},
    }
    out = applications_query.collect_application_file_paths("tir", row)
    assert out == {
        "u1/evidence/a.pdf": "tir-evidence-files",
        "u1/evidence/b.png": "tir-evidence-files",
        "u1/evidence/deck.pdf": "tir-evidence-files",
        "u1/milestone/c.xlsx": "tir-milestone-files",
    }


def test_collect_application_file_paths_sip_buckets():
    row = {
        "execution_milestone_files": [{"path": "u2/milestone/m.pdf"}],
        "sip_traction_files": [{"path": "u2/traction/loi.pdf"}],
        "sip_patents_files": [{"storage_path": "u2/patents/p.pdf"}],
        "sip_pitch_deck": {"path": "u2/pitch-deck/d.pdf"},
        "sip_cap_table_file": {"path": "u2/cap-table/ct.xlsx"},
        "evidence_files": [{"path": "ignored/on/sip.pdf"}],
    }
    out = applications_query.collect_application_file_paths("sip", row)
    assert out == {
        "u2/milestone/m.pdf": "sip-milestone-files",
        "u2/traction/loi.pdf": "sip-evidence-files",
        "u2/patents/p.pdf": "sip-evidence-files",
        "u2/pitch-deck/d.pdf": "sip-evidence-files",
        "u2/cap-table/ct.xlsx": "sip-evidence-files",
    }


def test_signed_url_without_auth_returns_401(client):
    res = client.get(
        "/leadership/applications/00000000-0000-0000-0000-000000000000/files/signed-url"
        "?storage_path=u1/evidence/a.pdf"
    )
    assert res.status_code == 401


def test_signed_url_with_reviewer_only_returns_403(client, _clear_overrides):
    app.dependency_overrides[get_current_user] = _override_user(["reviewer"])
    res = client.get(
        "/leadership/applications/00000000-0000-0000-0000-000000000000/files/signed-url"
        "?storage_path=u1/evidence/a.pdf",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 403
    assert res.json()["detail"]["required"] == "view_app_detail"


def test_signed_url_rejects_path_traversal(client, _clear_overrides):
    app.dependency_overrides[get_current_user] = _override_user(["leadership"])
    res = client.get(
        "/leadership/applications/00000000-0000-0000-0000-000000000000/files/signed-url"
        "?storage_path=../../etc/passwd",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 400
    assert res.json()["detail"]["code"] == "invalid_storage_path"


def test_signed_url_404_when_application_missing(client, _clear_overrides, monkeypatch):
    monkeypatch.setattr(
        applications_query, "find_application_with_track", lambda _id: None
    )
    app.dependency_overrides[get_current_user] = _override_user(["leadership"])
    res = client.get(
        "/leadership/applications/00000000-0000-0000-0000-000000000000/files/signed-url"
        "?storage_path=u1/evidence/a.pdf",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 404
    assert res.json()["detail"]["code"] == "application_not_found"


def test_signed_url_404_when_path_not_on_application(client, _clear_overrides, monkeypatch):
    """A path not referenced by the resolved app must be refused (no signing)."""
    monkeypatch.setattr(
        applications_query,
        "find_application_with_track",
        lambda _id: ("tir", {"evidence_files": [{"path": "u1/evidence/known.pdf"}]}),
    )
    app.dependency_overrides[get_current_user] = _override_user(["leadership"])
    res = client.get(
        "/leadership/applications/00000000-0000-0000-0000-000000000000/files/signed-url"
        "?storage_path=u1/evidence/SOMEONE_ELSES.pdf",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 404
    assert res.json()["detail"]["code"] == "file_not_found"


def test_signed_url_success_signs_only_allowed_path(client, _clear_overrides, monkeypatch):
    """Happy path: a path that belongs to the app is signed via the correct
    bucket and the URL + TTL are returned."""
    import app.routers.leadership as lead_mod

    monkeypatch.setattr(
        applications_query,
        "find_application_with_track",
        lambda _id: ("tir", {"evidence_files": [{"path": "u1/evidence/known.pdf"}]}),
    )

    calls = {}

    class _FakeStorageBucket:
        def __init__(self, bucket):
            calls["bucket"] = bucket

        def create_signed_url(self, path, ttl):
            calls["path"] = path
            calls["ttl"] = ttl
            return {"signedURL": "https://signed.example/u1/evidence/known.pdf?token=x"}

    class _FakeStorage:
        def from_(self, bucket):
            return _FakeStorageBucket(bucket)

    class _FakeAdmin:
        storage = _FakeStorage()

    monkeypatch.setattr(lead_mod, "get_admin_client", lambda: _FakeAdmin())

    app.dependency_overrides[get_current_user] = _override_user(["leadership"])
    res = client.get(
        "/leadership/applications/00000000-0000-0000-0000-000000000000/files/signed-url"
        "?storage_path=u1/evidence/known.pdf",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["url"].startswith("https://signed.example/")
    assert body["expires_in"] == 120
    assert calls["bucket"] == "tir-evidence-files"
    assert calls["path"] == "u1/evidence/known.pdf"
    assert calls["ttl"] == 120


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
    # No AI-extracted name → row falls back to the solution_describe heuristic.
    monkeypatch.setattr(
        applications_query,
        "fetch_project_names_for",
        lambda pairs: {p: None for p in pairs},
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


def test_list_applications_prefers_ai_project_name(
    client, _clear_overrides, monkeypatch
):
    """When ai_screening has a project_name, the list uses it over the
    solution_describe heuristic."""
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
            "solution_describe": "ESD-safe wearable for shop-floor technicians.",
            "solution_stage": "Lab demos / proof of concept",
            "display_seq": 26013,
        }
    ]

    def _fake_fetch(track, **kw):
        return [dict(r) for r in fake_rows] if track == "tir" else []

    monkeypatch.setattr(applications_query, "fetch_apps_for_track", _fake_fetch)
    monkeypatch.setattr(
        applications_query, "fetch_ai_scores_for", lambda pairs: {p: 7.8 for p in pairs}
    )
    monkeypatch.setattr(
        applications_query, "fetch_industry_for_pairs", lambda pairs: {p: None for p in pairs}
    )
    monkeypatch.setattr(
        applications_query,
        "fetch_project_names_for",
        lambda pairs: {p: "GuardBand wearable" for p in pairs},
    )

    app.dependency_overrides[get_current_user] = _override_user(["leadership"])
    res = client.get(
        "/leadership/applications?track=tir",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 200
    a = res.json()["applications"][0]
    assert a["project_name"] == "GuardBand wearable"


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


# ─── Fix 1: VIP (sip) list row uses basic_org as project_name ────────────


def test_list_applications_sip_row_uses_basic_org_as_project_name(
    client, _clear_overrides, monkeypatch,
):
    """A sip-track row must use basic_org as project_name, not ai project_name."""
    fake_rows = [
        {
            "id": "sip-app-1",
            "track": "sip",
            "status": "submitted",
            "basic_full_name": "VIP Founder",
            "basic_org": "Acme Pvt Ltd",
            "basic_email": "vip@example.com",
            "submitted_at": "2026-06-10T08:00:00Z",
            "created_at": "2026-06-01T00:00:00Z",
            "display_seq": 10001,
        }
    ]

    def _fake_fetch(track, **kw):
        if track == "sip":
            return [dict(r) for r in fake_rows]
        return []

    monkeypatch.setattr(applications_query, "fetch_apps_for_track", _fake_fetch)
    monkeypatch.setattr(
        applications_query, "fetch_ai_scores_for", lambda pairs: {p: 7.0 for p in pairs}
    )
    monkeypatch.setattr(
        applications_query, "fetch_industry_for_pairs", lambda pairs: {p: None for p in pairs}
    )
    monkeypatch.setattr(
        applications_query,
        "fetch_project_names_for",
        lambda pairs: {p: "AI Project Name" for p in pairs},
    )
    # Patch _fetch_review_stats to return empty (not the real Supabase call).
    from app.services import admin_query as aq
    monkeypatch.setattr(aq, "_fetch_review_stats", lambda pairs: {})

    app.dependency_overrides[get_current_user] = _override_user(["leadership"])
    res = client.get(
        "/leadership/applications?track=sip",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 200, res.text
    a = res.json()["applications"][0]
    assert a["project_name"] == "Acme Pvt Ltd"


# ─── Fix 3: leadership list row includes reviewer_score ──────────────────


def test_list_applications_includes_reviewer_score(
    client, _clear_overrides, monkeypatch,
):
    """Each row in the leadership applications list must have a reviewer_score key
    (float when a submitted review exists, None otherwise)."""
    fake_rows = [
        {
            "id": "app-rs-1",
            "track": "tir",
            "status": "submitted",
            "basic_full_name": "Test Founder",
            "basic_org": "Test Org",
            "basic_email": "t@x.com",
            "submitted_at": "2026-06-10T08:00:00Z",
            "created_at": "2026-06-01T00:00:00Z",
            "display_seq": 26500,
        }
    ]

    def _fake_fetch(track, **kw):
        if track == "tir":
            return [dict(r) for r in fake_rows]
        return []

    monkeypatch.setattr(applications_query, "fetch_apps_for_track", _fake_fetch)
    monkeypatch.setattr(
        applications_query, "fetch_ai_scores_for", lambda pairs: {p: 8.0 for p in pairs}
    )
    monkeypatch.setattr(
        applications_query, "fetch_industry_for_pairs", lambda pairs: {p: None for p in pairs}
    )
    monkeypatch.setattr(
        applications_query, "fetch_project_names_for", lambda pairs: {p: None for p in pairs}
    )
    from app.services import admin_query as aq
    monkeypatch.setattr(
        aq,
        "_fetch_review_stats",
        lambda pairs: {pairs[0]: {"score": 7.5, "submitted": 1, "assigned": 1,
                                  "reco": {"yes": 0, "maybe": 0, "no": 0}}},
    )

    app.dependency_overrides[get_current_user] = _override_user(["leadership"])
    res = client.get(
        "/leadership/applications?track=tir",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 200, res.text
    a = res.json()["applications"][0]
    assert "reviewer_score" in a, "reviewer_score key must be present"
    assert a["reviewer_score"] == 7.5


def test_list_applications_reviewer_score_none_without_review(
    client, _clear_overrides, monkeypatch,
):
    """reviewer_score must be None when there are no submitted reviews."""
    fake_rows = [
        {
            "id": "app-rs-2",
            "track": "tir",
            "status": "submitted",
            "basic_full_name": "Founder 2",
            "basic_org": "Org 2",
            "basic_email": "f2@x.com",
            "submitted_at": "2026-06-11T08:00:00Z",
            "created_at": "2026-06-02T00:00:00Z",
            "display_seq": 26501,
        }
    ]

    def _fake_fetch(track, **kw):
        return [dict(r) for r in fake_rows] if track == "tir" else []

    monkeypatch.setattr(applications_query, "fetch_apps_for_track", _fake_fetch)
    monkeypatch.setattr(
        applications_query, "fetch_ai_scores_for", lambda pairs: {p: 6.0 for p in pairs}
    )
    monkeypatch.setattr(
        applications_query, "fetch_industry_for_pairs", lambda pairs: {p: None for p in pairs}
    )
    monkeypatch.setattr(
        applications_query, "fetch_project_names_for", lambda pairs: {p: None for p in pairs}
    )
    from app.services import admin_query as aq
    monkeypatch.setattr(aq, "_fetch_review_stats", lambda pairs: {})

    app.dependency_overrides[get_current_user] = _override_user(["leadership"])
    res = client.get(
        "/leadership/applications?track=tir",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 200, res.text
    a = res.json()["applications"][0]
    assert "reviewer_score" in a
    assert a["reviewer_score"] is None


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
        for key in ("totals", "funnel", "status_counts", "ai_score_overalls"):
            assert key in body, f"missing key {key!r} in stats response"
        # Funnel exposes all six pipeline stages.
        for stage in ("profiles", "drafted", "submitted", "in_review", "advanced", "decided"):
            assert stage in body["funnel"], f"missing funnel stage {stage!r}"

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


def test_signed_url_accepts_resume_path(client, _clear_overrides, monkeypatch):
    """The leadership/admin signed-url endpoint signs the résumé path once it's
    merged into the allow-list from resume_file_id."""
    import app.routers.leadership as lead_mod

    monkeypatch.setattr(
        applications_query, "find_application_with_track",
        lambda _id: ("tir", {"resume_file_id": "res-1"}),
    )
    monkeypatch.setattr(
        applications_query, "resolve_resume_file",
        lambda track, row: {
            "original_filename": "cv.pdf", "file_size_bytes": 10,
            "storage_path": "u1/res-1.pdf", "mime_type": "application/pdf",
            "bucket": "tir-resumes",
        },
    )

    calls = {}

    class _FakeStorageBucket:
        def __init__(self, bucket):
            calls["bucket"] = bucket

        def create_signed_url(self, path, ttl):
            calls["path"] = path
            return {"signedURL": "https://signed.example/u1/res-1.pdf?token=x"}

    class _FakeStorage:
        def from_(self, bucket):
            return _FakeStorageBucket(bucket)

    class _FakeAdmin:
        storage = _FakeStorage()

    monkeypatch.setattr(lead_mod, "get_admin_client", lambda: _FakeAdmin())
    app.dependency_overrides[get_current_user] = _override_user(["leadership"])

    res = client.get(
        "/leadership/applications/00000000-0000-0000-0000-000000000000/files/signed-url"
        "?storage_path=u1/res-1.pdf",
        headers={"Authorization": "Bearer test-token"},
    )
    assert res.status_code == 200, res.text
    assert calls["bucket"] == "tir-resumes"
    assert calls["path"] == "u1/res-1.pdf"
