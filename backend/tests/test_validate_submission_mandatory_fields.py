"""Unit tests for the three new mandatory wizard fields.

Targets the pure validator function (no router, no DB) — fast and exact.
"""
from app.routers.applications import _validate_submission


def _draft_with(**overrides):
    """Build a fully-valid draft row, then apply overrides."""
    base = {
        "id": "00000000-0000-0000-0000-000000000001",
        "user_id": "00000000-0000-0000-0000-000000000002",
        "status": "draft",
        # Minimum set the validator looks at for non-Identity fields
        "basic_full_name": "Test Person",
        "basic_email": "test@example.com",
        "basic_phone": "+91 9876543210",
        "basic_org": "Test Org",
        "basic_degree": "Bachelor's Degree",
        "basic_has_team": "No — going solo for now",
        "basic_hear_about": "Referral from friend/colleague",
        "basic_incubator_association": "No",
        "problem_defined": "Yes",
        "problem_describe": "x",
        "problem_importance": "x",
        "solution_describe": "x",
        "solution_core_tech": "x",
        "solution_customers": "x",
        "solution_stage": "Still exploring",
        "solution_moat": "x",
        "solution_ten_x": "x",
        "solution_national_scale": "x",
        "solution_hurdles": "x",
        "solution_contrarian_insight": "x",
        "execution_milestone": "x",
        "execution_infrastructure": "x",
        "execution_failure": "x",
        "execution_hwsw_integration": "x",
        "execution_budget": "x",
        "declaration_truthful": True,
        "declaration_ref_checks": True,
        "declaration_terms": True,
        # The new fields — defaults vary per test
        "resume_file_id": "00000000-0000-0000-0000-000000000003",
        "linkedin_url": "https://linkedin.com/in/testperson",
        "github_url": "https://github.com/testperson",
    }
    base.update(overrides)
    return base


def test_validate_all_three_present_and_valid():
    missing, invalid = _validate_submission(_draft_with())
    assert "resume_file_id" not in missing
    assert "linkedin_url" not in missing
    assert "github_url" not in missing
    assert not any(i["field"] in ("linkedin_url", "github_url") for i in invalid)


def test_validate_resume_missing():
    missing, _ = _validate_submission(_draft_with(resume_file_id=None))
    assert "resume_file_id" in missing


def test_validate_linkedin_blank():
    missing, _ = _validate_submission(_draft_with(linkedin_url=""))
    assert "linkedin_url" in missing


def test_validate_linkedin_wrong_domain():
    missing, invalid = _validate_submission(
        _draft_with(linkedin_url="https://example.com/profile")
    )
    assert "linkedin_url" not in missing  # presence OK
    assert any(
        i["field"] == "linkedin_url" and "linkedin.com" in i["reason"]
        for i in invalid
    )


def test_validate_github_blank():
    missing, _ = _validate_submission(_draft_with(github_url=None))
    assert "github_url" in missing


def test_validate_github_wrong_domain():
    missing, invalid = _validate_submission(
        _draft_with(github_url="https://gitlab.com/user")
    )
    assert "github_url" not in missing
    assert any(
        i["field"] == "github_url" and "github.com" in i["reason"]
        for i in invalid
    )


def test_validate_linkedin_too_long():
    long_url = "https://linkedin.com/in/" + ("x" * 500)
    _, invalid = _validate_submission(_draft_with(linkedin_url=long_url))
    assert any(
        i["field"] == "linkedin_url" and "500" in i["reason"]
        for i in invalid
    )


# ──────────────────────────────────────────────────────────────────
# Integration tests at the router boundary — monkey-patch the DB
# helpers so we can assert HTTP-level behaviour without Supabase.
# ──────────────────────────────────────────────────────────────────
import pytest
from fastapi.testclient import TestClient

from app.routers import applications as apps_router


@pytest.fixture
def submit_client(monkeypatch):
    # Patch the DB helpers used inside submit_application
    fake_row = _draft_with()  # fully-valid by default; tests below override
    state = {"row": fake_row, "updated": None}

    def fake_fetch(user_id):
        return state["row"]

    def fake_update(app_id, patch):
        merged = {**state["row"], **patch}
        state["updated"] = merged
        return merged

    def fake_audit(**kwargs):
        return None

    def fake_email(*a, **kw):
        return True

    monkeypatch.setattr(apps_router, "_fetch_application", fake_fetch)
    monkeypatch.setattr(apps_router, "_update_application", fake_update)
    monkeypatch.setattr(apps_router, "_audit", fake_audit)
    # Bypass email side-effect if the handler calls one
    monkeypatch.setattr(apps_router, "_send_submission_email", fake_email, raising=False)
    # Bypass auth — use whatever the existing test harness uses; if there
    # is no shared override, the implementer should mirror what
    # tests/test_applications.py uses (search for "get_current_user"
    # overrides in that file).
    from app.main import app as fastapi_app
    from app.deps import get_current_user
    fastapi_app.dependency_overrides[get_current_user] = lambda: {
        "user_id": fake_row["user_id"], "email": "test@example.com", "roles": ["applicant"],
    }
    # Bypass rate-limit deps the same way the existing app tests do
    apps_router._reset_patch_rate_limits()

    with TestClient(fastapi_app) as tc:
        yield tc, state

    # Cleanup — don't leak overrides into the next test in the session.
    fastapi_app.dependency_overrides.pop(get_current_user, None)
    apps_router._reset_patch_rate_limits()


def test_submit_succeeds_when_all_three_fields_present(submit_client):
    tc, state = submit_client
    r = tc.post("/applications/me/submit")
    assert r.status_code == 200, r.text
    assert state["updated"]["status"] == "submitted"


def test_submit_blocks_when_resume_missing(submit_client):
    tc, state = submit_client
    state["row"]["resume_file_id"] = None
    r = tc.post("/applications/me/submit")
    assert r.status_code == 422
    body = r.json()
    assert body["error"]["code"] == "incomplete_application"
    assert "resume_file_id" in body["error"]["missing_fields"]
    assert state["updated"] is None  # status was NOT flipped


def test_submit_blocks_when_linkedin_blank(submit_client):
    tc, state = submit_client
    state["row"]["linkedin_url"] = ""
    r = tc.post("/applications/me/submit")
    assert r.status_code == 422
    assert "linkedin_url" in r.json()["error"]["missing_fields"]


def test_submit_blocks_when_github_wrong_domain(submit_client):
    tc, state = submit_client
    state["row"]["github_url"] = "https://gitlab.com/me"
    r = tc.post("/applications/me/submit")
    assert r.status_code == 422
    body = r.json()
    assert "github_url" in [i["field"] for i in body["error"]["invalid_fields"]]


def test_submit_still_lets_OTHER_missing_fields_through(submit_client):
    """Existing soft-validation policy must remain: ONLY the 3 new fields hard-block."""
    tc, state = submit_client
    state["row"]["problem_describe"] = ""  # an OLD field, intentionally blank
    r = tc.post("/applications/me/submit")
    assert r.status_code == 200, r.text
    assert state["updated"]["status"] == "submitted"


def test_grandfathered_submitted_row_is_readable(monkeypatch):
    """A row submitted before the rule shipped — NULLs for all 3 fields.
    GET /applications/me must return it without re-validating."""
    from app.routers import applications as apps_router
    from app.main import app as fastapi_app
    from app.deps import get_current_user

    old_row = _draft_with(
        status="submitted",
        resume_file_id=None,
        linkedin_url=None,
        github_url=None,
        submitted_at="2026-05-01T00:00:00+00:00",
        created_at="2026-05-01T00:00:00+00:00",
        updated_at="2026-05-01T00:00:00+00:00",
    )

    def fake_fetch(user_id):
        return old_row

    monkeypatch.setattr(apps_router, "_fetch_application", fake_fetch)
    fastapi_app.dependency_overrides[get_current_user] = lambda: {
        "user_id": old_row["user_id"], "email": "old@example.com", "roles": ["applicant"],
    }
    apps_router._reset_patch_rate_limits()

    with TestClient(fastapi_app) as tc:
        r = tc.get("/applications/me")
    assert r.status_code == 200
    body = r.json()
    assert body["resume_file_id"] is None
    assert body["linkedin_url"] is None
    assert body["github_url"] is None

    fastapi_app.dependency_overrides.pop(get_current_user, None)
