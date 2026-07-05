# backend/tests/test_fake_supabase.py
from tests.fixtures.fake_supabase import FakeSupabase


def test_update_is_readable_back():
    fake = FakeSupabase({"tir_applications": [{"id": "a1", "status": "submitted"}]})
    fake.table("tir_applications").update({"status": "under_review"}).eq("id", "a1").execute()
    row = fake.table("tir_applications").select("*").eq("id", "a1").execute().data[0]
    assert row["status"] == "under_review"


def test_eq_filters_selects():
    fake = FakeSupabase({"t": [{"id": "1", "k": "x"}, {"id": "2", "k": "y"}]})
    got = fake.table("t").select("*").eq("k", "y").execute().data
    assert [r["id"] for r in got] == ["2"]


def test_insert_appends_and_autoassigns_id():
    fake = FakeSupabase({"reviews": []})
    res = fake.table("reviews").insert({"application_id": "a1"}).execute()
    assert res.data[0]["id"]
    assert len(fake.tables["reviews"]) == 1


def test_maybe_single_returns_dict_or_none():
    fake = FakeSupabase({"t": [{"id": "1"}]})
    assert fake.table("t").select("*").eq("id", "1").maybe_single().execute().data == {"id": "1"}
    assert fake.table("t").select("*").eq("id", "nope").maybe_single().execute().data is None


def test_upsert_on_conflict_updates_existing():
    fake = FakeSupabase({"ai_screening": [{"application_id": "a1", "application_track": "tir", "score_overall": 1.0}]})
    fake.table("ai_screening").upsert(
        {"application_id": "a1", "application_track": "tir", "score_overall": 9.0},
        on_conflict="application_id,application_track",
    ).execute()
    rows = fake.tables["ai_screening"]
    assert len(rows) == 1 and rows[0]["score_overall"] == 9.0
