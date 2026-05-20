"""Persist ScoringState to ai_screening row.

Maps the in-memory signal names onto the existing ai_screening columns:
  problem_impact   → score_problem
  completeness     → score_completeness   (renamed from score_solution in 016)
  technical_depth  → score_tech
  behavioural      → score_founders       (existing legacy column name)
  commitment       → score_commitment
  composite (×100) → score_overall
"""
from __future__ import annotations

import json
from datetime import datetime, timezone


_SIGNAL_TO_COLUMN = {
    "problem_impact":  "score_problem",
    "completeness":    "score_completeness",
    "technical_depth": "score_tech",
    "behavioural":     "score_founders",
    "commitment":      "score_commitment",
}


def persist_score(client, state: dict) -> None:
    """Upsert one ai_screening row from the final graph state.

    Uses on_conflict=application_id,application_track so a re-run
    replaces the prior row (UNIQUE(application_id, application_track)
    per migration 014).
    """
    payload: dict = {
        "application_id": state["application_id"],
        "application_track": state["track"],
    }

    # Per-signal scores
    for signal, column in _SIGNAL_TO_COLUMN.items():
        slot = f"score_{signal}"
        if state.get(slot) is not None:
            payload[column] = state[slot].score

    payload["score_overall"] = state.get("composite_percentage")
    payload["confidence"]    = state.get("confidence_overall")

    # Summary as JSON-encoded text
    if state.get("summary_round_1") is not None:
        payload["summary"] = json.dumps(state["summary_round_1"].model_dump())

    # Flags JSONB: confidence factors + cap events + needs-human-review
    cap_events = state.get("caps_applied", [])
    payload["flags"] = {
        "cap_events": [e.model_dump(mode="json") for e in cap_events],
        "needs_human_review": bool(state.get("qg_needs_human_review", False)),
        "qg_last_failures": state.get("qg_last_failures", []),
    }

    payload["model"]   = state.get("model", "unknown")
    payload["ran_at"]  = datetime.now(timezone.utc).isoformat()
    payload["error"]   = None

    client.table("ai_screening").upsert(
        payload,
        on_conflict="application_id,application_track",
    ).execute()
