"""Unit tests for the role/capability mapping (spec §3.2)."""

from app.rbac import (
    ROLE_CAPABILITIES,
    capabilities_for,
    has_capability,
)


def test_applicant_can_manage_own_draft():
    assert has_capability(["applicant"], "manage_own_draft") is True


def test_applicant_cannot_view_all_apps():
    assert has_capability(["applicant"], "view_all_apps") is False


def test_multi_role_unions_capabilities():
    # Someone with leadership + reviewer gets both sets.
    caps = capabilities_for(["leadership", "reviewer"])
    assert "view_all_apps" in caps          # from leadership
    assert "score_app" in caps              # from reviewer


def test_unknown_role_returns_empty():
    assert capabilities_for(["nonsense"]) == set()


def test_admin_can_grant_role():
    assert has_capability(["admin"], "grant_role") is True


def test_leadership_cannot_grant_role():
    # Leadership is strategic; user provisioning is admin-only.
    assert has_capability(["leadership"], "grant_role") is False


def test_admin_and_leadership_both_see_audit():
    assert has_capability(["admin"], "view_audit_log") is True
    assert has_capability(["leadership"], "view_audit_log") is True


def test_six_roles_in_constant():
    # Spec §3.1 — Phase 1 has exactly these six roles.
    assert set(ROLE_CAPABILITIES.keys()) == {
        "applicant",
        "founder",
        "reviewer",
        "mentor",
        "leadership",
        "admin",
    }


def test_empty_roles_list_has_no_capabilities():
    assert capabilities_for([]) == set()
    assert has_capability([], "manage_users") is False


def test_admin_has_platform_capabilities():
    from app.rbac import ROLE_CAPABILITIES as C
    assert {"decide_application","manage_batches","manage_reviewers_roster","assign_reviewers"} <= C["admin"]
    assert "decide_application" in C["leadership"]
