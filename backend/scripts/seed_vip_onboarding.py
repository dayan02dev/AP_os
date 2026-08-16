"""Seed the staging DB with an onboarded VIP (sip) founder for portal testing.

The VIP founder portal gates on owning a `sip` application in `offered` or
`onboarded`. Staging has sip applications, but none past `submitted`, so
nothing in the VIP portal is reachable until one is promoted. This promotes
the obvious test account and leaves every real applicant alone.

What it writes (all idempotent, all reversible):
  1. `sip_applications.status` -> 'onboarded' for the target account.
  2. An `application_status_log` row recording that transition. This is NOT
     bookkeeping: `founder_mis._resolve_onboarded_on` reads the earliest
     `to_status='onboarded'` row to decide which MIS reporting periods the
     venture owes. No log row means no periods, and an empty MIS page that
     looks like a bug. `--months-back` controls how much backlog exists.
  3. An `ai_screening` row carrying `project_name`, so the venture name
     renders in the portal header instead of an empty string.

It does NOT create auth users, touch the allow-list, or send anything. The
status change is written straight through the service-role client rather than
the API, so no decision email fires.

STAGING ONLY — refuses to run against any other project.

Run:
  cd backend
  set -a && source /Users/apple/Desktop/Final_AP_os/backend/.env.staging && set +a
  python scripts/seed_vip_onboarding.py            # dry run, prints the plan
  python scripts/seed_vip_onboarding.py --apply

Undo:
  python scripts/seed_vip_onboarding.py --revert --apply
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import UTC, datetime

STAGING_REF = "exqmxvdtcsvpgtftwjml"
DEFAULT_EMAIL = "claude-test-applicant-sip@artpark.in"
DEFAULT_PROJECT = "Autonomous warehouse picking"


def _guard() -> None:
    url = os.environ.get("SUPABASE_URL", "")
    if STAGING_REF not in url:
        sys.exit(
            f"refusing to run: SUPABASE_URL is not staging ({STAGING_REF}).\n"
            f"got: {url!r}\n"
            "This script promotes an application to 'onboarded'. Never point it at prod."
        )


def _months_back(months: int) -> datetime:
    """First of the month `months` before this one, at midnight UTC.

    Anchoring to the 1st keeps the generated MIS calendar predictable: the
    onboarding month is fully owed rather than half of it.
    """
    now = datetime.now(UTC)
    year, month = now.year, now.month - months
    while month <= 0:
        month += 12
        year -= 1
    return datetime(year, month, 1, tzinfo=UTC)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--email", default=DEFAULT_EMAIL,
                    help=f"auth email of the sip applicant to promote (default: {DEFAULT_EMAIL})")
    ap.add_argument("--project", default=DEFAULT_PROJECT,
                    help="venture name shown in the portal header")
    ap.add_argument("--months-back", type=int, default=3,
                    help="how long ago the venture onboarded; drives how many MIS "
                         "periods are generated (default: 3)")
    ap.add_argument("--application-id", default=None,
                    help="pick a specific sip application when the account has more "
                         "than one promotable row")
    ap.add_argument("--apply", action="store_true",
                    help="actually write; without this the script only prints its plan")
    ap.add_argument("--revert", action="store_true",
                    help="undo: status back to 'submitted', remove the onboarded log row")
    args = ap.parse_args()

    _guard()
    sys.path.insert(0, os.getcwd())
    from app.supabase_client import get_admin_client

    sb = get_admin_client()

    # ---- resolve the target ------------------------------------------------
    users = sb.auth.admin.list_users()
    user = next((u for u in users if (u.email or "").lower() == args.email.lower()), None)
    if user is None:
        sys.exit(f"no staging auth user with email {args.email!r}")

    apps = (sb.table("sip_applications").select("id,status,user_id")
            .eq("user_id", user.id).execute().data or [])
    if not apps:
        sys.exit(f"{args.email} has no sip_applications row")

    # A test account routinely has a leftover `draft` alongside its real
    # entry, so "exactly one application" is the wrong bar. Only a filed
    # application can be promoted; a draft never can. Refuse only when the
    # promotable set is itself ambiguous.
    promotable = {"submitted", "offered", "onboarded"}
    candidates = [a for a in apps if a["status"] in promotable]
    if args.application_id:
        candidates = [a for a in candidates if a["id"] == args.application_id]
        if not candidates:
            sys.exit(f"--application-id {args.application_id} is not a promotable "
                     f"sip application belonging to {args.email}")
    if not candidates:
        sys.exit(
            f"{args.email} has {len(apps)} sip application(s) but none in "
            f"{sorted(promotable)} — nothing to promote "
            f"(found: {sorted(a['status'] for a in apps)})"
        )
    if len(candidates) > 1:
        sys.exit(
            f"{args.email} has {len(candidates)} promotable sip applications; "
            "refusing to guess. Pass --application-id to choose."
        )
    app = candidates[0]
    app_id = app["id"]
    if len(apps) > len(candidates):
        skipped = sorted(a["status"] for a in apps if a is not app)
        print(f"note        : ignoring {len(apps) - len(candidates)} other row(s) {skipped}")

    target_status = "submitted" if args.revert else "onboarded"
    changed_at = _months_back(args.months_back)

    print(f"target      : {args.email}  (auth {user.id})")
    print(f"application : sip {app_id}")
    print(f"status      : {app['status']} -> {target_status}")
    if not args.revert:
        print(f"onboarded_on: {changed_at.date().isoformat()}  "
              f"({args.months_back} months back — drives the MIS calendar)")
        print(f"project     : {args.project}")
    if not args.apply:
        print("\nDRY RUN — nothing written. Re-run with --apply.")
        return

    # ---- write -------------------------------------------------------------
    if args.revert:
        sb.table("sip_applications").update({"status": "submitted"}).eq("id", app_id).execute()
        sb.table("application_status_log").delete() \
            .eq("application_id", app_id).eq("application_track", "sip") \
            .eq("to_status", "onboarded").execute()
        print("\nreverted. AIR/MIS rows created under this application are left in place —"
              "\ndelete them by hand if you want a truly clean slate.")
        return

    sb.table("sip_applications").update({"status": "onboarded"}).eq("id", app_id).execute()

    # Only insert the transition once — _resolve_onboarded_on takes the
    # EARLIEST such row, so a duplicate at a later date is harmless, but a
    # duplicate at an earlier one would silently lengthen the backlog.
    existing_log = (sb.table("application_status_log").select("id")
                    .eq("application_id", app_id).eq("application_track", "sip")
                    .eq("to_status", "onboarded").limit(1).execute().data or [])
    if existing_log:
        print("status log  : already present, left as-is")
    else:
        sb.table("application_status_log").insert({
            "application_id": app_id,
            "application_track": "sip",
            "from_status": app["status"],
            "to_status": "onboarded",
            "changed_at": changed_at.isoformat(),
        }).execute()
        print("status log  : inserted")

    sb.table("ai_screening").upsert(
        {"application_id": app_id, "application_track": "sip", "project_name": args.project},
        on_conflict="application_id,application_track",
    ).execute()
    print("project name: upserted")
    print("\ndone. Sign in as this account on the staging SPA to reach the VIP portal.")


if __name__ == "__main__":
    main()
