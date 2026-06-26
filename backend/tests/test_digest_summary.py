from app.services.digest_summary import summarize_reviews


def test_groups_sorts_and_scores():
    reviews = [
        {"reviewer_user_id": "r1", "application_id": "aaaaaaaa-1", "application_track": "sip",
         "recommendation": "yes", "submitted_at": "2026-06-25T05:00:00Z",
         "score_problem": 9, "score_solution": 9, "score_tech": 8, "score_founders": 8, "score_commitment": 9},
        {"reviewer_user_id": "r1", "application_id": "bbbbbbbb-2", "application_track": "tir",
         "recommendation": "maybe", "submitted_at": "2026-06-25T06:00:00Z",
         "score_problem": 5, "score_solution": None, "score_tech": 5, "score_founders": 5, "score_commitment": 5},
        {"reviewer_user_id": "r2", "application_id": "cccccccc-3", "application_track": "sip",
         "recommendation": "no", "submitted_at": "2026-06-25T07:00:00Z",
         "score_problem": 3, "score_solution": 3, "score_tech": 3, "score_founders": 3, "score_commitment": 3},
    ]
    groups = summarize_reviews(reviews, {"r1": "Rey", "r2": "Mara"})
    assert [g["reviewer_name"] for g in groups] == ["Rey", "Mara"]  # r1 (2) before r2 (1)
    r1 = groups[0]
    assert r1["count"] == 2
    assert r1["items"][0]["track_label"] == "VIP"  # sip → VIP
    assert r1["items"][0]["overall"] == 8.64        # (9*22+9*30+8*22+8*14+9*12)/100
    assert r1["items"][1]["overall"] is None         # incomplete (score_solution None)


def test_empty_input():
    assert summarize_reviews([], {}) == []
