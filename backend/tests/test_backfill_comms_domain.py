from scripts import backfill_comms_domain as bd
from tests.fixtures.fake_supabase import FakeSupabase


def test_apply_sets_comms_and_backs_up_only_changed():
    sb = FakeSupabase({
        "industry_categories": [{"id": "comms", "label": "Communication (Wired & Wireless)"}],
        "ai_screening": [
            {"application_id": "a1", "application_track": "tir", "industry_category_id": "semi"},
            {"application_id": "a2", "application_track": "tir", "industry_category_id": "comms"},
        ],
    })
    matches = [
        {"app_id": "a1", "track": "tir", "current_category": "semi"},
        {"app_id": "a2", "track": "tir", "current_category": "comms"},  # already comms
    ]
    backup, changed = bd.apply_matches(sb, matches)
    assert changed == 1                                   # a2 skipped (already comms)
    assert backup == [{"app_id": "a1", "track": "tir", "old_category_id": "semi"}]
    row = next(r for r in sb.tables["ai_screening"] if r["application_id"] == "a1")
    assert row["industry_category_id"] == "comms"


def test_apply_requires_comms_category_to_exist():
    sb = FakeSupabase({"industry_categories": [], "ai_screening": []})
    try:
        bd.assert_category_exists(sb)
        assert False, "expected SystemExit"
    except SystemExit:
        pass
