"""Presenter for GET /reviewer/applications/{track}/{id}/content (spec §4.3).

Maps tir_applications / sip_applications rows into the shape the Reviewer
Portal renders: {aiSummary, fields[], sections[], attachments[]}.

Formatting contract (REVIEWER_BACKEND_HANDOFF.md §2.3):
  * long answers   -> {"label", "bullets": [<= 1 sentence each]}
  * short facts    -> {"label", "value", "short": true}
  * None/empty     -> omitted entirely
The field maps below are the single source of truth — when a wizard question
is added, add one row here and the UI needs no change.
"""

from __future__ import annotations

import re

# (label, column, kind) — kind: "fact" | "long"
TIR_FIELD_MAP: list[tuple[str, str, str]] = [
    ("Problem defined",              "problem_defined",             "fact"),
    ("Problem description",          "problem_describe",            "long"),
    ("Solution stage",               "solution_stage",              "fact"),
    ("Solution description",         "solution_describe",           "long"),
    ("Solution core tech",           "solution_core_tech",          "long"),
    ("Solution contrarian insight",  "solution_contrarian_insight", "long"),
    ("Execution milestone",          "execution_milestone",         "long"),
    ("Execution infrastructure",     "execution_infrastructure",    "long"),
    ("What will break first",        "execution_will_break",        "long"),
    ("Demo video URL",               "evidence_video_url",          "fact"),
]

SIP_FIELD_MAP: list[tuple[str, str, str]] = [
    ("Incorporated",                 "sip_incorporated",            "fact"),
    ("Technology readiness (TRL)",   "sip_trl",                     "fact"),
    ("Traction",                     "sip_traction",                "fact"),
    ("Traction details",             "sip_traction_details",        "long"),
    ("DPIIT recognised",             "basic_dpiit_registered",      "fact"),
    ("Problem description",          "problem_describe",            "long"),
    ("Solution description",         "solution_describe",           "long"),
    ("Solution core tech",           "solution_core_tech",          "long"),
    ("Solution contrarian insight",  "solution_contrarian_insight", "long"),
    ("Execution milestone",          "execution_milestone",         "long"),
    ("Execution infrastructure",     "execution_infrastructure",    "long"),
    ("What will break first",        "execution_will_break",        "long"),
]

# Section layout: (num, title, [(prompt, column), ...]) — mirrors the wizard.
TIR_SECTIONS: list[tuple[str, str, list[tuple[str, str]]]] = [
    ("01", "Basic details", [
        ("Full name",                       "basic_full_name"),
        ("Phone",                           "basic_phone"),
        ("Email",                           "basic_email"),
        ("Organisation",                    "basic_org"),
        ("Degree",                          "basic_degree"),
        ("Do you have co-founders?",        "basic_has_team"),
        ("Incubator association",           "basic_incubator_association"),
        ("How did you hear about ARTPARK?", "basic_hear_about"),
    ]),
    ("02", "Problem & importance", [
        ("Is the problem well defined?",    "problem_defined"),
        ("Describe the problem",            "problem_describe"),
    ]),
    ("03", "Your solution", [
        ("Describe your solution",          "solution_describe"),
        ("Core technology",                 "solution_core_tech"),
        ("Contrarian insight",              "solution_contrarian_insight"),
    ]),
    ("04", "Execution plan", [
        ("Current stage",                   "solution_stage"),
        ("Critical milestone",              "execution_milestone"),
        ("Infrastructure needed",           "execution_infrastructure"),
        ("What will break first",           "execution_will_break"),
    ]),
    ("05", "Evidence", [
        ("Demo video URL",                  "evidence_video_url"),
    ]),
    ("06", "Declaration", [
        ("Information is truthful",         "declaration_truthful"),
        ("Consent to reference checks",     "declaration_ref_checks"),
        ("Accepted terms",                  "declaration_terms"),
    ]),
]

SIP_SECTIONS: list[tuple[str, str, list[tuple[str, str]]]] = [
    ("01", "Basic details", [
        ("Full name",                       "basic_full_name"),
        ("Phone",                           "basic_phone"),
        ("Email",                           "basic_email"),
        ("Company",                         "basic_org"),
        ("Incorporated",                    "sip_incorporated"),
        ("TRL",                             "sip_trl"),
        ("DPIIT recognised",                "basic_dpiit_registered"),
        ("DPIIT recognition number",        "basic_dpiit_recognition_number"),
    ]),
    ("02", "Problem & importance", [
        ("Describe the problem",            "problem_describe"),
    ]),
    ("03", "Solution & traction", [
        ("Describe your solution",          "solution_describe"),
        ("Core technology",                 "solution_core_tech"),
        ("Contrarian insight",              "solution_contrarian_insight"),
        ("Traction level",                  "sip_traction"),
        ("Traction details",                "sip_traction_details"),
    ]),
    ("04", "Execution plan", [
        ("Critical milestone",              "execution_milestone"),
        ("Infrastructure needed",           "execution_infrastructure"),
        ("What will break first",           "execution_will_break"),
    ]),
    ("05", "Evidence", [
        ("Demo video URL",                  "sip_demo_video_url"),
    ]),
    ("06", "Declaration", [
        ("Information is truthful",         "declaration_truthful"),
        ("Consent to reference checks",     "declaration_ref_checks"),
        ("Accepted terms",                  "declaration_terms"),
    ]),
]

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z₹\"'(])")
_BULLET_MARKERS = re.compile(r"\s*[•·]\s*")

# Common abbreviations whose trailing period must NOT trigger a sentence split.
# Checked case-insensitively against the last word of the preceding bullet
# (with its trailing period stripped before lookup).
_ABBREVS = {
    "dr", "mr", "mrs", "ms", "prof", "st", "sr", "jr",
    "vs", "etc", "eg", "ie", "no", "inc", "ltd", "pvt", "co",
}


def _merge_abbrev(parts: list[str]) -> list[str]:
    """Re-join a bullet onto the previous one when that previous bullet ended
    with a known abbreviation token (e.g. "Dr.", "Prof.", "St.")."""
    out: list[str] = []
    for p in parts:
        if out:
            last_word = out[-1].rsplit(None, 1)[-1] if out[-1] else ""
            if last_word.rstrip(".").lower() in _ABBREVS and out[-1].endswith("."):
                out[-1] = out[-1] + " " + p
                continue
        out.append(p)
    return out


def sentence_bullets(text: str) -> list[str]:
    """One-sentence bullets per handoff §2.3 (mirrors the prototype's fieldBullets)."""
    text = (text or "").strip()
    if not text:
        return []
    if "•" in text or "·" in text:
        return [p.strip() for p in _BULLET_MARKERS.split(text) if p.strip()]
    parts = [p.strip() for p in _SENTENCE_SPLIT.split(text) if p.strip()]
    return _merge_abbrev(parts)


def _is_fact(value: str) -> bool:
    return len(value) <= 48 and not any(c in value for c in ".!?")


def build_fields(row: dict, field_map: list[tuple[str, str, str]]) -> list[dict]:
    out: list[dict] = []
    for label, col, kind in field_map:
        raw = row.get(col)
        if raw is None or (isinstance(raw, str) and not raw.strip()):
            continue
        value = str(raw).strip()
        if kind == "fact" or _is_fact(value):
            out.append({"label": label, "value": value, "short": True})
        else:
            out.append({"label": label, "bullets": sentence_bullets(value)})
    return out


def build_sections(row: dict, track: str) -> list[dict]:
    layout = TIR_SECTIONS if track == "tir" else SIP_SECTIONS
    sections: list[dict] = []
    for num, title, questions in layout:
        qs = []
        for prompt, col in questions:
            raw = row.get(col)
            if raw is None or raw == "" or raw == []:
                continue
            if isinstance(raw, bool):
                answer = "Yes" if raw else "No"
            else:
                answer = str(raw)
            qs.append({"prompt": prompt, "answer": answer, "type": "text"})
        sections.append({"num": num, "title": title, "questions": qs})
    return sections


def collect_attachment_paths(row: dict, track: str) -> list[dict]:
    """Returns [{kind, name, storage_path, bucket}] — signing happens in the router
    (reuses the leadership signed-URL flow).

    Key asymmetry (deliberate — matches the DB jsonb shapes):
      - TIR evidence_files store the path under "storage_path"
      - SIP files (pitch deck, traction, patents) store it under "path"
    Do not normalise these: the jsonb schemas are fixed in the migrations.
    """
    out: list[dict] = []
    if track == "sip":
        deck = row.get("sip_pitch_deck")
        if isinstance(deck, dict) and deck.get("path"):
            out.append({"kind": "deck", "name": deck.get("name") or "pitch-deck",
                        "storage_path": deck["path"], "bucket": "sip-evidence-files"})
        for f in (row.get("sip_traction_files") or []):
            if isinstance(f, dict) and f.get("path"):
                out.append({"kind": "traction", "name": f.get("name") or "traction",
                            "storage_path": f["path"], "bucket": "sip-evidence-files"})
        for f in (row.get("sip_patents_files") or []):
            if isinstance(f, dict) and f.get("path"):
                out.append({"kind": "patent", "name": f.get("name") or "patent",
                            "storage_path": f["path"], "bucket": "sip-evidence-files"})
    else:
        for f in (row.get("evidence_files") or []):
            if isinstance(f, dict) and f.get("storage_path"):
                out.append({"kind": "evidence", "name": f.get("name") or "evidence",
                            "storage_path": f["storage_path"], "bucket": "tir-evidence-files"})
        for f in (row.get("execution_milestone_files") or []):
            path = (f or {}).get("path") or (f or {}).get("storage_path")
            if path:
                out.append({"kind": "milestone", "name": f.get("name") or "milestone",
                            "storage_path": path, "bucket": "tir-milestone-files"})
    return out
