"""7 TIR cap rules from spec §5, plus 1 provisional SIP rule (rule_sip_preincorp / SIP1).

Each rule is a pure function (application_row, scores, resume_meta) →
(maybe-CapEvent, signal-name-and-cap-value-tuple-or-None). The dispatcher
runs all applicable rules and applies the minimum of all caps that fire per signal.
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


# ─── PROVISIONAL_V0 — SIP-only cap ───────────────────────────────────────
# The 7 TIR rules above all no-op cleanly on SIP rows: every TIR-specific
# column they read (solution_stage, problem_defined, evidence_*) is absent
# from sip_applications, so .get() → None → the guard returns None. C1/C3/C5/
# C7 read columns SHARED with SIP (basic_incubator_*, solution_core_tech,
# the long-text fields) and apply identically — that is intended.
#
# This single provisional rule is the SIP skeleton: a pre-incorporation
# company OR very-early TRL (≤3) caps overall maturity and flags for human
# review. It is a PLACEHOLDER — the real SIP rubric will replace it.

_SIP_PREINCORP = "Not yet — we're still pre-incorporation"
_SIP_TRL3 = "TRL 3 or earlier — research stage"


def rule_sip_preincorp(row, scores, resume_meta):
    """PROVISIONAL_V0 — cap completeness + behavioural at 5 for pre-incorporation
    or TRL≤3 SIP applications, and flag for human review.

    Only invoked when track == "sip" (threaded by apply_all_caps). Reads the
    sip_* columns directly off the application_row.
    """
    incorporated = row.get("sip_incorporated")
    trl = row.get("sip_trl")
    pre_incorp = incorporated == _SIP_PREINCORP
    early_trl = trl == _SIP_TRL3
    if not (pre_incorp or early_trl):
        return None
    reason = []
    if pre_incorp:
        reason.append("pre-incorporation")
    if early_trl:
        reason.append("TRL≤3")
    return (["completeness", "behavioural"], 5,
            f"SIP maturity gate: {', '.join(reason)} "
            f"(incorporated={incorporated!r}, trl={trl!r})",
            "sip_preincorp_or_early_trl", "SIP1")


def apply_all_caps(
    application_row: dict,
    scores: dict[str, SignalScore],
    resume_meta: dict | None,
    track: str = "tir",
) -> tuple[dict[str, SignalScore], list[CapEvent]]:
    """Run all cap rules; return (capped_scores, fired_events).

    Caps stack via min(): if two rules cap the same signal, the lower
    cap wins. This matches spec §5.

    `track` defaults to "tir" so existing callers/tests are byte-identical;
    when track == "sip" the PROVISIONAL_V0 SIP rule is appended.
    """
    events: list[CapEvent] = []
    # signal_name → tightest cap that fired
    tightest: dict[str, int] = {}

    rules = ALL_RULES
    if track == "sip":
        rules = ALL_RULES + (rule_sip_preincorp,)  # PROVISIONAL_V0

    for rule in rules:
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
