from scripts import backfill_founder_check as bf


def test_select_targets_only_tir_nondraft_with_resume():
    rows = [
        {"id": "a1", "status": "submitted", "resume_file_id": "r1"},
        {"id": "a2", "status": "submitted", "resume_file_id": None},   # no résumé
        {"id": "a3", "status": "draft", "resume_file_id": "r3"},        # draft
        {"id": "a4", "status": "under_review", "resume_file_id": "r4"},
    ]
    assert bf.select_targets(rows) == ["a1", "a4"]
