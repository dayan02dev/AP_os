"""Flatten an application row (TIR or VIP/SIP) into one text block for the LLM.

Contact PII (name/phone/email) is omitted; org is kept. Only fields with
content are included. Shared fields cover both tracks; sip_* fields are added
for the VIP track.
"""
from __future__ import annotations

# (label, column) pairs shared by both tracks, in reading order.
_SHARED = [
    ("Organisation", "basic_org_name"),
    ("Organisation", "basic_org"),
    ("Degree", "basic_degree"),
    ("Team", "basic_teammates"),
    ("Incubator", "basic_incubator_details"),
    ("Problem", "problem_describe"),
    ("Problem well-defined", "problem_defined"),
    ("Solution", "solution_describe"),
    ("Core technology", "solution_core_tech"),
    ("Contrarian insight", "solution_contrarian_insight"),
    ("Stage", "solution_stage"),
    ("What could break", "execution_will_break"),
    ("Milestone plan", "execution_milestone"),
    ("Infrastructure ask", "execution_infrastructure"),
    ("HW/SW integration", "execution_hwsw_integration"),
    ("Evidence video", "evidence_video_url"),
]

# VIP-only fields appended after the shared block.
_SIP = [
    ("Incorporated", "sip_incorporated"),
    ("TRL", "sip_trl"),
    ("Founders", "sip_founders"),
    ("Traction", "sip_traction"),
    ("Traction details", "sip_traction_details"),
    ("DPIIT registered", "basic_dpiit_registered"),
]


def _fmt(value) -> str:
    if isinstance(value, (list, dict)):
        import json
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def build_app_text(app_row: dict, track: str) -> str:
    fields = list(_SHARED)
    if track == "sip":
        fields = fields + _SIP
    seen: set[str] = set()
    parts: list[str] = []
    for label, col in fields:
        if label in seen:
            continue  # e.g. two "Organisation" columns — take the first present
        value = app_row.get(col)
        if value in (None, "", [], {}):
            continue
        parts.append(f"{label}: {_fmt(value)}")
        seen.add(label)
    return "\n\n".join(parts) if parts else "No application details provided."
