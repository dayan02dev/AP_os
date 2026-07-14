"""Jury v2 RBAC: pick-based capability set."""
from app.rbac import ROLE_CAPABILITIES, capabilities_for, has_capability


def test_jury_role_capabilities_v2():
    assert ROLE_CAPABILITIES["jury"] == {"view_assigned_jury_apps", "submit_jury_picks"}

def test_scoring_caps_gone():
    for cap in ("score_jury", "comment_jury", "decline_jury_assignment"):
        assert not has_capability(["jury"], cap)

def test_admin_and_leadership_jury_caps():
    assert has_capability(["admin"], "assign_jurors")
    assert has_capability(["admin"], "manage_jury_roster")
    assert has_capability(["leadership"], "assign_jurors")
    assert not has_capability(["leadership"], "manage_jury_roster")

def test_jury_cannot_touch_reviewer_caps():
    assert capabilities_for(["jury"]) & {"score_app", "view_all_apps"} == set()
