"""Turn one or more MIS period bundles into a spreadsheet report (spec
§5.7): xlsx via `openpyxl`, csv via the stdlib `csv` module. One sheet per
section, column order taken from `mis_catalog` (never hand-duplicated), the
"startup" scope's single-application report and the "cohort" scope's
one-row-per-startup-per-section report sharing the exact same sheet-building
code -- cohort is not a special case, it is simply `len(bundles) > 1` with a
leading "Startup" column.

Pure/service-level: no DB, no FastAPI, no storage. A caller
(`routers/admin_vip_mis_export.py`) gathers `bundles` via
`admin_vip_query.fetch_mis_period` (itself a thin wrapper over
`mis_query.period_bundle` -- reused, not re-derived) and hands them here.

Derived, never stored, ruling extended to reporting: `vs Last Mo`,
`Gap` and `Net Change` are real, useful report columns -- the "derive,
never persist" constraint is about the database, not about what a founder
or ARTPARK admin gets to read. Every one of those three columns here is
read straight from the bundle's own `derived` block (`mis_query._derived`'s
output), never recomputed a second way and never sourced from a stored
column that constraint forbids populating in the first place.
"""
from __future__ import annotations

import csv
import io
from dataclasses import dataclass, field
from typing import Any

from openpyxl import Workbook

from . import mis_catalog as cat

_KINDS = set(cat.KINDS)
_SCOPES = {"startup", "cohort"}


@dataclass
class SheetSpec:
    name: str
    headers: list[str]
    rows: list[list[Any]] = field(default_factory=list)


# ── sheet name hygiene (xlsx: <=31 chars, unique, no reserved chars) ──────

_INVALID_SHEET_CHARS = set('[]:*?/\\')


def _sheet_title(name: str) -> str:
    cleaned = "".join(c for c in name if c not in _INVALID_SHEET_CHARS)
    return cleaned[:31] or "Sheet"


def _entries_sections_for_kind(kind: str) -> list[str]:
    """Same union `founder_mis.py`'s own `_entries_sections_for_kind` /
    `mis_query.py`'s own private twin compute -- reimplemented here rather
    than imported (both of those live in modules with their own layering
    reasons not to import from a service the export module doesn't
    otherwise depend on; this is the same small-guard-copied-across-a-
    module-boundary precedent `founder_mis.require_vip` already sets)."""
    ids: list[str] = []
    for s in cat.SECTIONS[kind]:
        if s["type"] == "entries":
            ids.append(s["id"])
            ids.extend(cat.SECTION_EXTRA_ENTRIES.get(s["id"], []))
    return ids


# Short, sheet-name-friendly labels for each entries section -- deliberately
# NOT `mis_catalog` section titles (those are UI headings, e.g. "Technical,
# Product & Regulatory Milestones" for id "milestones", far past xlsx's
# 31-char sheet-name cap and not the label a report reader would expect on
# a tab). `next_milestones` has no `SECTIONS` row of its own at all (it
# hangs off "planned_vs_actual" via `SECTION_EXTRA_ENTRIES` -- mis_catalog's
# own documented convention), so every entries section gets its name from
# this map rather than mixing two different sourcing rules.
_ENTRIES_SHEET_NAMES: dict[str, str] = {
    "milestones": "Milestones",
    "risks": "Risks",
    "asks": "Asks",
    "ip_assets": "IP Register",
    "collaborations": "Collaborations",
    "publications": "Publications",
    "products": "Products",
    "funding": "Funding",
    "planned_vs_actual": "Planned vs Actual",
    "next_milestones": "Next Milestones",
}


def _entries_sheet_name(kind: str, section_id: str) -> str:
    return _ENTRIES_SHEET_NAMES.get(section_id, section_id.replace("_", " ").title())


# ── Key Metrics (monthly) ─────────────────────────────────────────────────

_METRIC_GROUP_LABEL = {g["key"]: g["label"] for g in cat.METRIC_GROUPS}


def _metrics_sheet(bundles: list[dict], scope: str) -> SheetSpec:
    headers = ["Metric", "Group", "Unit", "Target", "Actual", "vs Last Mo", "Commentary"]
    if scope == "cohort":
        headers = ["Startup", *headers]
    rows: list[list[Any]] = []
    for b in bundles:
        vs_last = b.get("derived", {}).get("metrics", {}).get("vs_last", {})
        for m in b.get("metrics", []):
            row = [
                m.get("label"), _METRIC_GROUP_LABEL.get(m.get("group_key"), m.get("group_key")),
                m.get("unit"), m.get("target"), m.get("actual"),
                vs_last.get(m.get("metric_key")), m.get("commentary"),
            ]
            if scope == "cohort":
                row = [b.get("startup"), *row]
            rows.append(row)
    return SheetSpec(name="Key Metrics", headers=headers, rows=rows)


# ── Financials (quarterly) ────────────────────────────────────────────────

_SERIES_LABEL: dict[str, str] = {
    **{s["key"]: s["label"] for s in cat.FINANCIAL_SERIES["annual_revenue"]},
    **{s["key"]: s["label"] for s in cat.FINANCIAL_SERIES["needs"]},
}


def _financials_sheet(bundles: list[dict], scope: str) -> SheetSpec:
    headers = ["Series", "Bucket", "Amount"]
    if scope == "cohort":
        headers = ["Startup", *headers]
    rows: list[list[Any]] = []
    for b in bundles:
        for f in b.get("financials", []):
            row = [_SERIES_LABEL.get(f.get("series"), f.get("series")), f.get("bucket"), f.get("amount")]
            if scope == "cohort":
                row = [b.get("startup"), *row]
            rows.append(row)
        # Gap is computed, never stored (mis_catalog's own ruling) -- shown
        # here as a real report row, sourced only from the bundle's own
        # `derived.financials.needs_gap`, never a "needs_gap" input row
        # (there is none: put_financials rejects that series outright).
        gap_by_bucket = b.get("derived", {}).get("financials", {}).get("needs_gap", {})
        for bucket, amount in gap_by_bucket.items():
            row = [_SERIES_LABEL.get("needs_gap", "Gap"), bucket, amount]
            if scope == "cohort":
                row = [b.get("startup"), *row]
            rows.append(row)
    return SheetSpec(name="Financials", headers=headers, rows=rows)


# ── Headcount (quarterly) ─────────────────────────────────────────────────

_HEADCOUNT_LABEL = {c["key"]: c["label"] for c in cat.HEADCOUNT_CATEGORIES}


def _headcount_sheet(bundles: list[dict], scope: str) -> SheetSpec:
    headers = ["Category", "Current Count", "Exited this Qtr", "Net Change", "Remarks"]
    if scope == "cohort":
        headers = ["Startup", *headers]
    rows: list[list[Any]] = []
    for b in bundles:
        derived = b.get("derived", {}).get("headcount", {})
        net_change = derived.get("net_change", {})
        for h in b.get("headcount", []):
            category = h.get("category")
            row = [
                _HEADCOUNT_LABEL.get(category, category), h.get("current_count"),
                h.get("exited"), net_change.get(category), h.get("remarks"),
            ]
            if scope == "cohort":
                row = [b.get("startup"), *row]
            rows.append(row)
        # Total row: current_count/exited only, Net Change deliberately
        # blank -- mirrors the source template's own Total row exactly
        # (docs/reference/mis-templates.md §8) and mis_query._headcount_derived,
        # which for the same reason never sums a per-category delta into a
        # cross-period "total delta" that would not mean anything.
        total = derived.get("total", {})
        row = ["Total", total.get("current_count"), total.get("exited"), None, None]
        if scope == "cohort":
            row = [b.get("startup"), *row]
        rows.append(row)
    return SheetSpec(name="Headcount", headers=headers, rows=rows)


# ── Narrative ──────────────────────────────────────────────────────────────

def _narrative_sheet(kind: str, bundles: list[dict], scope: str) -> SheetSpec:
    headers = ["Section", "Field", "Prompt", "Value"]
    if scope == "cohort":
        headers = ["Startup", *headers]
    section_ids = {s["id"]: s["title"] for s in cat.SECTIONS[kind]}
    rows: list[list[Any]] = []
    for b in bundles:
        narrative = b.get("narrative") or {}
        for section_id, fields in cat.NARRATIVE_FIELDS.items():
            if section_id not in section_ids:
                continue
            for f in fields:
                value = narrative.get(f["id"])
                if value is None:
                    continue
                row = [section_ids[section_id], f["id"], f["prompt"], value]
                if scope == "cohort":
                    row = [b.get("startup"), *row]
                rows.append(row)
    return SheetSpec(name="Narrative", headers=headers, rows=rows)


# ── entries (one sheet per section) ───────────────────────────────────────

def _entries_sheets(kind: str, bundles: list[dict], scope: str) -> list[SheetSpec]:
    sheets: list[SheetSpec] = []
    for section_id in _entries_sections_for_kind(kind):
        fields = cat.entry_fields(section_id)
        headers = [f["label"] for f in fields]
        if scope == "cohort":
            headers = ["Startup", *headers]
        rows: list[list[Any]] = []
        for b in bundles:
            for entry in b.get("entries", {}).get(section_id, []):
                data = entry.get("data", entry)  # accept either the raw DB row or a bare dict
                row = [data.get(f["key"]) for f in fields]
                if scope == "cohort":
                    row = [b.get("startup"), *row]
                rows.append(row)
        sheets.append(SheetSpec(name=_entries_sheet_name(kind, section_id), headers=headers, rows=rows))
    return sheets


# ── top-level ──────────────────────────────────────────────────────────────

def build_sheets(*, kind: str, scope: str, bundles: list[dict]) -> list[SheetSpec]:
    """`bundles`: one `mis_query.period_bundle`-shaped dict per startup
    (`admin_vip_query.fetch_mis_period`'s own return shape, which is exactly
    that plus `application_id`/`startup`), already scoped by the caller to
    the ONE period being exported (`scope="startup"` -> a single-item list;
    `scope="cohort"` -> one item per startup that has a period for this
    `(kind, period_key)`). Raises on an unknown `kind`/`scope` -- no
    fail-open default that would otherwise report an empty or wrongly-shaped
    sheet."""
    if kind not in _KINDS:
        raise ValueError(f"unknown MIS kind: {kind!r}")
    if scope not in _SCOPES:
        raise ValueError(f"unknown export scope: {scope!r}")

    sheets: list[SheetSpec] = []
    if kind == "monthly":
        sheets.append(_metrics_sheet(bundles, scope))
    else:
        sheets.append(_financials_sheet(bundles, scope))
        sheets.append(_headcount_sheet(bundles, scope))
    sheets.append(_narrative_sheet(kind, bundles, scope))
    sheets.extend(_entries_sheets(kind, bundles, scope))
    return sheets


def render_xlsx(sheets: list[SheetSpec]) -> bytes:
    wb = Workbook()
    wb.remove(wb.active)
    used_names: set[str] = set()
    for spec in sheets:
        title = _sheet_title(spec.name)
        base, suffix = title, 2
        while title.lower() in used_names:
            title = _sheet_title(f"{base[:28]} {suffix}")
            suffix += 1
        used_names.add(title.lower())
        ws = wb.create_sheet(title=title)
        ws.append(spec.headers)
        for row in spec.rows:
            ws.append(["" if v is None else v for v in row])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def render_csv(sheets: list[SheetSpec]) -> str:
    buf = io.StringIO()
    for i, spec in enumerate(sheets):
        if i:
            buf.write("\n")
        buf.write(f"## {spec.name}\n")
        writer = csv.writer(buf)
        writer.writerow(spec.headers)
        for row in spec.rows:
            writer.writerow(["" if v is None else v for v in row])
    return buf.getvalue()
