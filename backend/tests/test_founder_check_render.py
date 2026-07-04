from app.services.founder_check.render import founder_bullets, merge_sections

_FC = {
    "verdict": "EXCEPTIONAL", "confidence": "HIGH",
    "top_signals": "IISc PhD, granted patent US-1, DRDO pilot",
    "gaps": "no named first-team hire",
    "whats_rare": "hardware depth + enterprise contract pre-team",
}


def test_founder_bullets_formats_four_labelled_lines():
    out = founder_bullets(_FC)
    assert out == [
        "Verdict: EXCEPTIONAL (HIGH confidence)",
        "Top signals: IISc PhD, granted patent US-1, DRDO pilot",
        "Gaps / red flags: no named first-team hire",
        "What's rare: hardware depth + enterprise contract pre-team",
    ]


def test_founder_bullets_empty_for_none_or_empty():
    assert founder_bullets(None) == []
    assert founder_bullets({}) == []


def test_founder_bullets_verdict_without_confidence():
    assert founder_bullets({"verdict": "STANDARD"}) == ["Verdict: STANDARD"]


def test_merge_sections_adds_founder_key():
    merged = merge_sections({"problem": ["p1"]}, _FC)
    assert merged["problem"] == ["p1"]
    assert merged["founder"][0].startswith("Verdict: EXCEPTIONAL")


def test_merge_sections_no_founder_when_absent():
    assert merge_sections({"problem": ["p1"]}, None) == {"problem": ["p1"]}
    assert merge_sections(None, None) is None
