from app.services import admin_query


def test_fetch_detail_includes_ai_sections(monkeypatch):
    aq = admin_query.applications_query
    monkeypatch.setattr(aq, "find_application_with_track",
                        lambda app_id: ("tir", {"id": app_id, "display_seq": 1}))
    monkeypatch.setattr(aq, "fetch_ai_screening_for",
                        lambda app_id, track: {"sections": {"problem": ["p"]}})
    monkeypatch.setattr(aq, "fetch_reviews_for", lambda a, t: [])
    monkeypatch.setattr(aq, "fetch_reviewer_assignments_for", lambda a, t: [])
    monkeypatch.setattr(aq, "enrich_reviewers", lambda ra, rv: (ra, rv))
    monkeypatch.setattr(aq, "fetch_status_history_for", lambda a, t: [])
    monkeypatch.setattr(admin_query, "_fetch_latest_decisions", lambda keys: {})
    monkeypatch.setattr(admin_query, "_fetch_admin_meta", lambda keys: {})
    monkeypatch.setattr(admin_query, "_fetch_batches", lambda keys: {})

    out = admin_query.fetch_detail("tir", "a1")
    assert out["aiSections"] == {"problem": ["p"]}
