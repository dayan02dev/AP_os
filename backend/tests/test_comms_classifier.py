from app.services import comms_classifier as cc


def test_shortlist_matches_comms_terms():
    text = "A 5G RF antenna transceiver for wireless backhaul over fiber optic links."
    terms = cc.shortlist(text)
    assert "5g" in terms and "antenna" in terms and "wireless" in terms
    assert "fiber optic" in terms


def test_shortlist_ignores_non_comms():
    assert cc.shortlist("A payments platform for small merchants.") == []
    # merely 'communicate' must NOT trip a keyword (precision left to LLM)
    assert cc.shortlist("Our app lets teams communicate faster.") == []


def test_identify_includes_confirmed_excludes_rejected():
    apps = [
        {"app_id": "a1", "track": "tir", "project_name": "RadioCo",
         "current_category": "semi", "text": "5G wireless RF transceiver"},
        {"app_id": "a2", "track": "tir", "project_name": "PayCo",
         "current_category": "other", "text": "A payments platform"},
        {"app_id": "a3", "track": "sip", "project_name": "NetCo",
         "current_category": "ai", "text": "AI over a wireless mesh network"},
    ]
    calls = []

    def fake_confirm(text):
        calls.append(text)
        return {"is_comms": "5G" in text or "RF" in text, "reason": "rf/5g"}

    out = cc.identify(apps, confirm_fn=fake_confirm)
    ids = {m["app_id"] for m in out}
    assert ids == {"a1"}                                 # a3 confirmed no, a2 not shortlisted
    assert all("payments" not in t for t in calls)       # a2 never sent to the LLM
    assert out[0]["matched_terms"] and out[0]["current_category"] == "semi"


def test_confirm_parses_json_and_is_failsafe():
    ok = cc.confirm_is_comms("x", call=lambda _t: '{"is_comms": true, "reason": "rf"}')
    assert ok == {"is_comms": True, "reason": "rf"}
    bad = cc.confirm_is_comms("x", call=lambda _t: "not json")
    assert bad["is_comms"] is False                      # parse error → safe false
