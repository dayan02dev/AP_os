"""Tests for persistence — writing ScoringState to ai_screening row."""
from __future__ import annotations

from app.services.ai_scoring.persistence import persist_score
from app.services.ai_scoring.state import (
    Citation, ConfidenceFactors, Round1Summary, SignalScore,
)


class _FakeClient:
    """Minimal supabase client stub."""
    def __init__(self):
        self.last_upsert_payload = None

    def table(self, name):
        assert name == "ai_screening"
        return self

    def upsert(self, payload, on_conflict=None):
        self.last_upsert_payload = payload
        return self

    def execute(self):
        return type("R", (), {"data": [self.last_upsert_payload]})()


def _sig(name, score=8):
    return SignalScore(
        signal=name, score=score, rationale="x",
        evidence_citations=[Citation(source="Q1", quote="x")],
        confidence_factors=ConfidenceFactors(
            data_completeness=0.9, evidence_specificity=0.9,
            internal_consistency=0.9, verifiability=0.9, answer_granularity=0.9,
        ),
        flags=[],
    )


def _state():
    return {
        "application_id": "app-uuid-1",
        "track": "tir",
        "score_problem_impact": _sig("problem_impact", 8),
        "score_completeness": _sig("completeness", 7),
        "score_technical_depth": _sig("technical_depth", 9),
        "score_behavioural": _sig("behavioural", 6),
        "score_commitment": _sig("commitment", 7),
        "caps_applied": [],
        "composite_percentage": 75.0,
        "strength_label": "STRONG",
        "confidence_overall": 0.85,
        "summary_round_1": Round1Summary(
            verdict="This is a STRONG application for the TIR Track.",
            top_strength="x", top_concern="x", program_fit="x",
            recommendation="ACCEPT within 14 days.",
        ),
        "model": "gemini-2.5-flash",
        "qg_needs_human_review": False,
    }


def test_persist_writes_to_ai_screening():
    client = _FakeClient()
    persist_score(client, _state())
    payload = client.last_upsert_payload
    assert payload["application_id"] == "app-uuid-1"
    assert payload["application_track"] == "tir"
    assert payload["score_problem"] == 8
    assert payload["score_completeness"] == 7
    assert payload["score_tech"] == 9
    assert payload["score_founders"] == 6   # Behavioural → score_founders
    assert payload["score_commitment"] == 7
    assert payload["score_overall"] == 7.5   # composite 75.0 ÷ 10
    assert payload["model"] == "gemini-2.5-flash"
    assert payload["error"] is None


def test_persist_includes_caps_in_flags():
    from app.services.ai_scoring.state import CapEvent
    from datetime import datetime, timezone
    s = _state()
    s["caps_applied"] = [
        CapEvent(rule_id="C2", triggered_at=datetime.now(timezone.utc),
                 signal_capped=["technical_depth"], cap_value=4,
                 evidence_snippet="x", flag="c2_deployed_no_evidence"),
    ]
    client = _FakeClient()
    persist_score(client, s)
    flags = client.last_upsert_payload["flags"]
    assert any(c["rule_id"] == "C2" for c in flags["cap_events"])
