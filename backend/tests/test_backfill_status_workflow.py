from scripts.backfill_status_workflow import remap_status, TERMINAL


def test_terminal_kept():
    for s in ["draft", "withdrawn", "rejected", "jury_review", "on_hold", "waitlisted", "shortlisted", "offered", "onboarded"]:
        assert remap_status(s, has_review=True, has_active_assignment=True) == s


def test_review_wins():
    assert remap_status("under_review", has_review=True, has_active_assignment=True) == "evaluated"
    assert remap_status("submitted", has_review=True, has_active_assignment=False) == "evaluated"


def test_assignment_only():
    assert remap_status("under_review", has_review=False, has_active_assignment=True) == "under_review"
    assert remap_status("submitted", has_review=False, has_active_assignment=True) == "under_review"


def test_bare_submitted():
    assert remap_status("under_review", has_review=False, has_active_assignment=False) == "submitted"
    assert remap_status("ai_screening", has_review=False, has_active_assignment=False) == "submitted"
    assert remap_status("submitted", has_review=False, has_active_assignment=False) == "submitted"
