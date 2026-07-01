from scripts.rescore_all_applications import select_targets


def test_select_targets_excludes_drafts_and_dedupes():
    rows = [
        {"id": "1", "status": "draft"},
        {"id": "2", "status": "submitted"},
        {"id": "3", "status": "under_review"},
        {"id": "4", "status": "evaluated"},
    ]
    ids = select_targets(rows)
    assert ids == ["2", "3", "4"]


def test_select_targets_only_missing_skips_scored():
    rows = [{"id": "2", "status": "submitted"}, {"id": "3", "status": "evaluated"}]
    ids = select_targets(rows, already_scored={"2"}, only_missing=True)
    assert ids == ["3"]
