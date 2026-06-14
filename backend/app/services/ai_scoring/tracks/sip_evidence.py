"""PROVISIONAL_V0 — SIP evidence assembly seam.

The SIP track currently reuses the TIR scoring graph + prompts as a
provisional baseline (per product direction 2026-06: "the logic is not yet
different — take inspiration from the TIR scoring and the SIP wizard, and at
least have a detailed skeleton and the workflow"). This module assembles the
SIP-salient signals from a sip_applications row into block form so the
generic extract_evidence prompt sees them clearly — most importantly
*traction*, which has no TIR analogue.

EVERYTHING here is a placeholder skeleton. The prompts, the block layout,
and which columns map to which signal WILL be revised once the SIP rubric is
final. Do not treat the field groupings below as a committed contract.

SIP column reference (app/models/sip_application.py):
    company facts : sip_incorporated, sip_trl, basic_dpiit_registered,
                    basic_dpiit_recognition_number, sip_founders
    problem       : problem_describe
    solution      : solution_describe, solution_core_tech,
                    solution_contrarian_insight
    traction      : sip_traction, sip_traction_details
    execution     : execution_milestone, execution_infrastructure,
                    execution_will_break, execution_failure
"""
from __future__ import annotations

from typing import Any


def _present(value: Any) -> bool:
    """True if a value carries signal (non-empty after strip for strings)."""
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    return bool(value)


def sip_application_evidence(app_row: dict) -> dict:
    """Assemble SIP-salient evidence blocks from a sip_applications row.

    Returns a dict of named blocks the LLM can read alongside the raw row.
    Pure + defensive: every field is read via .get() so a missing SIP column
    degrades to None rather than raising. TIR rows are never passed here.

    PROVISIONAL_V0 — block names, groupings, and emphasis are placeholders.
    """
    # PROVISIONAL_V0 — company facts (incorporation / TRL / DPIIT / cap table).
    company_facts = {
        "incorporated": app_row.get("sip_incorporated"),
        "trl": app_row.get("sip_trl"),
        "dpiit_registered": app_row.get("basic_dpiit_registered"),
        "dpiit_recognition_number": app_row.get("basic_dpiit_recognition_number"),
        "founder_count": len(app_row.get("sip_founders") or []),
    }

    # PROVISIONAL_V0 — problem statement (shared column with TIR).
    problem = {
        "describe": app_row.get("problem_describe"),
    }

    # PROVISIONAL_V0 — solution + core tech (shared columns with TIR).
    solution = {
        "describe": app_row.get("solution_describe"),
        "core_tech": app_row.get("solution_core_tech"),
        "contrarian_insight": app_row.get("solution_contrarian_insight"),
    }

    # PROVISIONAL_V0 — traction is the SIP-specific signal with no TIR analogue.
    # Surfaced as its own block so the scorer weights it explicitly later.
    traction = {
        "stage": app_row.get("sip_traction"),
        "details": app_row.get("sip_traction_details"),
        "has_evidence_files": _present(app_row.get("sip_traction_files")),
    }

    # PROVISIONAL_V0 — execution plan (shared columns with TIR).
    execution = {
        "milestone": app_row.get("execution_milestone"),
        "infrastructure": app_row.get("execution_infrastructure"),
        "will_break": app_row.get("execution_will_break"),
        "failure": app_row.get("execution_failure"),
    }

    return {
        # PROVISIONAL_V0 — top-level shape is a placeholder skeleton.
        "company_facts": company_facts,
        "problem": problem,
        "solution": solution,
        "traction": traction,
        "execution": execution,
    }
