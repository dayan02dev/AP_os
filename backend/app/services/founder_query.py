"""Reads + derivations for the Founder Portal. Pure helpers are unit-tested;
the fetch_* functions read via the service-role admin client."""
from __future__ import annotations

from ..supabase_client import get_admin_client

_COMMITTED = {"quoted", "po", "received"}


# ── pure math (mirrors the mockup's derivations) ──────────────────────────
def _num(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def payroll_monthly(team: list[dict]) -> float:
    return sum(_num(m.get("monthly_cost")) for m in team)


def payroll_annual(team: list[dict]) -> float:
    return payroll_monthly(team) * 12


def bom_total(bom: list[dict]) -> float:
    return sum(_num(b.get("qty")) * _num(b.get("unit_cost")) for b in bom)


def equipment_total(equip: list[dict]) -> float:
    return sum(_num(e.get("cost")) for e in equip)


def capital_total(bom: list[dict], equip: list[dict]) -> float:
    return bom_total(bom) + equipment_total(equip)


def proc_estimate(proc: list[dict]) -> float:
    return sum(_num(p.get("estimate")) for p in proc)


def proc_quoted(proc: list[dict]) -> float:
    return sum(_num(p.get("quote")) for p in proc)


def proc_committed(proc: list[dict]) -> float:
    return sum(_num(p.get("quote")) for p in proc if p.get("status") in _COMMITTED)


def budget_pct(drawn: float, grant: float) -> int:
    if not grant:
        return 0
    return round(min(100.0, max(0.0, drawn / grant * 100)))


# ── DB reads (service-role) ───────────────────────────────────────────────
def _rows(table: str, application_id: str, order: str = "sort_order") -> list[dict]:
    sb = get_admin_client()
    q = sb.table(table).select("*").eq("application_id", application_id)
    try:
        q = q.order(order)
    except Exception:  # noqa: BLE001 — order optional
        pass
    return q.execute().data or []


def fetch_team(application_id: str) -> list[dict]:
    return _rows("founder_team_members", application_id)


def fetch_bom(application_id: str) -> list[dict]:
    return _rows("founder_bom_items", application_id)


def fetch_equipment(application_id: str) -> list[dict]:
    return _rows("founder_equipment_items", application_id)


def fetch_procurement(application_id: str) -> list[dict]:
    return _rows("founder_procurement_items", application_id, order="created_at")


def fetch_approach(application_id: str) -> dict:
    sb = get_admin_client()
    rows = (
        sb.table("founder_approach").select("*")
        .eq("application_id", application_id).limit(1).execute().data
        or []
    )
    return rows[0] if rows else {}


def fetch_mou(application_id: str) -> dict | None:
    sb = get_admin_client()
    rows = (
        sb.table("founder_mou").select("*")
        .eq("application_id", application_id).limit(1).execute().data
        or []
    )
    return rows[0] if rows else None


def expense_bundle(application_id: str, grant: float) -> dict:
    bom = fetch_bom(application_id)
    equip = fetch_equipment(application_id)
    proc = fetch_procurement(application_id)
    drawn = proc_committed(proc)
    open_count = sum(1 for p in proc if p.get("status") not in _COMMITTED)
    return {
        "bom": bom,
        "equipment": equip,
        "procurement": proc,
        "totals": {
            "bom_total": bom_total(bom),
            "equipment_total": equipment_total(equip),
            "capital_total": capital_total(bom, equip),
            "proc_estimate": proc_estimate(proc),
            "proc_quoted": proc_quoted(proc),
            "proc_committed": drawn,
            "proc_open_count": open_count,
            "proc_committed_count": len(proc) - open_count,
            "proc_variance": proc_quoted(proc) - proc_estimate(proc),
        },
        "grant_amount": grant,
        "budget_drawn": drawn,
        "budget_pct": budget_pct(drawn, grant),
    }


def dashboard_bundle(application_id: str, status: str, grant: float, mou_signed: bool) -> dict:
    team = fetch_team(application_id)
    bom = fetch_bom(application_id)
    equip = fetch_equipment(application_id)
    proc = fetch_procurement(application_id)
    drawn = proc_committed(proc)
    onboarding_pct = 100 if status == "onboarded" else (50 if mou_signed else 0)
    return {
        "onboarding_pct": onboarding_pct,
        "mou_signed": mou_signed,
        "headcount": len(team),
        "payroll_monthly": payroll_monthly(team),
        "payroll_annual": payroll_annual(team),
        "capital_total": capital_total(bom, equip),
        "proc_committed": drawn,
        "proc_quoted": proc_quoted(proc),
        "proc_count": len(proc),
        "grant_amount": grant,
        "budget_drawn": drawn,
        "budget_pct": budget_pct(drawn, grant),
    }
