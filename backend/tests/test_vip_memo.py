from types import SimpleNamespace

import pytest

from app.services import vip_memo


def test_memo_prompt_contains_all_application_evidence():
    prompt = vip_memo.build_prompt(
        {"id": next(iter(vip_memo.PILOT_APPLICATION_IDS)), "problem_describe": "specific pain"},
        {"score_overall": 8.5},
        [{"score_problem": 7.0}],
    )
    assert "problem_describe" in prompt
    assert "score_overall" in prompt
    assert "REQUEST MORE INFORMATION" in prompt
    assert "[To be confirmed]" in prompt


def test_memo_generation_is_pilot_and_track_gated():
    with pytest.raises(ValueError, match="pilot"):
        vip_memo.generate_memo({"id": "not-a-pilot", "track": "sip"})
    with pytest.raises(ValueError, match="sip track"):
        vip_memo.generate_memo({"id": next(iter(vip_memo.PILOT_APPLICATION_IDS)), "track": "tir"})


def test_memo_generation_validates_structured_sections(monkeypatch):
    class Response:
        def raise_for_status(self): pass
        def json(self):
            return {"choices": [{"message": {"content": "{}"}}]}
    monkeypatch.setattr(vip_memo.httpx, "post", lambda *a, **k: Response())
    with pytest.raises(ValueError, match="missing sections"):
        vip_memo.generate_memo({"id": next(iter(vip_memo.PILOT_APPLICATION_IDS)), "track": "sip"})
