"""One-off STAGING remediation: de-roster the stranded `demo@artpark.test`.

WHY THIS EXISTS
    The first cut of `seed_demo_cohort.py` minted the demo login on
    `demo@artpark.test`. Supabase Auth's admin API happily created it, so the
    seed reported success — but `.test` is an IANA reserved TLD (RFC 6761) and
    Pydantic's `EmailStr`, which validates the body of
    POST /auth/sign-in-password, refuses it:

        "value is not a valid email address: The part after the @-sign is a
         special-use or reserved name that cannot be used with email."

    The seed now uses `demo@artpark.in` (see `DEMO_EMAIL`). That leaves the old
    account behind holding admin + leadership + reviewer + applicant, a
    `reviewer_profiles` row and four `reviewer_assignments` — i.e. showing up
    on the admin Reviewers screen as a roster member who cannot log in. This
    script removes it from the roster.

WHY IT IS NOT AN AUTH-USER DELETE
    `reviews.reviewer_user_id` is `references auth.users(id) ON DELETE
    CASCADE` (migration 014). Deleting the auth user would take the review it
    submitted with it. So this is a **de-rostering**, exactly the shape
    `app/services/roster_removal.py` implements for the admin "Delete"
    action — and it calls that service rather than re-implementing it:

        · delete every reviewer_assignments row   · KEEP every reviews row
        · delete batch_reviewers memberships      · KEEP the auth user
        · delete the reviewer_profiles row        · KEEP the profiles row
        · revoke the reviewer role

    The extra roles this account holds and a plain reviewer does not (admin,
    leadership, applicant) are revoked afterwards, so the address grants
    nothing anywhere.

SAFETY
    * Refuses to run unless SUPABASE_URL is the known staging project.
    * --dry-run is the default; nothing is written without --apply.
    * Only ever touches the ONE hard-coded address below.
    * Never deletes an auth user, a profiles row, or a reviews row.

USAGE
    cd backend
    python scripts/deroster_stranded_demo_account.py          # dry run
    python scripts/deroster_stranded_demo_account.py --apply
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

try:
    from dotenv import load_dotenv  # type: ignore

    for candidate in (".env.staging", ".env"):
        path = _BACKEND_ROOT / candidate
        if path.exists():
            load_dotenv(path)
            break
except ImportError:
    pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-5s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("deroster_stranded_demo_account")

STAGING_PROJECT_ID = "exqmxvdtcsvpgtftwjml"
PROD_PROJECT_ID = "xtmszlpwgbyoumalgbhs"

# The single address this script is allowed to touch. Not a CLI argument on
# purpose: a one-off remediation should not double as a general de-rostering
# tool that can be pointed at anybody.
STRANDED_EMAIL = "demo@artpark.test"

# Roles a plain reviewer de-rostering does not cover.
_EXTRA_ROLES = ("admin", "leadership", "applicant")


def _guard(url: str) -> None:
    if PROD_PROJECT_ID in url:
        log.error("REFUSING: SUPABASE_URL points at PRODUCTION.")
        sys.exit(2)
    if STAGING_PROJECT_ID not in url:
        log.error("REFUSING: SUPABASE_URL is not the known staging project.")
        log.error("  expected to contain: %s", STAGING_PROJECT_ID)
        sys.exit(2)


def _find_user_by_email(sb, email: str):
    """list_users does not auto-paginate — walk every page."""
    target = email.lower()
    page = 1
    while True:
        batch = sb.auth.admin.list_users(page=page, per_page=200)
        if not batch:
            return None
        hit = next((u for u in batch if (u.email or "").lower() == target), None)
        if hit or len(batch) < 200:
            return hit
        page += 1


def _count(sb, table: str, col: str, val: str) -> int:
    rows = sb.table(table).select("*").eq(col, val).execute().data or []
    return len([r for r in rows if r.get(col) == val])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true",
                    help="write changes (default is a dry run)")
    args = ap.parse_args()

    url = os.environ.get("SUPABASE_URL", "")
    _guard(url)
    log.info("target: staging (%s) — mode: %s", STAGING_PROJECT_ID,
             "APPLY" if args.apply else "DRY RUN")

    from app.services import roster_removal
    from app.supabase_client import get_admin_client

    sb = get_admin_client()

    user = _find_user_by_email(sb, STRANDED_EMAIL)
    if user is None:
        log.info("%s does not exist — nothing to de-roster.", STRANDED_EMAIL)
        return 0
    user_id = user.id

    roles = sorted(roster_removal._roles_of(sb, user_id))
    before = {
        "roles": roles,
        "reviewer_profiles": _count(sb, "reviewer_profiles", "reviewer_user_id", user_id),
        "reviewer_assignments": _count(sb, "reviewer_assignments", "reviewer_user_id", user_id),
        "batch_reviewers": _count(sb, "batch_reviewers", "reviewer_user_id", user_id),
        "reviews": _count(sb, "reviews", "reviewer_user_id", user_id),
    }
    log.info("found %s (%s)", STRANDED_EMAIL, user_id)
    log.info("  before: %s", before)

    if not args.apply:
        log.info("[dry-run] would de-roster the reviewer half (assignments, "
                 "batch memberships, reviewer_profiles, reviewer role), then "
                 "revoke %s. Would KEEP: the auth user, the profiles row, and "
                 "all %d reviews.", list(_EXTRA_ROLES), before["reviews"])
        return 0

    if "reviewer" in roles:
        result = roster_removal.remove_reviewer(sb, user_id, actor="deroster_stranded_demo_account")
        log.info("  reviewer de-rostered: %s", result)
    else:
        log.info("  no reviewer role — skipping the reviewer de-rostering")
        # The profile / assignments could still be orphaned; clear them anyway.
        roster_removal._delete_where(sb, "reviewer_assignments", {"reviewer_user_id": user_id})
        roster_removal._delete_where(sb, "batch_reviewers", {"reviewer_user_id": user_id})
        roster_removal._delete_where(sb, "reviewer_profiles", {"reviewer_user_id": user_id})

    for role in _EXTRA_ROLES:
        removed = roster_removal._delete_where(
            sb, "user_roles", {"user_id": user_id, "role": role})
        if removed:
            log.info("  revoked role: %s", role)

    after = {
        "roles": sorted(roster_removal._roles_of(sb, user_id)),
        "reviewer_profiles": _count(sb, "reviewer_profiles", "reviewer_user_id", user_id),
        "reviewer_assignments": _count(sb, "reviewer_assignments", "reviewer_user_id", user_id),
        "batch_reviewers": _count(sb, "batch_reviewers", "reviewer_user_id", user_id),
        "reviews": _count(sb, "reviews", "reviewer_user_id", user_id),
    }
    log.info("  after:  %s", after)

    problems = []
    if after["roles"]:
        problems.append(f"roles still granted: {after['roles']}")
    for key in ("reviewer_profiles", "reviewer_assignments", "batch_reviewers"):
        if after[key]:
            problems.append(f"{after[key]} {key} row(s) remain")
    if after["reviews"] != before["reviews"]:
        problems.append(
            f"reviews changed from {before['reviews']} to {after['reviews']} — "
            "this script must never lose a review")
    if problems:
        for p in problems:
            log.error("VERIFY FAILED: %s", p)
        return 1

    log.info("done — %s is off the roster, holds no roles, and its %d review(s) "
             "and auth account are intact.", STRANDED_EMAIL, after["reviews"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
