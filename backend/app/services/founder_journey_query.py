"""Reads for founder_experiments/founder_tasks/founder_review, and the
residency-dashboard rollup math. Mirrors the mockup's derivations exactly —
see TIR Onboarding.dc.html renderVals() (experimentsView, milestones,
CAP/payrollDrawn/drawnPct, derishPct, tasksDone, feed).

Sorting is done in Python rather than via `.order()` on the query builder:
the FakeSupabase test double treats `.order()` as a no-op, and this module's
ordering guarantees (track, sort_order) matter for correctness (experiment
rank codes T1/C1... are positional), so we sort the fetched rows ourselves.
"""
from __future__ import annotations

from ..supabase_client import get_admin_client
from . import founder_query as fq

WEEKS = 24
# The residency clock is fixed at week 3 in this build — same as the design
# source's `CURWEEK = 3` constant (a static demo state, not derived from a
# real start date). If/when the program wants a real elapsed-time clock,
# replace this with a computation off the application's onboarded_at.
CURWEEK = 3
CAP = 2_500_000  # ₹25L non-dilutive grant cap

_STATUS_META = {
    "not-started": "Not started",
    "running": "Running",
    "validated": "Validated",
    "invalidated": "Invalidated",
}

# Phase names transcribed from the Welcome step's "How you'll move through
# the six months" cards (Phase 1 "Parallel Discovery" -> Gate 1 · Month 2,
# Phase 2 "Cheap Risk Retirement" -> Gate 2 · Month 4, Phase 3 "Prototyping &
# Design Partners" -> Gate 3 · Month 6). The dashboard's "Next milestone"
# tile hard-codes "Gate 1 · Discovery" in the mockup (CURWEEK is always 3,
# so Gate 1 @ week 8 is always the next one) — this list generalises that.
MILESTONES: list[dict] = [
    {"week": 8, "gate": 1, "label": "Gate 1 · Discovery"},
    {"week": 16, "gate": 2, "label": "Gate 2 · Cheap Risk Retirement"},
    {"week": 24, "gate": 3, "label": "Gate 3 · Prototyping & Design Partners"},
]

# "This week" feed on the residency dashboard — static demo copy in the
# mockup (not derived from live state). `color` is a semantic token, not a
# CSS value; the frontend maps it to the design system's accent colors.
FEED: list[dict] = [
    {"color": "green", "text": "MoU with partner NICU signed", "meta": "Priya · 2 days ago"},
    {"color": "amber", "text": "Shadow-mode logging harness in progress", "meta": "Arjun · T3"},
    {"color": "blue", "text": "Office hours with Dr. Krishnan", "meta": "Tomorrow, Tue · 30 min"},
    {"color": "dim", "text": "Retrospective recordings pending hospital export", "meta": "Meera · T1"},
]


def _rows(table: str, application_id: str) -> list[dict]:
    sb = get_admin_client()
    return sb.table(table).select("*").eq("application_id", application_id).execute().data or []


def fetch_experiments(application_id: str) -> list[dict]:
    rows = _rows("founder_experiments", application_id)
    return sorted(rows, key=lambda r: (r.get("track") or "", r.get("sort_order") or 0))


def fetch_tasks(application_id: str) -> list[dict]:
    rows = _rows("founder_tasks", application_id)
    return sorted(rows, key=lambda r: r.get("sort_order") or 0)


def fetch_review(application_id: str) -> dict:
    sb = get_admin_client()
    rows = (
        sb.table("founder_review").select("*").eq("application_id", application_id)
        .limit(1).execute().data or []
    )
    if rows:
        return rows[0]
    return {
        "application_id": application_id,
        "status": "draft",
        "approved_by": None,
        "approved_on": None,
        "mentor_comment": None,
    }


def sync_procurement(application_id: str) -> list[dict]:
    """Push founder_bom_items + founder_equipment_items into
    founder_procurement_items — matching an existing row by (item, category)
    case-insensitively, else inserting a new estimate line. Mirrors the
    mockup's syncProc()."""
    sb = get_admin_client()
    bom = fq.fetch_bom(application_id)
    equip = fq.fetch_equipment(application_id)
    proc = fq.fetch_procurement(application_id)

    def _find(item: str, category: str) -> dict | None:
        key = item.strip().lower()
        for p in proc:
            if (p.get("item") or "").strip().lower() == key and p.get("category") == category:
                return p
        return None

    for b in bom:
        item = (b.get("item") or "").strip()
        match = _find(item, "BOM") if item else None
        if match:
            sb.table("founder_procurement_items").update({
                "qty": b.get("qty") or 0,
                "estimate": b.get("unit_cost") or 0,
            }).eq("id", match["id"]).execute()
        elif item:
            new_row = sb.table("founder_procurement_items").insert({
                "application_id": application_id,
                "item": item,
                "category": "BOM",
                "qty": b.get("qty") or 0,
                "estimate": b.get("unit_cost") or 0,
                "vendor": "",
                "quote": 0,
                "lead_weeks": 4,
                "status": "estimate",
            }).execute().data[0]
            proc.append(new_row)

    for e in equip:
        item = (e.get("item") or "").strip()
        match = _find(item, "Equipment") if item else None
        if match:
            update = {"estimate": e.get("cost") or 0}
            if not match.get("qty"):
                update["qty"] = 1
            sb.table("founder_procurement_items").update(update).eq("id", match["id"]).execute()
        elif item:
            new_row = sb.table("founder_procurement_items").insert({
                "application_id": application_id,
                "item": item,
                "category": "Equipment",
                "qty": 1,
                "estimate": e.get("cost") or 0,
                "vendor": "",
                "quote": 0,
                "lead_weeks": 4,
                "status": "estimate",
            }).execute().data[0]
            proc.append(new_row)

    return fq.fetch_procurement(application_id)


# ── pure math (mirrors the mockup's derivations) ──────────────────────────
def _short(assumption: str | None) -> str:
    a = (assumption or "").strip() or "Untitled assumption"
    return a[:58] + "…" if len(a) > 58 else a


def _range_label(e: dict) -> str:
    start = int(e.get("start_week") or 1)
    weeks = int(e.get("weeks") or 1)
    return f"Wk {start}–{start + weeks - 1}"


def experiments_view(experiments: list[dict]) -> list[dict]:
    out = []
    for e in experiments:
        status = e.get("status") or "not-started"
        out.append({
            "id": e.get("id"),
            "short": _short(e.get("assumption")),
            "status": status,
            "status_label": _STATUS_META.get(status, status),
            "risk": e.get("risk") or "medium",
            "range_label": _range_label(e),
        })
    return out


def next_milestone(curweek: int = CURWEEK) -> dict | None:
    for m in MILESTONES:
        if m["week"] > curweek:
            return {"label": m["label"], "week": m["week"], "in_weeks": m["week"] - curweek}
    return None


def budget_math(monthly_payroll: float, one_time_total: float, curweek: int = CURWEEK) -> dict:
    """CAP=2,500,000; payroll_drawn = monthly_payroll * (curweek/4.345);
    total_drawn = min(CAP, payroll_drawn + one_time); remaining = CAP - total_drawn."""
    months_elapsed = curweek / 4.345
    payroll_drawn = monthly_payroll * months_elapsed
    total_drawn = min(CAP, payroll_drawn + one_time_total)
    remaining = max(0.0, CAP - total_drawn)
    drawn_pct = min(100.0, total_drawn / CAP * 100) if CAP else 0.0
    return {
        "payroll_drawn": payroll_drawn,
        "total_drawn": total_drawn,
        "remaining": remaining,
        "drawn_pct": drawn_pct,
        "seg_payroll_pct": min(100.0, payroll_drawn / CAP * 100) if CAP else 0.0,
        "seg_capital_pct": min(100.0, one_time_total / CAP * 100) if CAP else 0.0,
    }


def residency_bundle(application_id: str, project_name: str, team_names: list[str]) -> dict:
    experiments = fetch_experiments(application_id)
    tasks = fetch_tasks(application_id)
    team = fq.fetch_team(application_id)
    bom = fq.fetch_bom(application_id)
    equip = fq.fetch_equipment(application_id)
    proc = fq.fetch_procurement(application_id)
    review = fetch_review(application_id)

    total_experiments = len(experiments)
    validated = sum(1 for e in experiments if e.get("status") == "validated")
    derisking_pct = round(validated / total_experiments * 100) if total_experiments else 0
    tasks_done = sum(1 for t in tasks if t.get("status") == "done")
    tasks_total = len(tasks)

    monthly_payroll = fq.payroll_monthly(team)
    bom_tot = fq.bom_total(bom)
    equip_tot = fq.equipment_total(equip)
    one_time = bom_tot + equip_tot
    bmath = budget_math(monthly_payroll, one_time)

    seg_remaining_pct = max(0.0, 100.0 - bmath["seg_payroll_pct"] - bmath["seg_capital_pct"])

    return {
        "app": {
            "project_name": project_name,
            "cohort": "Cohort 04",
            "team_names": team_names,
            "week": CURWEEK,
            "weeks_total": WEEKS,
            "weeks_remaining": WEEKS - CURWEEK,
        },
        "tiles": {
            "derisking_pct": derisking_pct,
            "validated": validated,
            "total_experiments": total_experiments,
            "tasks_done": tasks_done,
            "tasks_total": tasks_total,
            "budget_drawn": round(bmath["total_drawn"]),
            "budget_pct": round(bmath["drawn_pct"]),
            "next_milestone": next_milestone(),
        },
        "experiments": experiments_view(experiments),
        "feed": FEED,
        "expense": {
            "monthly_payroll": round(monthly_payroll),
            "payroll_drawn": round(bmath["payroll_drawn"]),
            "bom_total": round(bom_tot),
            "equip_total": round(equip_tot),
            "remaining": round(bmath["remaining"]),
            "drawn_pct": round(bmath["drawn_pct"]),
            "segments": {
                "payroll_amount": round(bmath["payroll_drawn"]),
                "capital_amount": round(one_time),
                "remaining_amount": round(bmath["remaining"]),
                "payroll_pct": round(bmath["seg_payroll_pct"], 2),
                "capital_pct": round(bmath["seg_capital_pct"], 2),
                "remaining_pct": round(seg_remaining_pct, 2),
            },
            "proc_committed": round(fq.proc_committed(proc)),
            "proc_quoted": round(fq.proc_quoted(proc)),
            "proc_count": len(proc),
        },
        "review_status": review.get("status") or "draft",
    }
