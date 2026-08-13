"""Pure rollup math for the founder dashboard/expense derivations."""
from app.services import founder_query as fq


def test_payroll_monthly_and_annual():
    team = [{"monthly_cost": 180000}, {"monthly_cost": 120000}, {"monthly_cost": 0}]
    assert fq.payroll_monthly(team) == 300000
    assert fq.payroll_annual(team) == 3600000


def test_bom_and_equipment_totals():
    bom = [{"qty": 6, "unit_cost": 8500}, {"qty": 4, "unit_cost": 15500}]
    equip = [{"cost": 220000}, {"cost": 145000}]
    assert fq.bom_total(bom) == 6 * 8500 + 4 * 15500
    assert fq.equipment_total(equip) == 365000
    assert fq.capital_total(bom, equip) == (51000 + 62000) + 365000


def test_procurement_estimate_quoted_committed():
    proc = [
        {"estimate": 8500, "quote": 8200, "status": "quoted"},
        {"estimate": 12000, "quote": 12500, "status": "po"},
        {"estimate": 15500, "quote": 0, "status": "estimate"},
    ]
    assert fq.proc_estimate(proc) == 36000
    assert fq.proc_quoted(proc) == 20700
    # committed = quotes on items past 'estimate' (quoted/po/received)
    assert fq.proc_committed(proc) == 20700


def test_budget_drawn_pct_is_zero_safe():
    assert fq.budget_pct(0, 0) == 0
    assert fq.budget_pct(500000, 2500000) == 20
