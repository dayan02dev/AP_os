"""The 7 deterministic cap rules from spec §5.

Each rule is a pure function (application_row, scores, resume_meta) →
(maybe-CapEvent, signal-name-and-cap-value-tuple-or-None). The dispatcher
runs all 7 and applies the minimum of all caps that fire per signal.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from .state import CapEvent, SignalScore

_PROD_STAGES = {"Prototype built", "Pilot-ready product",
                "Deployed in real setting with real users"}

# C7 regex: "10x", "10×", "10 x", "10 X" — captures the position.
_10X_RE = re.compile(r"\b10\s*[xX×](?!\w)")
# Numeric baseline near the 10× claim (within ~150 chars).
_NUMERIC_RE = re.compile(r"\d+(?:\.\d+)?[\s\-]*[a-z%]+", re.IGNORECASE)


# ─── Individual rules (each returns None or (signals, new_cap_value, snippet, flag)) ───


def _has_resolution_language(text: str | None) -> bool:
    if not text:
        return False
    needles = ("no ongoing", "completed", "no longer", "concluded", "ended",
              "exited", "no current", "no active", "resolved")
    lower = text.lower()
    return any(n in lower for n in needles)


def rule_c1(row, scores, resume_meta):
    if row.get("basic_incubator_association") != "Yes":
        return None
    if _has_resolution_language(row.get("basic_incubator_details")):
        return None
    return (["commitment"], 3,
            row.get("basic_incubator_details") or "(no details given)",
            "c1_unresolved_incubator", "C1")


def rule_c2(row, scores, resume_meta):
    if row.get("solution_stage") != "Deployed in real setting with real users":
        return None
    has_files = bool(row.get("evidence_files"))
    has_video = bool(row.get("evidence_video_url"))
    if has_files or has_video:
        return None
    return (["technical_depth"], 4,
            "Deployed claimed, no evidence_files or evidence_video_url",
            "c2_deployed_no_evidence", "C2")


def rule_c3(row, scores, resume_meta):
    core = row.get("solution_core_tech") or ""
    if not re.search(r"\bpatent", core, re.IGNORECASE):
        return None
    if row.get("evidence_files"):
        return None
    return (["technical_depth"], 6,
            core[:200],
            "c3_patent_no_file", "C3")


def rule_c5(row, scores, resume_meta):
    long_text_fields = (
        "problem_describe", "solution_describe", "solution_core_tech",
        "solution_contrarian_insight", "execution_will_break",
        "execution_milestone", "execution_infrastructure",
        "execution_failure", "execution_hwsw_integration",
    )
    total_chars = sum(len(row.get(f) or "") for f in long_text_fields)
    if total_chars >= 200:
        return None
    return (["completeness"], 2,
            f"Total long-text chars: {total_chars}",
            "c5_minimal_application", "C5")


def rule_c6(row, scores, resume_meta):
    if row.get("solution_stage") not in _PROD_STAGES:
        return None
    has_files = bool(row.get("evidence_files"))
    has_video = bool(row.get("evidence_video_url"))
    has_resume = resume_meta is not None and resume_meta.get("parsed_data")
    if has_files or has_video or has_resume:
        return None
    return (["technical_depth", "behavioural"], 4,
            f"Stage={row.get('solution_stage')} but no artefact or CV",
            "c6_prototype_no_artefact", "C6")


def rule_c7(row, scores, resume_meta):
    """Cap technical_depth at 7 if a 10× claim has no nearby numeric baseline."""
    for field in ("solution_describe", "solution_core_tech"):
        text = row.get(field) or ""
        for m in _10X_RE.finditer(text):
            start, end = max(0, m.start() - 150), min(len(text), m.end() + 150)
            window = text[start:end]
            # Remove the 10× token itself before searching for baseline
            window_minus_token = window.replace(m.group(), "")
            if _NUMERIC_RE.search(window_minus_token):
                return None      # baseline found near this 10×; OK
            # No baseline near this 10× — cap
            return (["technical_depth"], 7,
                    text[max(0, m.start() - 30):m.end() + 30],
                    "c7_10x_no_baseline", "C7")
    return None


def rule_c9(row, scores, resume_meta):
    if row.get("problem_defined") != "Yes":
        return None
    problem = row.get("problem_describe") or ""
    word_count = len(problem.split())
    if word_count >= 80:
        return None
    return (["behavioural"], 5,
            f"problem_defined=Yes but problem_describe has only {word_count} words",
            "c9_claimed_clarity_short_problem", "C9")


ALL_RULES = (rule_c1, rule_c2, rule_c3, rule_c5, rule_c6, rule_c7, rule_c9)


def apply_all_caps(
    application_row: dict,
    scores: dict[str, SignalScore],
    resume_meta: dict | None,
) -> tuple[dict[str, SignalScore], list[CapEvent]]:
    """Run all 7 rules; return (capped_scores, fired_events).

    Caps stack via min(): if two rules cap the same signal, the lower
    cap wins. This matches spec §5.
    """
    events: list[CapEvent] = []
    # signal_name → tightest cap that fired
    tightest: dict[str, int] = {}

    for rule in ALL_RULES:
        result = rule(application_row, scores, resume_meta)
        if result is None:
            continue
        signals, cap_value, snippet, flag, rule_id = result
        events.append(CapEvent(
            rule_id=rule_id,
            triggered_at=datetime.now(timezone.utc),
            signal_capped=signals,
            cap_value=cap_value,
            evidence_snippet=snippet,
            flag=flag,
        ))
        for s in signals:
            tightest[s] = min(tightest.get(s, 10), cap_value)

    capped = {}
    for name, score_obj in scores.items():
        ceiling = tightest.get(name, 10)
        if score_obj.score > ceiling:
            capped[name] = score_obj.model_copy(update={"score": ceiling})
        else:
            capped[name] = score_obj

    return capped, events
