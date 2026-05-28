from scripts.backfill_tir_scores import select_app_ids


def test_select_skips_drafts():
    rows = [
        {"id": "a", "status": "submitted"},
        {"id": "b", "status": "draft"},
        {"id": "c", "status": "under_review"},
    ]
    assert select_app_ids(rows) == ["a", "c"]


def test_select_empty():
    assert select_app_ids([]) == []


def test_select_preserves_order():
    rows = [
        {"id": "x", "status": "submitted"},
        {"id": "y", "status": "submitted"},
        {"id": "z", "status": "under_review"},
    ]
    assert select_app_ids(rows) == ["x", "y", "z"]
