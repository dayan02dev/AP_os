"""Seed the staging DB with the design mockup's residency-journey demo data
(5 experiments + 5 tasks + an approved mentor review) so the Approach wizard
and residency dashboard render like TIR Onboarding.dc.html for the TIR
founder test account.

STAGING ONLY. Refuses to run unless SUPABASE_URL is the staging project.
Resolves the target application by the test account's EMAIL + status
(offered or onboarded — the same gate as require_founder_access in
app/routers/founder.py), not by a hardcoded application id, so it stays
correct if the seed account's application changes.

Run (does NOT run automatically — this file is not imported/executed by app
code):
    cd backend && set -a && source .env.staging && set +a
    python scripts/seed_founder_journey.py --dry-run
    python scripts/seed_founder_journey.py
    python scripts/seed_founder_journey.py --email someone.else@artpark.info
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import date
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

STAGING_REF = "exqmxvdtcsvpgtftwjml"
DEFAULT_EMAIL = "tir.founder.test@artpark.info"
_ACCESS_STATUSES = ("offered", "onboarded")

# Transcribed verbatim from TIR Onboarding.dc.html state.experiments
# (ids e1,e2,e5,e3,e4 in that display order — id text dropped, "exp_idx"
# below is this list's 0-based index, used only to wire founder_tasks.exp_id
# to the freshly-inserted experiment uuids).
EXPERIMENTS = [
    {  # e1
        "track": "technical", "gate": 1, "risk": "high", "status": "running",
        "test_type": "retro", "start_week": 1, "weeks": 6, "sort_order": 0,
        "assumption": "Cry-acoustic features carry predictive signal beyond heart-rate variability alone.",
        "hypothesis": "A combined acoustic + HRV model beats an HRV-only baseline on retrospective data.",
        "test": "Retrospective analysis on 300 labelled recordings from the partner hospital archive.",
        "pass_criteria": "ΔAUROC ≥ 0.05 over the HRV-only baseline at 90% specificity.",
        "kill_criteria": "ΔAUROC < 0.02 — acoustics add nothing; drop the mic array.",
    },
    {  # e2
        "track": "technical", "gate": 3, "risk": "medium", "status": "not-started",
        "test_type": "breadboard", "start_week": 14, "weeks": 6, "sort_order": 1,
        "assumption": "The bedside unit can run inference inside its power and thermal budget.",
        "hypothesis": "The quantised model runs under 150 ms per inference at under 2 W on the target SoC.",
        "test": "Port the quantised model to an eval board; benchmark latency, power and thermals over 24 hrs.",
        "pass_criteria": "Latency < 150 ms, power < 2 W, junction temp < 70°C.",
        "kill_criteria": "Sustained power > 3 W or latency > 250 ms after optimisation.",
    },
    {  # e5
        "track": "technical", "gate": 3, "risk": "high", "status": "not-started",
        "test_type": "prototype", "start_week": 16, "weeks": 8, "sort_order": 2,
        "assumption": "Clinicians trust the alert enough to act on it before blood-culture confirmation.",
        "hypothesis": "In a silent shadow deployment, flagged cases prompt earlier clinical review than standard of care.",
        "test": "Silent shadow deployment beside two NICU cots for six weeks; compare alert timing to eventual diagnosis.",
        "pass_criteria": "Median lead time > 6 hrs and clinician trust score ≥ 4/5.",
        "kill_criteria": "Median lead time < 2 hrs or trust score < 3/5.",
    },
    {  # e3
        "track": "commercial", "gate": 1, "risk": "high", "status": "running",
        "test_type": "customer", "start_week": 1, "weeks": 5, "sort_order": 3,
        "assumption": "Neonatologists will act on a pre-culture alert instead of waiting for blood-culture confirmation.",
        "hypothesis": "Most target clinicians say a validated early alert would change how they manage a suspected case.",
        "test": "15–20 structured conversations with NICU clinicians across four hospitals.",
        "pass_criteria": "≥ 12 of 18 would change management on a validated alert.",
        "kill_criteria": "< 6 of 18 — no clinical pull for pre-culture alerting.",
    },
    {  # e4
        "track": "commercial", "gate": 2, "risk": "high", "status": "not-started",
        "test_type": "customer", "start_week": 8, "weeks": 8, "sort_order": 4,
        "assumption": "A hospital will commit to a paid pilot — not just a free trial.",
        "hypothesis": "At least one design partner signs a pilot agreement contingent on the demo.",
        "test": "Convert the two warmest interviews into design-partner relationships and table a pilot LOI.",
        "pass_criteria": "≥ 1 written LOI or pilot agreement contingent on the demo.",
        "kill_criteria": "0 partners willing to co-design after six weeks of conversations.",
    },
]

# Transcribed from state.tasks (t1..t5). exp_idx points into EXPERIMENTS
# above by list position (e1=0, e2=1, e5=2, e3=3, e4=4).
TASKS = [
    {"task": "Sign data-sharing + ethics MoU with partner NICU", "exp_idx": 0,
     "owner": "Priya", "effort": 2, "status": "done", "sort_order": 0},
    {"task": "Build shadow-mode logging harness", "exp_idx": 2,
     "owner": "Arjun", "effort": 2, "status": "doing", "sort_order": 1},
    {"task": "Curate & label 300 retrospective recordings", "exp_idx": 0,
     "owner": "Meera", "effort": 3, "status": "todo", "sort_order": 2},
    {"task": "Run 18 NICU clinician interviews", "exp_idx": 3,
     "owner": "Priya", "effort": 2, "status": "todo", "sort_order": 3},
    {"task": "Quantise model & port to eval board", "exp_idx": 1,
     "owner": "Arjun", "effort": 3, "status": "todo", "sort_order": 4},
]

_APPROVED_BY = "Dr. Anitha Krishnan"
_MENTOR_QUOTE = (
    "Strong prioritisation — the shadow deployment is the right first bet. "
    "Tighten the success metric on EXP 02 to a single AUROC threshold and "
    "you're clear to run. Budget looks reasonable. Kicking off the clock."
)


def _guard():
    url = os.environ.get("SUPABASE_URL", "")
    if STAGING_REF not in url:
        sys.exit(f"refusing to run: SUPABASE_URL is not staging ({STAGING_REF}). Got: {url!r}")


def _find_user_by_email(sb, email: str):
    """Paginated auth.admin.list_users() email lookup (list_users() does not
    auto-iterate — same pattern as scripts/seed_leadership_user.py)."""
    target = email.lower()
    page = 1
    while True:
        batch = sb.auth.admin.list_users(page=page, per_page=200)
        if not batch:
            return None
        user = next((u for u in batch if (u.email or "").lower() == target), None)
        if user or len(batch) < 200:
            return user
        page += 1


def _find_application(sb, user_id: str) -> dict | None:
    rows = (
        sb.table("tir_applications").select("id,status,submitted_at")
        .eq("user_id", user_id).in_("status", list(_ACCESS_STATUSES))
        .order("submitted_at", desc=True).limit(1).execute().data
        or []
    )
    return rows[0] if rows else None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--email", default=DEFAULT_EMAIL,
                    help="test founder account email (default: %(default)s)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    _guard()

    from app.supabase_client import get_admin_client
    sb = get_admin_client()
    print(f"→ Target SUPABASE_URL = {os.environ['SUPABASE_URL']}")

    user = _find_user_by_email(sb, args.email)
    if not user:
        sys.exit(f"refusing to run: no auth user found for {args.email!r}")

    app_row = _find_application(sb, user.id)
    if not app_row:
        sys.exit(f"refusing to run: {args.email!r} has no offered/onboarded TIR application")
    application_id = app_row["id"]
    print(f"→ found application {application_id} (status={app_row['status']}) for {args.email}")

    if args.dry_run:
        print(f"[dry-run] would seed {len(EXPERIMENTS)} experiments, "
              f"{len(TASKS)} tasks, review=approved for application {application_id}")
        return 0

    already = (
        sb.table("founder_experiments").select("id")
        .eq("application_id", application_id).limit(1).execute().data or []
    )
    if already:
        print("already seeded (founder_experiments non-empty) — skipping to stay idempotent")
        return 0

    inserted = sb.table("founder_experiments").insert(
        [{**e, "application_id": application_id} for e in EXPERIMENTS]
    ).execute().data
    by_sort_order = {row["sort_order"]: row["id"] for row in inserted}

    sb.table("founder_tasks").insert([
        {
            "application_id": application_id,
            "task": t["task"],
            "exp_id": by_sort_order[t["exp_idx"]],
            "owner": t["owner"],
            "effort": t["effort"],
            "status": t["status"],
            "sort_order": t["sort_order"],
        }
        for t in TASKS
    ]).execute()

    sb.table("founder_review").upsert({
        "application_id": application_id,
        "status": "approved",
        "approved_by": _APPROVED_BY,
        "approved_on": date.today().strftime("%d %b %Y"),
        "mentor_comment": _MENTOR_QUOTE,
    }, on_conflict="application_id").execute()

    print(f"✓ seeded {len(EXPERIMENTS)} experiments, {len(TASKS)} tasks, "
          f"review=approved for application {application_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
