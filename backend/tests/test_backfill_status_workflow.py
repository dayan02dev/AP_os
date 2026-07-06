from scripts.backfill_status_workflow import remap_status, TERMINAL, compute_changes


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


def test_compute_changes_maps_all_branches():
    apps = {
        "tir": [
            {"id": "keep", "status": "jury_review"},
            {"id": "rev", "status": "under_review"},
            {"id": "assigned", "status": "under_review"},
            {"id": "bare", "status": "under_review"},
        ],
    }
    reviews = {("rev", "tir")}                 # has a submitted review
    active_assign = {("assigned", "tir")}      # has an active assignment
    changes = compute_changes(apps, reviews, active_assign)
    by_id = {c["id"]: c["to"] for c in changes}
    # compute_changes returns ONLY rows whose status actually changes.
    assert "keep" not in by_id                 # terminal -> kept -> not in list
    assert by_id["rev"] == "evaluated"         # under_review + review -> evaluated
    assert "assigned" not in by_id             # already under_review -> no change
    assert by_id["bare"] == "submitted"        # under_review, no review/assignment -> submitted
