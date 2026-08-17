"""Fill and submit MIS periods for the staging VIP test founder.

Without this, every period sits at `draft` with empty grids, so the admin
portal's MIS matrix is a wall of identical chips and a submitted period
cannot be opened read-only at all. This gives the cohort a realistic shape:
three consecutive submitted monthly reports with numbers that MOVE (so
`vs Last Month` is meaningful rather than uniformly blank), one submitted
quarterly review with headcount and the annual revenue series, and the
current month + quarter deliberately left in `draft`.

Deliberate leftovers, because they are what makes the admin screens worth
looking at:
  - 2026-08 monthly and FY26-27-Q2 stay DRAFT -> the matrix shows a real
    mix of submitted / draft / overdue rather than one uniform state.
  - Because 2026-06 and 2026-07 are submitted AFTER 2026-05, reopening
    2026-05 must 409 `mis_later_period_submitted`. That is the guard worth
    demonstrating, and it is only reachable once several periods are
    submitted in order.

STAGING ONLY. Writes through the real API as the founder (never straight to
the tables) so every server-side rule — in-order submit, full-row upsert,
validation — is exercised exactly as a real founder would hit it.

Run:
  cd backend
  set -a && source /Users/apple/Desktop/Final_AP_os/backend/.env.staging && set +a
  python scripts/seed_vip_mis_data.py
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _HERE)

API = "https://cdw51c7gid.execute-api.ap-south-1.amazonaws.com"
EMAIL = "claude-test-applicant-sip@artpark.in"
STAGING_REF = "exqmxvdtcsvpgtftwjml"

# Numbers move month over month on purpose: revenue and customers climb,
# cash falls, runway shortens. A flat series would render every "vs Last
# Month" cell as a dash and prove nothing about the derived comparisons.
MONTHS = [
    ("2026-05", dict(revenue_month=4.5, active_customers=2, new_lois=1,
                     weighted_pipeline=38.0, deployments_field=1,
                     cash_in_bank=180.0, net_burn_month=22.0, runway_months=8.2,
                     headcount_eom=7, net_hires_month=1),
     "Closed the first paid pilot with a Bengaluru 3PL warehouse."),
    ("2026-06", dict(revenue_month=6.2, active_customers=3, new_lois=2,
                     weighted_pipeline=52.0, deployments_field=2,
                     cash_in_bank=162.0, net_burn_month=24.0, runway_months=6.8,
                     headcount_eom=8, net_hires_month=1),
     "Second site live; pick accuracy held above target through peak week."),
    ("2026-07", dict(revenue_month=9.1, active_customers=5, new_lois=2,
                     weighted_pipeline=71.0, deployments_field=3,
                     cash_in_bank=145.0, net_burn_month=25.0, runway_months=5.8,
                     headcount_eom=9, net_hires_month=1),
     "Third deployment signed; began bridge conversations on the back of it."),
]


def _guard() -> None:
    url = os.environ.get("SUPABASE_URL", "")
    if STAGING_REF not in url:
        sys.exit(f"refusing to run: SUPABASE_URL is not staging. got {url!r}")


def _token() -> str:
    from app.supabase_client import get_admin_client
    from supabase import create_client
    sb = get_admin_client()
    otp = sb.auth.admin.generate_link(
        {"type": "magiclink", "email": EMAIL}).properties.email_otp
    anon = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])
    return anon.auth.verify_otp(
        {"email": EMAIL, "token": otp, "type": "email"}).session.access_token


def main() -> None:
    _guard()
    token = _token()

    def call(method: str, path: str, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(
            API + path, data=data, method=method,
            headers={"Authorization": f"Bearer {token}",
                     "Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.status, json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            raw = e.read().decode(errors="replace")
            try:
                return e.code, json.loads(raw)
            except Exception:
                return e.code, raw

    # ── monthly ────────────────────────────────────────────────────────
    for key, vals, headline in MONTHS:
        code, bundle = call("GET", f"/founder/mis/monthly/{key}")
        if code != 200:
            print(f"  {key}: GET failed {code} {bundle}")
            continue
        if bundle["period"]["status"] != "draft":
            print(f"  {key}: already {bundle['period']['status']}, skipping")
            continue

        # Full rows only. put_metrics is a full-row upsert: any field left
        # out is written as NULL, so a partial row silently erases target
        # and commentary. `trl_level` is server-set from the AIR round and
        # the router rejects a founder-supplied `actual` for it.
        rows = []
        for m in bundle["metrics"]:
            k = m["metric_key"]
            if k == "trl_level":
                continue
            row = {"metric_key": k, "target": m.get("target"),
                   "actual": vals.get(k, m.get("actual")),
                   "rag": "green" if k in vals else m.get("rag"),
                   "commentary": m.get("commentary")}
            if k == "product_metric_1":
                row |= {"label": "Pick accuracy (%)", "actual": 97.4, "rag": "green"}
            if k == "product_metric_2":
                row |= {"label": "Mean picks / hour", "actual": 142, "rag": "amber"}
            rows.append(row)
        call("PUT", f"/founder/mis/monthly/{key}/metrics", rows)

        call("PUT", f"/founder/mis/monthly/{key}/narrative", {
            "exec.headline_win": headline,
            "exec.biggest_concern": "Runway tightens if the bridge slips past Q3.",
            "exec.commercial": f"{vals['active_customers']} active customers, "
                               f"{vals['new_lois']} new LOI(s) this month.",
            "exec.cash": f"₹{vals['cash_in_bank']}L in bank, "
                         f"₹{vals['net_burn_month']}L monthly burn.",
            "exec.top_ask": "Warm intros to 3PL operators running multi-site fulfilment.",
            "traction.sharpest_wedge": "Peak-season overflow picking — the pain is "
                                       "acute and the budget already exists.",
            "traction.not_working": "Cold outbound to enterprise retail; cycles are "
                                    "far too long for our runway.",
            "fin.cash_and_runway": f"₹{vals['cash_in_bank']}L, "
                                   f"{vals['runway_months']} months at current burn.",
        })

        call("PUT", f"/founder/mis/monthly/{key}/entries/milestones", [
            {"milestone": "Second warehouse site live", "owner": "Ops",
             "status": "Done" if key != "2026-05" else "On Track",
             "notes": "Commissioned ahead of the peak window."},
            {"milestone": "Pick accuracy sustained above 97%", "owner": "ML",
             "status": "On Track", "notes": "Holding through mixed-SKU bins."},
            {"milestone": "Close bridge round", "owner": "CEO",
             "status": "At Risk", "notes": "Two term sheets verbal, none signed."},
        ])
        call("PUT", f"/founder/mis/monthly/{key}/entries/risks", [
            {"severity": "amber", "what_happened": "Gripper wear higher than modelled",
             "impact": "Unplanned maintenance at site 1",
             "mitigation": "Switched compound; monitoring for four weeks."},
            {"severity": "red", "what_happened": "Bridge round not yet signed",
             "impact": f"Runway {vals['runway_months']} months",
             "mitigation": "Parallel non-dilutive grant application submitted."},
        ])
        call("PUT", f"/founder/mis/monthly/{key}/entries/asks", [
            {"priority": 1, "category": "customer_partnership_intros",
             "ask": "Intros to 3PL operators with multi-site fulfilment."},
            {"priority": 2, "category": "investor_intros",
             "ask": "Deep-tech seed funds comfortable with hardware timelines."},
        ])

        code, res = call("POST", f"/founder/mis/monthly/{key}/submit")
        status = res.get("period", {}).get("status") if isinstance(res, dict) else res
        print(f"  monthly {key}: filled -> submit {code} ({status})")

    # ── quarterly ──────────────────────────────────────────────────────
    qk = "FY26-27-Q1"
    code, qb = call("GET", f"/founder/mis/quarterly/{qk}")
    if code == 200 and qb["period"]["status"] == "draft":
        call("PUT", f"/founder/mis/quarterly/{qk}/narrative", {
            "glance.strategic_theme": "Prove the picking cell repeats across sites.",
            "glance.biggest_milestone": "Three deployments live, all on paid pilots.",
            "glance.biggest_miss": "Bridge round still unsigned at quarter end.",
            "glance.commercial_funding_position": "₹145L in bank, 5.8 months runway.",
            "glance.next_quarter_bet": "Convert two pilots to annual contracts.",
            "fin6.cash_in_bank": "₹145L", "fin6.quarterly_burn": "₹71L",
            "fin6.runway": "5.8 months at current burn",
            "fin6.gap_closing_plan": "Bridge round plus one non-dilutive grant.",
            "people.key_hires": "Controls engineer and a second ML engineer.",
            "people.attrition": "One intern completed their term; no regretted exits.",
        })

        amounts = {
            "annual_revenue_booked": {"FY24-25": 0, "FY25-26": 12.0,
                                      "FY26-27 YTD": 19.8, "FY26-27 Proj": 62.0},
            "annual_revenue_received": {"FY24-25": 0, "FY25-26": 9.5,
                                        "FY26-27 YTD": 15.2, "FY26-27 Proj": 54.0},
            "needs_confirmed": {"FY26-27 YTD": 40.0}, "needs_projected": {"FY26-27 Proj": 120.0},
        }
        fin = []
        for f in qb.get("financials", []):
            fin.append({"series": f["series"], "bucket": f["bucket"],
                        "amount": amounts.get(f["series"], {}).get(f["bucket"], f.get("amount"))})
        call("PUT", f"/founder/mis/quarterly/{qk}/financials", fin)

        # net_change is DERIVED per category against the previous quarter and
        # the Total row carries none at all — never sent, never computed here.
        call("PUT", f"/founder/mis/quarterly/{qk}/headcount", [
            {"category": "artpark_associated", "current_count": 4, "exited": 0,
             "remarks": "Two engineers, one ops, one PM."},
            {"category": "startup", "current_count": 3, "exited": 1,
             "remarks": "One left for higher study."},
            {"category": "consultants", "current_count": 1, "exited": 0,
             "remarks": "Safety-certification advisor, part time."},
            {"category": "interns", "current_count": 2, "exited": 1,
             "remarks": "One term completed."},
        ])
        call("PUT", f"/founder/mis/quarterly/{qk}/entries/planned_vs_actual", [
            {"planned": "Three sites live", "achieved": "Three sites live",
             "outcome": "met", "reason": "", "corrective_action": ""},
            {"planned": "Close bridge round", "achieved": "Two verbal term sheets",
             "outcome": "missed", "reason": "Diligence ran long over the quarter.",
             "corrective_action": "Parallel grant track opened."},
        ])
        call("PUT", f"/founder/mis/quarterly/{qk}/entries/next_milestones", [
            {"milestone": "Convert two pilots to annual contracts", "target_date": "2026-11-30"},
            {"milestone": "Close bridge round", "target_date": "2026-10-15"},
        ])
        code, res = call("POST", f"/founder/mis/quarterly/{qk}/submit")
        status = res.get("period", {}).get("status") if isinstance(res, dict) else res
        print(f"  quarterly {qk}: filled -> submit {code} ({status})")
    else:
        print(f"  quarterly {qk}: {qb['period']['status'] if code == 200 else code}, skipping")

    code, idx = call("GET", "/founder/mis")
    for kind in ("monthly", "quarterly"):
        rows = idx.get(kind, [])
        print(f"  {kind}: " + ", ".join(
            f"{r['period_key']}={r['status']}{'/overdue' if r.get('overdue') else ''}"
            for r in rows))


if __name__ == "__main__":
    main()
