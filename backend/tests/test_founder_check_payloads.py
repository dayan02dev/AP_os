import asyncio
from app.routers import reviewer


_FC = {"verdict": "STRONG", "confidence": "HIGH", "top_signals": "x, y"}


def test_reviewer_payload_merges_founder(monkeypatch):
    fake = {
        "application": {"id": "a1", "basic_org": "Org"},
        "assignment": {"assignment_id": "as1"},
        "my_review": None,
        "ai_screening": {"summary": "s", "sections": {"problem": ["p1"]},
                         "founder_check": _FC},
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
    monkeypatch.setattr(reviewer, "get_admin_client", lambda: object())

    out = asyncio.run(reviewer.get_application_content(
        "tir", "a1", user={"user_id": "u1"}))
    assert out["aiSections"]["problem"] == ["p1"]
    assert out["aiSections"]["founder"][0].startswith("Verdict: STRONG")


def test_admin_detail_merges_founder():
    from app.services.founder_check.render import merge_sections
    merged = merge_sections({"problem": ["p1"]}, _FC)
    assert "founder" in merged


def test_sip_has_no_founder_section():
    from app.services.founder_check.render import merge_sections
    assert merge_sections({"problem": ["p1"]}, None) == {"problem": ["p1"]}
