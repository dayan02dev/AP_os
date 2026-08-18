"""Fill and submit MIS periods for a small cohort of staging VIP founders,
through the import/commit path.

The founder-facing PUT/submit routes this script used to call
(`PUT .../metrics`, `PUT .../narrative`, `PUT .../entries/{section}`,
`PUT .../financials`, `PUT .../headcount`, `POST .../submit`) are gone —
retired onto `POST .../import/commit`, which now accepts every section in
one body plus a `submit: bool` flag that finalizes the period in the same
call (`founder_mis.MisImportCommitBody`). This script never calls those six
old routes; every fill is a single commit call.

Without this, the admin cohort MIS charts
(`GET /admin/platform/vip/mis/charts`) have nothing worth plotting: one
venture with flat numbers proves nothing about four line charts or a
cohort roll-up, and the roll-up's "sum only whoever reported this period"
behaviour is invisible unless different ventures report different months.
This seeds THREE onboarded ventures with different onboarding dates and
different how-far-they-kept-up-with-reporting behaviour:

  - claude-test-applicant-sip@artpark.in ("ARTPARK · IISc Bangalore")
    onboarded 2026-05-01 — already provisioned on staging by an earlier
    script/run; never (re)provisioned here. Monthly 05/06/07 submitted, 08
    stays DRAFT. Quarterly FY26-27-Q1 submitted, Q2 stays DRAFT.
  - claude-test-vip-2@artpark.in ("SecondCo Robotics"), onboarded
    2026-03-01 — the cohort's earliest venture and, for a while, its most
    consistent reporter. Monthly 03/04/05/06 submitted, 07/08 DRAFT (falls
    behind on the two most recent months — a lagging reporter). Quarterly
    FY25-26-Q4 and FY26-27-Q1 submitted, Q2 DRAFT.
  - claude-test-vip-3@artpark.in ("ThirdCo Sensing"), onboarded
    2026-06-01 — the cohort's newest venture. Monthly 06/07 submitted, 08
    DRAFT. Quarterly FY26-27-Q1 submitted, Q2 DRAFT.

That stagger means: 2026-03/04 carries only SecondCo's number in the
cohort roll-up; 2026-06/07 sums two or three ventures depending on the
exact period and who had filed by then; the current month and each
venture's latest quarter are draft everywhere and so contribute to no
roll-up point at all — exactly the "partial sum, never zero-filled, never
gated on full-cohort participation" rule `admin_vip_query.fetch_mis_charts`
implements. Every venture's own numbers move month over month on purpose —
revenue and paying customers climb, cash falls, headcount grows — so
`vs Last Month` and every chart line are never flat.

Idempotent / re-runnable: every step checks state before writing.
`_ensure_onboarded_venture` no-ops once a venture is already `onboarded`;
each period fill checks the period is still `draft` before committing (an
already-submitted period is left untouched — the same guard the router
itself enforces via `_own_draft_period`/`mis_already_submitted`). Rerunning
this script top to bottom, whether from scratch or after a partial
failure, is safe and picks up wherever it left off; it never overwrites a
period that already made it to `submitted`.

Auth-user creation on staging — VERIFIED, not assumed from the prod
precedent in project memory: an ad hoc check against this project's own
staging DB (2026-08-18) created a throwaway auth user and confirmed a
`public.profiles` row and an `applicant` `user_roles` row both appeared
automatically, via the same triggers prod relies on
(`001_initial_schema.sql`'s `on_auth_user_created` on `auth.users`, and
`019_auto_assign_applicant_role.sql`'s trigger on `public.profiles` —
note that second migration's own header records that a Studio-created
trigger on `auth.users` itself silently fails to attach, which is exactly
why it hooks `profiles` instead; this script trusts the *outcome*
(profiles + role rows appear) rather than either trigger's definition).
This script therefore never inserts into `profiles` or `user_roles`
itself — a manual insert would 23505 against the trigger's own row.
`sip_applications.basic_teammates` is NOT NULL with a `'[]'::jsonb`
default (`021_sip_team_and_dpiit.sql`) — every insert below omits it
rather than sending an explicit null, so the column default applies.

Writes go through the real founder-facing API, authenticated as each
founder in turn (magic-link OTP, the same non-destructive staging QA trick
documented in `docs/superpowers/VIP_BUILD_STATE.md`) — never straight into
`vip_mis_*` tables — so the ordering guard, full-row upsert semantics on
metrics/headcount, and request validation are all exercised exactly as a
real founder would hit them. Venture *provisioning* (creating the auth
user and the `sip_applications`/`application_status_log` rows that make a
venture "onboarded" in the first place) is the one part that writes
directly via the service-role client — there is no founder-facing API for
that step, matching this repo's existing precedent
(`seed_vip_onboarding.py`, `setup_reviewer_nirav.py`).

STAGING ONLY — refuses to run against any Supabase project whose URL does
not contain the staging ref.

Run against the deployed staging API (default):
  cd backend
  set -a && source /Users/apple/Desktop/Final_AP_os/backend/.env.staging && set +a
  python scripts/seed_vip_mis_data.py

Run against a locally-served API (same staging Supabase data, no Lambda
deploy required — useful when the deployed Lambda is behind the worktree's
HEAD, since this script only works against a backend that has Task 1's
`import/commit` + `submit` flag):
  uvicorn app.main:app --port 8000 &
  SEED_VIP_MIS_API_BASE=http://127.0.0.1:8000 python scripts/seed_vip_mis_data.py
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

_HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _HERE)

API = os.environ.get(
    "SEED_VIP_MIS_API_BASE", "https://cdw51c7gid.execute-api.ap-south-1.amazonaws.com"
)
STAGING_REF = "exqmxvdtcsvpgtftwjml"


def _guard() -> None:
    url = os.environ.get("SUPABASE_URL", "")
    if STAGING_REF not in url:
        sys.exit(f"refusing to run: SUPABASE_URL is not staging. got {url!r}")


# ── cohort data ─────────────────────────────────────────────────────────
# Numbers move month over month on purpose: revenue and paying customers
# climb, cash falls, runway shortens, headcount grows. A flat series would
# render every "vs Last Month" cell as a dash, every chart line as flat,
# and would prove nothing about the admin cohort roll-up.
#
# Each venture's "months"/"quarterlies" list is deliberately a PREFIX of
# what `ensure_periods` will generate for it (which runs from onboarded_on
# through the real current month/quarter) — the periods left off the list
# are the ones this script leaves DRAFT on purpose. Order within each list
# must stay chronological: `_reject_out_of_order_submit` 409s a submit
# attempt while any earlier period of the same kind is still draft.

VENTURES = [
    {
        "email": "claude-test-applicant-sip@artpark.in",
        "org": "ARTPARK · IISc Bangalore",
        "onboarded_on": "2026-05-01",
        "provision": False,  # already onboarded on staging; never (re)provisioned here
        "months": [
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
        ],
        "quarterlies": [
            ("FY26-27-Q1", {
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
            }, {
                "annual_revenue_booked": {"FY24-25": 0, "FY25-26": 12.0,
                                          "FY26-27 YTD": 19.8, "FY26-27 Proj": 62.0},
                "annual_revenue_received": {"FY24-25": 0, "FY25-26": 9.5,
                                            "FY26-27 YTD": 15.2, "FY26-27 Proj": 54.0},
                "needs_confirmed": {"FY26-27 YTD": 40.0}, "needs_projected": {"FY26-27 Proj": 120.0},
            }, [
                {"category": "artpark_associated", "current_count": 4, "exited": 0,
                 "remarks": "Two engineers, one ops, one PM."},
                {"category": "startup", "current_count": 3, "exited": 1,
                 "remarks": "One left for higher study."},
                {"category": "consultants", "current_count": 1, "exited": 0,
                 "remarks": "Safety-certification advisor, part time."},
                {"category": "interns", "current_count": 2, "exited": 1,
                 "remarks": "One term completed."},
            ], [
                {"planned": "Three sites live", "achieved": "Three sites live",
                 "outcome": "met", "reason": "", "corrective_action": ""},
                {"planned": "Close bridge round", "achieved": "Two verbal term sheets",
                 "outcome": "missed", "reason": "Diligence ran long over the quarter.",
                 "corrective_action": "Parallel grant track opened."},
            ], [
                {"milestone": "Convert two pilots to annual contracts", "target_date": "2026-11-30"},
                {"milestone": "Close bridge round", "target_date": "2026-10-15"},
            ]),
        ],
    },
    {
        "email": "claude-test-vip-2@artpark.in",
        "org": "SecondCo Robotics",
        "onboarded_on": "2026-03-01",
        "provision": True,
        "months": [
            ("2026-03", dict(revenue_month=2.1, active_customers=1, new_lois=1,
                             weighted_pipeline=15.0, deployments_field=0,
                             cash_in_bank=210.0, net_burn_month=18.0, runway_months=11.6,
                             headcount_eom=5, net_hires_month=0),
             "First bench-scale demo delivered to a prospective distribution partner."),
            ("2026-04", dict(revenue_month=3.4, active_customers=1, new_lois=1,
                             weighted_pipeline=24.0, deployments_field=1,
                             cash_in_bank=195.0, net_burn_month=19.0, runway_months=10.3,
                             headcount_eom=5, net_hires_month=0),
             "First field unit installed at a partner facility on a paid trial."),
            ("2026-05", dict(revenue_month=5.0, active_customers=2, new_lois=2,
                             weighted_pipeline=33.0, deployments_field=1,
                             cash_in_bank=178.0, net_burn_month=20.0, runway_months=8.9,
                             headcount_eom=6, net_hires_month=1),
             "Second customer signed; trial unit converted to a paid contract."),
            ("2026-06", dict(revenue_month=7.8, active_customers=3, new_lois=1,
                             weighted_pipeline=46.0, deployments_field=2,
                             cash_in_bank=158.0, net_burn_month=22.0, runway_months=7.2,
                             headcount_eom=7, net_hires_month=1),
             "Third customer onboarded; hired a second field-service engineer."),
        ],
        "quarterlies": [
            ("FY25-26-Q4", {
                "glance.strategic_theme": "Get one unit paid-and-running outside the lab.",
                "glance.biggest_milestone": "First field unit installed on a paid trial.",
                "glance.biggest_miss": "Certification took longer than planned.",
                "glance.commercial_funding_position": "₹195L in bank, 10.3 months runway.",
                "glance.next_quarter_bet": "Convert the trial to a signed annual contract.",
                "fin6.cash_in_bank": "₹195L", "fin6.quarterly_burn": "₹37L",
                "fin6.runway": "10.3 months at current burn",
                "fin6.gap_closing_plan": "Existing runway covers the quarter; no gap.",
                "people.key_hires": "Field-service engineer.",
                "people.attrition": "None.",
            }, {
                "annual_revenue_booked": {"FY24-25": 0, "FY25-26": 5.5,
                                          "FY26-27 YTD": 0, "FY26-27 Proj": 45.0},
                "annual_revenue_received": {"FY24-25": 0, "FY25-26": 3.4,
                                            "FY26-27 YTD": 0, "FY26-27 Proj": 38.0},
                "needs_confirmed": {"FY26-27 YTD": 0}, "needs_projected": {"FY26-27 Proj": 90.0},
            }, [
                {"category": "artpark_associated", "current_count": 3, "exited": 0,
                 "remarks": "Two engineers, one ops."},
                {"category": "startup", "current_count": 2, "exited": 0, "remarks": ""},
                {"category": "consultants", "current_count": 0, "exited": 0, "remarks": ""},
                {"category": "interns", "current_count": 0, "exited": 0, "remarks": ""},
            ], [
                {"planned": "Bench demo to a partner", "achieved": "Bench demo delivered",
                 "outcome": "met", "reason": "", "corrective_action": ""},
                {"planned": "Field install by quarter end", "achieved": "Installed, one week late",
                 "outcome": "met", "reason": "Certification review ran long.",
                 "corrective_action": "Started certification earlier for the next unit."},
            ], [
                {"milestone": "Convert trial to a signed annual contract", "target_date": "2026-08-31"},
                {"milestone": "Ship a second field unit", "target_date": "2026-09-30"},
            ]),
            ("FY26-27-Q1", {
                "glance.strategic_theme": "Repeat the first paid install at a second site.",
                "glance.biggest_milestone": "Third paying customer onboarded.",
                "glance.biggest_miss": "Second field-service hire started a month late.",
                "glance.commercial_funding_position": "₹158L in bank, 7.2 months runway.",
                "glance.next_quarter_bet": "Close a fourth customer off the current pipeline.",
                "fin6.cash_in_bank": "₹158L", "fin6.quarterly_burn": "₹61L",
                "fin6.runway": "7.2 months at current burn",
                "fin6.gap_closing_plan": "Opening a seed-extension conversation this quarter.",
                "people.key_hires": "Second field-service engineer.",
                "people.attrition": "None.",
            }, {
                "annual_revenue_booked": {"FY24-25": 0, "FY25-26": 5.5,
                                          "FY26-27 YTD": 16.2, "FY26-27 Proj": 68.0},
                "annual_revenue_received": {"FY24-25": 0, "FY25-26": 3.4,
                                            "FY26-27 YTD": 12.0, "FY26-27 Proj": 58.0},
                "needs_confirmed": {"FY26-27 YTD": 0}, "needs_projected": {"FY26-27 Proj": 90.0},
            }, [
                {"category": "artpark_associated", "current_count": 4, "exited": 0,
                 "remarks": "Added a second field-service engineer."},
                {"category": "startup", "current_count": 3, "exited": 0, "remarks": ""},
                {"category": "consultants", "current_count": 0, "exited": 0, "remarks": ""},
                {"category": "interns", "current_count": 1, "exited": 0,
                 "remarks": "Summer intern, ops support."},
            ], [
                {"planned": "Sign a second customer", "achieved": "Signed two",
                 "outcome": "met", "reason": "", "corrective_action": ""},
                {"planned": "Second field-service hire", "achieved": "Hired, one month late",
                 "outcome": "missed", "reason": "Candidate's notice period ran longer than quoted.",
                 "corrective_action": "Started the next search earlier."},
            ], [
                {"milestone": "Close a fourth customer", "target_date": "2026-10-31"},
                {"milestone": "Open a seed-extension conversation", "target_date": "2026-09-15"},
            ]),
        ],
    },
    {
        "email": "claude-test-vip-3@artpark.in",
        "org": "ThirdCo Sensing",
        "onboarded_on": "2026-06-01",
        "provision": True,
        "months": [
            ("2026-06", dict(revenue_month=1.2, active_customers=1, new_lois=1,
                             weighted_pipeline=10.0, deployments_field=1,
                             cash_in_bank=140.0, net_burn_month=15.0, runway_months=9.3,
                             headcount_eom=4, net_hires_month=0),
             "First sensor array deployed at a partner farm for field validation."),
            ("2026-07", dict(revenue_month=2.6, active_customers=2, new_lois=1,
                             weighted_pipeline=18.0, deployments_field=1,
                             cash_in_bank=128.0, net_burn_month=16.0, runway_months=8.0,
                             headcount_eom=5, net_hires_month=1),
             "Second deployment converted to a paid data-subscription contract."),
        ],
        "quarterlies": [
            ("FY26-27-Q1", {
                "glance.strategic_theme": "Prove one paid data subscription end to end.",
                "glance.biggest_milestone": "Second deployment converted to a paid subscription.",
                "glance.biggest_miss": "Sensor calibration took two extra weeks per site.",
                "glance.commercial_funding_position": "₹128L in bank, 8.0 months runway.",
                "glance.next_quarter_bet": "Sign a third site off the current pipeline.",
                "fin6.cash_in_bank": "₹128L", "fin6.quarterly_burn": "₹31L",
                "fin6.runway": "8.0 months at current burn",
                "fin6.gap_closing_plan": "Existing runway covers the quarter; no gap.",
                "people.key_hires": "Field calibration technician.",
                "people.attrition": "None.",
            }, {
                "annual_revenue_booked": {"FY24-25": 0, "FY25-26": 0,
                                          "FY26-27 YTD": 3.8, "FY26-27 Proj": 22.0},
                "annual_revenue_received": {"FY24-25": 0, "FY25-26": 0,
                                            "FY26-27 YTD": 2.4, "FY26-27 Proj": 18.0},
                "needs_confirmed": {"FY26-27 YTD": 0}, "needs_projected": {"FY26-27 Proj": 40.0},
            }, [
                {"category": "artpark_associated", "current_count": 2, "exited": 0,
                 "remarks": "One engineer, one calibration technician."},
                {"category": "startup", "current_count": 2, "exited": 0, "remarks": ""},
                {"category": "consultants", "current_count": 1, "exited": 0,
                 "remarks": "Agronomy advisor, part time."},
                {"category": "interns", "current_count": 0, "exited": 0, "remarks": ""},
            ], [
                {"planned": "Deploy first sensor array", "achieved": "Deployed",
                 "outcome": "met", "reason": "", "corrective_action": ""},
                {"planned": "Convert to a paid subscription", "achieved": "Converted",
                 "outcome": "met", "reason": "", "corrective_action": ""},
            ], [
                {"milestone": "Sign a third site", "target_date": "2026-10-31"},
                {"milestone": "Automate the calibration step", "target_date": "2026-11-15"},
            ]),
        ],
    },
]


def _find_user(sb, email: str, page_size: int = 200):
    """Paginated auth.admin.list_users() email lookup — same walk as
    seed_vip_onboarding.py / setup_reviewer_nirav.py; list_users() does not
    auto-iterate past page 1, and this project has been bitten by exactly
    that kind of silent truncation before."""
    target = email.lower()
    page = 1
    while True:
        batch = sb.auth.admin.list_users(page=page, per_page=page_size)
        if not batch:
            return None
        hit = next((u for u in batch if (u.email or "").lower() == target), None)
        if hit:
            return hit
        if len(batch) < page_size:
            return None
        page += 1


def _ensure_onboarded_venture(sb, email: str, org: str, onboarded_on: str) -> str:
    """Idempotent: reuses the auth user / application row if either already
    exists, and does nothing at all once the application is already
    `onboarded`. Creates whatever is missing: the auth user (profiles +
    applicant role follow automatically — see module docstring), the
    `sip_applications` row at status='onboarded', and the
    `application_status_log` row `_resolve_onboarded_on` reads to build
    this venture's MIS calendar. Returns the application id."""
    user = _find_user(sb, email)
    if user is None:
        try:
            user = sb.auth.admin.create_user({"email": email, "email_confirm": True}).user
        except Exception:
            # Likely a 23505 from a prior partial run racing this one —
            # look it up instead of failing.
            user = _find_user(sb, email)
            if user is None:
                raise

    existing = (sb.table("sip_applications").select("id,status")
                .eq("user_id", user.id).execute().data or [])
    onboarded = [r for r in existing if r["status"] == "onboarded"]
    if onboarded:
        app_id = onboarded[0]["id"]
        print(f"  {org}: already onboarded ({app_id}), skipping provision")
    elif existing:
        # A leftover row from a prior partial run — reuse it rather than
        # creating a second application for the same user.
        app_id = existing[0]["id"]
        sb.table("sip_applications").update({
            "status": "onboarded", "basic_org": org,
            "submitted_at": f"{onboarded_on}T00:00:00+00:00",
        }).eq("id", app_id).execute()
        print(f"  {org}: promoted existing application {app_id} to onboarded")
    else:
        # basic_teammates is NOT NULL (default '[]'::jsonb) — omitted here
        # rather than sent as an explicit null, so the column default
        # applies instead of a 23502.
        row = sb.table("sip_applications").insert({
            "user_id": user.id, "status": "onboarded", "basic_org": org,
            "submitted_at": f"{onboarded_on}T00:00:00+00:00",
        }).execute().data[0]
        app_id = row["id"]
        print(f"  {org}: provisioned onboarded application {app_id}")

    # Only insert the transition once — _resolve_onboarded_on takes the
    # EARLIEST such row, so a duplicate at a later date is harmless, but a
    # duplicate at an earlier one would silently lengthen the backlog.
    log_exists = (sb.table("application_status_log").select("id")
                  .eq("application_id", app_id).eq("application_track", "sip")
                  .eq("to_status", "onboarded").limit(1).execute().data or [])
    if not log_exists:
        sb.table("application_status_log").insert({
            "application_id": app_id, "application_track": "sip",
            "from_status": "submitted", "to_status": "onboarded",
            "changed_at": f"{onboarded_on}T00:00:00+00:00",
        }).execute()
        print(f"  {org}: onboarding log stamped {onboarded_on}")
    else:
        print(f"  {org}: onboarding log already present")
    return app_id


def _token(sb, email: str) -> str:
    from supabase import create_client
    otp = sb.auth.admin.generate_link(
        {"type": "magiclink", "email": email}).properties.email_otp
    anon = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])
    return anon.auth.verify_otp(
        {"email": email, "token": otp, "type": "email"}).session.access_token


def _make_caller(token: str):
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
    return call


def _fill_monthly(call, key: str, vals: dict, headline: str) -> None:
    """One monthly period, one commit. This used to be four PUTs (metrics,
    narrative, two-to-three entries sections) plus a separate submit POST;
    those five routes are gone (Task 1) — `import/commit` accepts every
    section in one body and `submit: true` finalizes it in the same call."""
    code, bundle = call("GET", f"/founder/mis/monthly/{key}")
    if code != 200:
        print(f"    {key}: GET failed {code} {bundle}")
        return
    if bundle["period"]["status"] != "draft":
        print(f"    {key}: already {bundle['period']['status']}, skipping")
        return

    # Full rows only. put_metrics (called by commit) is a full-row upsert:
    # any field left out is written as NULL, so a partial row silently
    # erases target/commentary. `trl_level` is server-set from the AIR
    # round; the router rejects a founder-supplied `actual` for it.
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
            row |= {"label": "Field uptime (%)", "actual": 98.1, "rag": "green"}
        if k == "product_metric_2":
            row |= {"label": "Mean site turnaround (days)", "actual": 6, "rag": "amber"}
        rows.append(row)

    commit_body = {
        "metrics": rows,
        "narrative": {
            "exec.headline_win": headline,
            "exec.biggest_concern": "Runway tightens if the next raise slips a quarter.",
            "exec.commercial": f"{vals['active_customers']} active customers, "
                               f"{vals['new_lois']} new LOI(s) this month.",
            "exec.cash": f"₹{vals['cash_in_bank']}L in bank, "
                         f"₹{vals['net_burn_month']}L monthly burn.",
            "exec.top_ask": "Warm intros to operators who could pilot the next site.",
            "traction.sharpest_wedge": "The first paid deployment is the proof point "
                                       "every later conversation leans on.",
            "traction.not_working": "Cold outbound; cycles are too long for our runway.",
            "fin.cash_and_runway": f"₹{vals['cash_in_bank']}L, "
                                   f"{vals['runway_months']} months at current burn.",
        },
        "entries": {
            "milestones": [
                {"milestone": "Second site live", "owner": "Ops",
                 "status": "On Track", "notes": "Tracking to plan."},
                {"milestone": "Sustain uptime above target", "owner": "Eng",
                 "status": "On Track", "notes": "Holding through the latest deployment."},
                {"milestone": "Close the next funding conversation", "owner": "CEO",
                 "status": "At Risk", "notes": "Early-stage conversations only."},
            ],
            "risks": [
                {"severity": "amber", "what_happened": "Hardware lead times longer than modelled",
                 "impact": "Slower rollout of the next unit",
                 "mitigation": "Ordered ahead of confirmed demand for the next two sites."},
                {"severity": "red", "what_happened": "Next funding round not yet open",
                 "impact": f"Runway {vals['runway_months']} months",
                 "mitigation": "Parallel non-dilutive grant application submitted."},
            ],
            "asks": [
                {"priority": 1, "category": "customer_partnership_intros",
                 "ask": "Intros to operators who could pilot the next deployment."},
                {"priority": 2, "category": "investor_intros",
                 "ask": "Deep-tech seed funds comfortable with hardware timelines."},
            ],
        },
        "submit": True,
    }
    code, res = call("POST", f"/founder/mis/monthly/{key}/import/commit", commit_body)
    status = res.get("period", {}).get("status") if isinstance(res, dict) else res
    print(f"    monthly {key}: filled -> commit {code} ({status})")


def _fill_quarterly(call, qk: str, narrative: dict, amounts: dict,
                     headcount: list[dict], planned_vs_actual: list[dict],
                     next_milestones: list[dict]) -> None:
    """One quarterly period, one commit — same collapse as `_fill_monthly`."""
    code, qb = call("GET", f"/founder/mis/quarterly/{qk}")
    if code != 200:
        print(f"    {qk}: GET failed {code} {qb}")
        return
    if qb["period"]["status"] != "draft":
        print(f"    {qk}: already {qb['period']['status']}, skipping")
        return

    fin = []
    for f in qb.get("financials", []):
        fin.append({"series": f["series"], "bucket": f["bucket"],
                    "amount": amounts.get(f["series"], {}).get(f["bucket"], f.get("amount"))})

    # net_change is DERIVED per category against the previous quarter and
    # the Total row carries none at all — never sent, never computed here.
    commit_body = {
        "narrative": narrative,
        "financials": fin,
        "headcount": headcount,
        "entries": {
            "planned_vs_actual": planned_vs_actual,
            "next_milestones": next_milestones,
        },
        "submit": True,
    }
    code, res = call("POST", f"/founder/mis/quarterly/{qk}/import/commit", commit_body)
    status = res.get("period", {}).get("status") if isinstance(res, dict) else res
    print(f"    quarterly {qk}: filled -> commit {code} ({status})")


def main() -> None:
    _guard()
    from app.supabase_client import get_admin_client
    sb = get_admin_client()

    for venture in VENTURES:
        print(f"== {venture['org']} ({venture['email']}) ==")
        if venture["provision"]:
            _ensure_onboarded_venture(sb, venture["email"], venture["org"],
                                      venture["onboarded_on"])
        else:
            print(f"  {venture['org']}: not provisioned by this script "
                  "(pre-existing onboarded venture on staging)")

        token = _token(sb, venture["email"])
        call = _make_caller(token)

        # Only GET /founder/mis (not a specific period GET) runs
        # ensure_periods and creates period rows in the first place —
        # every per-period route below 404s until this has run once.
        code, idx = call("GET", "/founder/mis")
        if code != 200:
            print(f"  GET /founder/mis failed {code} {idx}")
            continue

        for key, vals, headline in venture["months"]:
            _fill_monthly(call, key, vals, headline)
        for qk, narrative, amounts, headcount, planned, nextm in venture["quarterlies"]:
            _fill_quarterly(call, qk, narrative, amounts, headcount, planned, nextm)

        code, idx = call("GET", "/founder/mis")
        for kind in ("monthly", "quarterly"):
            rows = idx.get(kind, [])
            print("    " + kind + ": " + ", ".join(
                f"{r['period_key']}={r['status']}{'/overdue' if r.get('overdue') else ''}"
                for r in rows))
        print()


if __name__ == "__main__":
    main()
