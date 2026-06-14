"""PROVISIONAL_V0 SIP scoring smoke tests.

SIP reuses the TIR graph + prompts as a baseline. These tests pin two
things:
  1. The provisional SIP cap (rule_sip_preincorp / "SIP1") fires for
     pre-incorporation OR TRL≤3 and stays silent for a mature SIP row, and
     it only runs when track == "sip".
  2. A SIP row scores end-to-end through the runner + graph and persists a
     valid ai_screening payload with application_track == "sip".
"""
from __future__ import annotations

import json

from langchain_core.language_models.fake_chat_models import FakeListChatModel

from app.services.ai_scoring.caps import apply_all_caps
from app.services.ai_scoring.runner import score_application


# ─── SIP cap unit tests ─────────────────────────────────────────────


def _scores(**overrides):
    from app.services.ai_scoring.state import (
        SignalScore, Citation, ConfidenceFactors,
    )
    cf = ConfidenceFactors(
        data_completeness=1, evidence_specificity=1,
        internal_consistency=1, verifiability=1, answer_granularity=1,
    )

    def s(signal):
        return SignalScore(
            signal=signal, score=10, rationale="x",
            evidence_citations=[Citation(source="Q1", quote="x")],
            confidence_factors=cf, flags=[],
        )

    base = {
        "problem_impact": s("problem_impact"),
        "completeness": s("completeness"),
        "technical_depth": s("technical_depth"),
        "behavioural": s("behavioural"),
        "commitment": s("commitment"),
    }
    base.update(overrides)
    return base


def _sip_row(**overrides):
    base = {
        "id": "sip-1",
        "basic_full_name": "X",
        "sip_incorporated": "Yes — Pvt Ltd, registered in India",
        "sip_trl": "TRL 5 — pilot-tested in a relevant environment",
        "sip_traction": "Paying pilots — customers have paid for early access",
        # Keep total long-text well over the C5 200-char floor so C5 doesn't
        # fire and confound the SIP-cap assertions.
        "problem_describe": "A long enough problem statement that clears the cap. " * 6,
        "solution_describe": "A detailed solution description that adds bulk. " * 4,
        "solution_core_tech": "Core technology described at length here too. " * 4,
    }
    base.update(overrides)
    return base


def test_sip_cap_fires_for_pre_incorporation():
    row = _sip_row(sip_incorporated="Not yet — we're still pre-incorporation")
    capped, events = apply_all_caps(row, _scores(), resume_meta=None, track="sip")
    assert any(e.rule_id == "SIP1" for e in events)
    assert capped["completeness"].score == 5
    assert capped["behavioural"].score == 5


def test_sip_cap_fires_for_early_trl():
    row = _sip_row(sip_trl="TRL 3 or earlier — research stage")
    capped, events = apply_all_caps(row, _scores(), resume_meta=None, track="sip")
    assert any(e.rule_id == "SIP1" for e in events)


def test_sip_cap_silent_for_mature_sip_row():
    row = _sip_row()
    capped, events = apply_all_caps(row, _scores(), resume_meta=None, track="sip")
    assert not any(e.rule_id == "SIP1" for e in events)
    assert capped["completeness"].score == 10


def test_sip_cap_does_not_run_for_tir_track():
    # A row that would trip the SIP cap must NOT fire it when track defaults
    # to TIR — the rule is gated on track.
    row = _sip_row(sip_incorporated="Not yet — we're still pre-incorporation")
    _, events = apply_all_caps(row, _scores(), resume_meta=None)
    assert not any(e.rule_id == "SIP1" for e in events)


# ─── SIP runner end-to-end smoke ────────────────────────────────────


def _scripted_llm():
    combined = {
        sig: {
            "signal": sig, "score": 7, "rationale": "x",
            "evidence_citations": [{"source": "Q1", "quote": "x"}],
            "confidence_factors": {
                "data_completeness": 0.9, "evidence_specificity": 0.9,
                "internal_consistency": 0.9, "verifiability": 0.9,
                "answer_granularity": 0.9,
            },
            "flags": [],
        }
        for sig in ("problem_impact", "completeness", "technical_depth",
                    "behavioural", "commitment")
    }
    synth = {
        "verdict": "This is a STRONG application for the SIP Track at ARTPARK.",
        "top_strength": (
            "Paying pilots show genuine traction; customers have paid for early "
            "access which de-risks the go-to-market and validates the wedge."
        ),
        "top_concern": (
            "Execution milestones need clearer dependencies and a staffing plan "
            "before the next pilot phase to hit the stated commercial targets."
        ),
        "program_fit": (
            "ARTPARK's pilot-customer network and compute infrastructure map "
            "directly onto the stated milestones and the early-revenue motion."
        ),
        "recommendation": "ACCEPT within 14 days pending reference checks.",
    }
    return FakeListChatModel(responses=[
        json.dumps({
            "basic": {"name": "REDACTED", "org": "SIP Co", "degree": "PhD"},
            "problem": {"describe": "x", "defined": "Yes"},
            "solution": {"describe": "x", "core_tech": "x",
                         "contrarian_insight": None, "stage": None},
            "execution": {"will_break": "x", "milestone": "x",
                          "infrastructure": "x", "failure": None,
                          "hwsw_integration": None},
            "evidence_assets": {"file_count": 0, "file_names": [],
                                "video_url_present": False},
            "resume": None,
            "derived": {"has_10x": False, "has_baseline_number": False,
                        "has_patent_keyword": False, "problem_word_count": 30},
        }),
        json.dumps(combined),
        json.dumps(synth), json.dumps(synth),
        json.dumps(synth), json.dumps(synth),
    ])


class _FakeSupabase:
    """Track-aware fake — serves the row only from sip_applications."""

    def __init__(self, sip_row):
        self.sip_row = sip_row
        self.upsert_calls = []

    def table(self, name):
        self._last = name
        return self

    def select(self, *_):
        return self

    def eq(self, *_, **__):
        return self

    def limit(self, *_):
        return self

    def execute(self):
        if self._last == "sip_applications":
            return type("R", (), {"data": [self.sip_row]})()
        return type("R", (), {"data": []})()

    def upsert(self, payload, on_conflict=None):
        self.upsert_calls.append(payload)
        return self


def test_sip_scores_end_to_end_and_persists():
    sip_row = _sip_row(
        sip_incorporated="Not yet — we're still pre-incorporation",
        user_id="u-1",
    )
    client = _FakeSupabase(sip_row)
    result = score_application(
        application_id="sip-1", track="sip",
        supabase=client, llm=_scripted_llm(),
    )

    assert result["composite_percentage"] > 0
    assert result["summary_round_1"] is not None
    assert len(client.upsert_calls) == 1
    payload = client.upsert_calls[0]
    assert payload["application_id"] == "sip-1"
    assert payload["application_track"] == "sip"
    # The pre-incorporation SIP cap should have flagged human review.
    assert payload["flags"]["needs_human_review"] is True
    assert any(
        ce["rule_id"] == "SIP1" for ce in payload["flags"]["cap_events"]
    )
