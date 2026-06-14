"""Pass 3a — LangGraph node wrapping caps.apply_all_caps."""
from __future__ import annotations

from ..caps import apply_all_caps


_SIGNAL_NAMES = ("problem_impact", "completeness", "technical_depth",
                 "behavioural", "commitment")


def run(state: dict) -> dict:
    """Read pre-cap scores from state, run all cap rules, write back.

    Threads `track` so the PROVISIONAL_V0 SIP cap (rule_sip_preincorp) only
    runs for SIP rows; TIR is byte-identical (track defaults to "tir").
    """
    pre_cap = {name: state[f"score_{name}"] for name in _SIGNAL_NAMES}
    capped, events = apply_all_caps(
        application_row=state["application_row"],
        scores=pre_cap,
        resume_meta=state.get("resume_meta"),
        track=state.get("track", "tir"),
    )
    delta = {f"score_{name}": capped[name] for name in _SIGNAL_NAMES}
    delta["caps_applied"] = events
    # PROVISIONAL_V0 — a SIP maturity cap flags for human review. Recorded as a
    # separate key so the quality-gate path stays untouched; persistence ORs it
    # into needs_human_review.
    if any(e.rule_id == "SIP1" for e in events):
        delta["caps_needs_human_review"] = True
    return delta
