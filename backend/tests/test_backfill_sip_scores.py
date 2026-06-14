from scripts.backfill_sip_ai_scores import select_app_ids


def test_select_skips_drafts():
    rows = [
        {"id": "a", "status": "submitted"},
        {"id": "b", "status": "draft"},
        {"id": "c", "status": "under_review"},
    ]
    # Only "submitted" — draft and under_review are excluded.
    assert select_app_ids(rows) == ["a"]


def test_select_empty():
    assert select_app_ids([]) == []


def test_select_preserves_order():
    rows = [
        {"id": "x", "status": "submitted"},
        {"id": "y", "status": "submitted"},
        {"id": "z", "status": "under_review"},
    ]
    assert select_app_ids(rows) == ["x", "y"]


def test_select_skips_already_scored():
    # "scored_id" has a row in ai_screening; "new_id" does not.
    rows = [
        {"id": "scored_id", "status": "submitted"},
        {"id": "new_id", "status": "submitted"},
    ]
    already_scored = {"scored_id"}
    result = select_app_ids(rows, already_scored)
    assert result == ["new_id"]


def test_select_all_already_scored():
    rows = [
        {"id": "a", "status": "submitted"},
        {"id": "b", "status": "submitted"},
    ]
    already_scored = {"a", "b"}
    assert select_app_ids(rows, already_scored) == []


def test_select_excludes_rows_missing_status():
    # Status must be exactly "submitted" — missing status is excluded.
    rows = [{"id": "e", "status": "submitted"}, {"id": "f"}]
    assert select_app_ids(rows) == ["e"]
