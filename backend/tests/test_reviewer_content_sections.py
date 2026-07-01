import asyncio
from app.routers import reviewer


def test_content_payload_includes_ai_sections(monkeypatch):
    fake = {
        "application": {"id": "a1", "basic_org": "Org"},
        "assignment": {"assignment_id": "as1", "assigned_at": "t"},
        "my_review": None,
        "ai_screening": {"summary": "s", "sections": {"problem": ["p1"]}},
    }
    monkeypatch.setattr(reviewer.reviewer_query, "fetch_application_for_reviewer",
                        lambda uid, track, app_id: fake)
    monkeypatch.setattr(reviewer.reviewer_query, "_display_id", lambda t, r: "TIR-1")
    monkeypatch.setattr(reviewer.reviewer_query, "_ai_block", lambda ai: {"overall": None})
    monkeypatch.setattr(reviewer.review_presenter, "TIR_FIELD_MAP", {})
    monkeypatch.setattr(reviewer.review_presenter, "collect_attachment_paths",
                        lambda row, track: [])
    monkeypatch.setattr(reviewer.review_presenter, "build_fields", lambda row, fm: [])
    monkeypatch.setattr(reviewer.review_presenter, "build_sections", lambda row, t: [])
    # get_application_content also calls get_admin_client() to build signed
    # attachment URLs; collect_attachment_paths is mocked to return [] above,
    # so the fake client is never actually used, but the real client would
    # try (and fail) to hit Supabase during construction under test env vars.
    monkeypatch.setattr(reviewer, "get_admin_client", lambda: object())

    out = asyncio.run(reviewer.get_application_content(
        "tir", "a1", user={"user_id": "u1"}))
    assert out["aiSections"] == {"problem": ["p1"]}
