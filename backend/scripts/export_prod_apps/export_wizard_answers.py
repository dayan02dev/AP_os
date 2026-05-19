"""Export wizard answers from every submitted application into one Excel file.

No file downloads, no auxiliary tables — just the Q&A from the wizard
forms. Output is a single .xlsx with three sheets:

    Index               quick lookup (display id, founder, email, track, status, submitted)
    TIR Applications    one row per submitted TIR app, columns = wizard fields
    SIP Applications    one row per submitted SIP app, columns = wizard fields

Internal columns (id, user_id, created_at, updated_at, completion_pct,
current_section, status) and file-ref JSONB columns are excluded so the
sheet is just the human answers.

Usage:
    cd backend
    source .venv/bin/activate
    pip install openpyxl    # if not already installed

    SUPABASE_URL=<prod-url> \
    SUPABASE_SERVICE_ROLE_KEY=<prod-service-role> \
    OUTPUT_PATH=./wizard_answers.xlsx \
    python scripts/export_prod_apps/export_wizard_answers.py

WARNING: this exports REAL applicant PII (emails, phones, free-text
answers). Treat the output file accordingly.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from typing import Any

try:
    from supabase import create_client
except ImportError:
    print(
        "ERROR: supabase-py not installed.\n"
        "  cd backend && source .venv/bin/activate && pip install -r requirements.txt",
        file=sys.stderr,
    )
    sys.exit(2)

try:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
except ImportError:
    print(
        "ERROR: openpyxl not installed.\n"
        "  pip install openpyxl",
        file=sys.stderr,
    )
    sys.exit(2)


# ─── Config ────────────────────────────────────────────────────────────


SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
OUTPUT_PATH = os.environ.get("OUTPUT_PATH", "./wizard_answers.xlsx")
PAGE_SIZE = int(os.environ.get("PAGE_SIZE", "1000"))

if not SUPABASE_URL or not SUPABASE_KEY:
    print(
        "ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n"
        "Set them to the PRODUCTION project's values (not staging).",
        file=sys.stderr,
    )
    sys.exit(2)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("wizard")


# ─── What to exclude from the sheets ───────────────────────────────────


# Internal / non-answer columns. Kept on the Index sheet for context but
# stripped from the per-track answer sheets so they're just Q&A.
_INTERNAL_COLUMNS: set[str] = {
    "id",
    "user_id",
    "created_at",
    "updated_at",
    "current_section",
    "completion_pct",
    # status + submitted_at are interesting; kept on the answer sheets.
}

# File-reference JSONB columns. Their contents are storage paths, not
# answers — they'd just clutter the sheet. The full-export script
# (export.py) handles file downloads; this one stays clean.
_FILE_COLUMNS: set[str] = {
    # TIR
    "evidence_files",
    "video",
    "deck",
    # SIP
    "sip_pitch_deck",
    "sip_cap_table_file",
    "sip_traction_files",
    "sip_patents_files",
    # both
    "execution_milestone_files",
}


# ─── Friendly column names ─────────────────────────────────────────────


# Pretty headers for known columns. Anything not in here renders the raw
# snake_case name, capitalized.
_LABELS: dict[str, str] = {
    # Basic info
    "basic_full_name":            "Full name",
    "basic_phone":                "Phone",
    "basic_email":                "Email",
    "basic_org":                  "Organization",
    "basic_degree":               "Education",
    "basic_incubator_association":"Incubator association?",
    "basic_incubator_details":    "Incubator details",
    "basic_hear_about":           "Where they heard about ARTPARK",
    # SIP-specific basics
    "sip_incorporated":           "Incorporated?",
    "sip_trl":                    "TRL",
    "sip_founders":               "Founders cap table (JSON)",
    # Problem
    "problem_describe":           "Q · Problem description",
    "problem_defined":            "Q · Problem defined",
    # Solution
    "solution_describe":          "Q · Solution description",
    "solution_core_tech":         "Q · Core technology",
    "solution_contrarian_insight":"Q · Contrarian insight",
    "solution_stage":             "Q · Solution stage",
    "solution_executation_will_break":"Q · What will break in execution",
    # Traction (SIP)
    "sip_traction":               "Q · Traction status",
    "sip_traction_details":       "Q · Traction details",
    # Execution
    "execution_milestone":        "Q · Next milestone",
    "execution_infrastructure":   "Q · Infrastructure needs",
    "execution_failure":          "Q · How could this fail",
    "execution_hwsw_integration": "Q · Hardware/software integration",
    "execution_will_break":       "Q · What will break in execution",
    # Team (TIR)
    "team_has_team":              "Has a team?",
    "team_members":               "Team members (JSON)",
    "team_teammates":             "Teammates",
    # Demo (SIP)
    "sip_demo_video_url":         "Demo video URL",
    # Declaration
    "declaration_truthful":       "✓ Truthful declaration",
    "declaration_ref_checks":     "✓ Reference checks allowed",
    "declaration_terms":          "✓ Terms accepted",
    "declaration_newsletter":     "✓ Newsletter opt-in",
    # Metadata
    "status":                     "Status",
    "submitted_at":               "Submitted at",
    "display_id":                 "ID",
    "track":                      "Track",
}


def label_for(col: str) -> str:
    return _LABELS.get(col, col.replace("_", " ").capitalize())


# ─── Display ID (same shape as the leadership dashboard) ──────────────


def compose_display_id(track: str, app_id: str | None) -> str:
    prefix = (track or "?").upper()
    if not app_id:
        return f"{prefix}-?????"
    try:
        n = int(str(app_id).replace("-", "")[:8], 16) % 100_000
        return f"{prefix}-{n:05d}"
    except (ValueError, TypeError):
        return f"{prefix}-{str(app_id)[:5]}"


# ─── Fetch helpers ─────────────────────────────────────────────────────


def paginate(client, table: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    page = 0
    while True:
        start = page * PAGE_SIZE
        end = start + PAGE_SIZE - 1
        try:
            res = client.table(table).select("*").range(start, end).execute()
            rows = res.data or []
        except Exception as exc:
            log.warning("paginate(%s) page=%d failed: %s", table, page, exc)
            break
        out.extend(rows)
        if len(rows) < PAGE_SIZE:
            break
        page += 1
    return out


def cell_value(v: Any) -> Any:
    """Convert a column value into something Excel can store.

    JSONB dicts/lists are pretty-printed JSON strings; booleans become
    'Yes'/'No' for readability; everything else passes through.
    """
    if v is None:
        return None
    if isinstance(v, bool):
        return "Yes" if v else "No"
    if isinstance(v, (dict, list)):
        return json.dumps(v, indent=2, ensure_ascii=False)
    return v


# ─── Sheet writers ─────────────────────────────────────────────────────


def _column_order(rows: list[dict[str, Any]]) -> list[str]:
    """Pick the answer columns from the row union, excluding internal /
    file columns. Stable order: id-ish metadata first, then Q&A in the
    order it first appeared in the rows."""
    seen: list[str] = []
    seen_set: set[str] = set()
    # Pin a few keys first
    for k in ("display_id", "track", "status", "submitted_at",
              "basic_full_name", "basic_email", "basic_org"):
        if k not in seen_set:
            seen.append(k)
            seen_set.add(k)
    # Then everything else from the row union
    for r in rows:
        for k in r.keys():
            if k in seen_set:
                continue
            if k in _INTERNAL_COLUMNS or k in _FILE_COLUMNS:
                continue
            seen.append(k)
            seen_set.add(k)
    return seen


def _write_track_sheet(wb: Workbook, name: str, rows: list[dict[str, Any]]) -> int:
    ws = wb.create_sheet(name)
    if not rows:
        ws.cell(row=1, column=1, value="(no submitted applications)")
        return 0

    cols = _column_order(rows)

    # Header
    for ci, col in enumerate(cols, start=1):
        c = ws.cell(row=1, column=ci, value=label_for(col))
        c.font = Font(bold=True, size=11)
        c.fill = PatternFill("solid", fgColor="EFEFEF")
        c.alignment = Alignment(horizontal="left", vertical="center", wrap_text=False)

    # Rows
    for ri, row in enumerate(rows, start=2):
        for ci, col in enumerate(cols, start=1):
            v = cell_value(row.get(col))
            cell = ws.cell(row=ri, column=ci, value=v)
            cell.alignment = Alignment(vertical="top", wrap_text=True)

    # Freeze the header + first 3 columns (display_id / track / status)
    ws.freeze_panes = "D2"

    # Reasonable column widths. Excel doesn't auto-fit, so we set defaults:
    # narrow for short metadata, wider for free-text Q&A.
    narrow = {"display_id", "track", "status", "submitted_at",
              "basic_degree", "sip_incorporated", "sip_trl"}
    medium = {"basic_full_name", "basic_email", "basic_org", "basic_phone",
              "basic_hear_about", "basic_incubator_association"}
    for ci, col in enumerate(cols, start=1):
        letter = ws.cell(row=1, column=ci).column_letter
        if col in narrow:
            ws.column_dimensions[letter].width = 16
        elif col in medium:
            ws.column_dimensions[letter].width = 28
        else:
            ws.column_dimensions[letter].width = 60  # free-text answer columns

    # Row height — let the wrap_text take effect on the answer rows
    for ri in range(2, len(rows) + 2):
        ws.row_dimensions[ri].height = 45

    return len(rows)


def _write_index_sheet(wb: Workbook, all_rows: list[dict[str, Any]]) -> int:
    ws = wb.create_sheet("Index", 0)  # first sheet
    headers = ["ID", "Track", "Status", "Submitted at",
               "Founder", "Email", "Organization"]
    for ci, h in enumerate(headers, start=1):
        c = ws.cell(row=1, column=ci, value=h)
        c.font = Font(bold=True, size=11)
        c.fill = PatternFill("solid", fgColor="EFEFEF")

    for ri, r in enumerate(all_rows, start=2):
        ws.cell(row=ri, column=1, value=r.get("display_id"))
        ws.cell(row=ri, column=2, value=(r.get("track") or "").upper())
        ws.cell(row=ri, column=3, value=r.get("status"))
        ws.cell(row=ri, column=4, value=r.get("submitted_at"))
        ws.cell(row=ri, column=5, value=r.get("basic_full_name"))
        ws.cell(row=ri, column=6, value=r.get("basic_email"))
        ws.cell(row=ri, column=7, value=r.get("basic_org"))

    ws.freeze_panes = "A2"
    widths = [12, 8, 14, 24, 28, 32, 28]
    for ci, w in enumerate(widths, start=1):
        ws.column_dimensions[ws.cell(row=1, column=ci).column_letter].width = w
    return len(all_rows)


# ─── Main ──────────────────────────────────────────────────────────────


def main() -> int:
    log.info("supabase: %s", SUPABASE_URL)
    log.info("output:   %s", OUTPUT_PATH)

    client = create_client(SUPABASE_URL, SUPABASE_KEY)

    log.info("fetching tir_applications…")
    tir_all = paginate(client, "tir_applications")
    log.info("  %d total rows", len(tir_all))
    tir = [r for r in tir_all if r.get("status") and r.get("status") != "draft"]
    log.info("  %d non-draft (will be exported)", len(tir))
    for r in tir:
        r["track"] = "tir"
        r["display_id"] = compose_display_id("tir", r.get("id"))

    log.info("fetching sip_applications…")
    sip_all = paginate(client, "sip_applications")
    log.info("  %d total rows", len(sip_all))
    sip = [r for r in sip_all if r.get("status") and r.get("status") != "draft"]
    log.info("  %d non-draft (will be exported)", len(sip))
    for r in sip:
        r["track"] = "sip"
        r["display_id"] = compose_display_id("sip", r.get("id"))

    # Combined index — sorted newest-first by submitted_at
    combined = sorted(
        tir + sip,
        key=lambda r: r.get("submitted_at") or r.get("created_at") or "",
        reverse=True,
    )

    log.info("building workbook…")
    wb = Workbook()
    # Drop the default blank sheet
    default = wb.active
    wb.remove(default)

    n_index = _write_index_sheet(wb, combined)
    n_tir = _write_track_sheet(wb, "TIR Applications", tir)
    n_sip = _write_track_sheet(wb, "SIP Applications", sip)

    output_path = os.path.abspath(OUTPUT_PATH)
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    wb.save(output_path)
    log.info("wrote %s: %d index rows, %d TIR, %d SIP",
             output_path, n_index, n_tir, n_sip)
    return 0


if __name__ == "__main__":
    sys.exit(main())
