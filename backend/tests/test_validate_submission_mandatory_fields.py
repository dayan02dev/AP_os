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
