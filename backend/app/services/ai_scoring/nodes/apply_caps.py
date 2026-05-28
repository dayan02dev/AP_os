"""Pass 3a — LangGraph node wrapping caps.apply_all_caps."""
from __future__ import annotations

from ..caps import apply_all_caps


_SIGNAL_NAMES = ("problem_impact", "completeness", "technical_depth",
                 "behavioural", "commitment")


def run(state: dict) -> dict:
    """Read pre-cap scores from state, run all 7 cap rules, write back."""
    pre_cap = {name: state[f"score_{name}"] for name in _SIGNAL_NAMES}
    capped, events = apply_all_caps(
        application_row=state["application_row"],
        scores=pre_cap,
        resume_meta=state.get("resume_meta"),
    )
    delta = {f"score_{name}": capped[name] for name in _SIGNAL_NAMES}
    delta["caps_applied"] = events
    return delta
