#!/usr/bin/env python3
"""Configure cohort roles + redistribute reviewer assignments. Idempotent + dry-run-able.

Target state (against the SUPABASE_URL in the loaded env):
  ROLES
    • nirav@artpark.in      → ensure 'admin'; drop 'reviewer' (admin is the
                               assigner, not in the review pool). Also: revoke
                               'admin' from EVERY other user (nirav is the only admin).
    • raghu@artpark.in      → exactly {reviewer, leadership} (can switch both panels)
    • rohan.sakpal@artpark.in → exactly {reviewer} (strip any other roles); must exist
    • abhijitlele@artpark.in  → exactly {reviewer}; CREATE (email-confirmed) if missing
  ASSIGNMENTS
    • Delete nirav's reviewer_assignments that have NO submitted review (frees the apps).
    • Round-robin every non-draft tir+sip application across the review pool
      [raghu, rohan, abhijit], skipping pairs already assigned. ~1 reviewer/app.

Safety:
    • Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.{env}. Prints target URL.
    • --dry-run writes nothing (prints every intended change). --yes required to mutate.
    • Never deletes an assignment that already has a submitted review.

Usage:
    cd backend && source .venv/bin/activate
    python scripts/setup_cohort_roles.py --env prod --dry-run
    python scripts/setup_cohort_roles.py --env prod --yes
"""
from __future__ import annotations

import argparse
import os
import secrets
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

ADMIN_EMAIL = "nirav@artpark.in"
# email -> exact target role set (None target means "additive admin" handled specially)
TARGET_EXACT = {
    "raghu@artpark.in": {"reviewer", "leadership"},
    "rohan.sakpal@artpark.in": {"reviewer"},
    "abhijitlele@artpark.in": {"reviewer"},
}
CREATE_IF_MISSING = {"abhijitlele@artpark.in", "rohan.sakpal@artpark.in"}  # raghu must already exist
POOL_EMAILS = ["raghu@artpark.in", "rohan.sakpal@artpark.in", "abhijitlele@artpark.in"]


def _gen_password() -> str:
    return secrets.token_urlsafe(16) + "!1Aa"


def _all_auth_users(sb) -> list:
    users, page = [], 1
    while True:
        batch = sb.auth.admin.list_users(page=page, per_page=200)
        if not batch:
            break
        users.extend(batch)
        if len(batch) < 200:
            break
        page += 1
    return users


def _roles_of(sb, user_id: str) -> set[str]:
    rows = sb.table("user_roles").select("role").eq("user_id", user_id).execute().data or []
    return {r["role"] for r in rows}


def _set_exact_roles(sb, user_id, email, target: set[str], dry: bool) -> None:
    cur = _roles_of(sb, user_id)
    add = target - cur
    remove = cur - target
    print(f"  {email}: now={sorted(cur) or '[]'} target={sorted(target)} "
          f"→ add={sorted(add) or '[]'} remove={sorted(remove) or '[]'}")
    if dry:
        return
    for role in add:
        sb.table("user_roles").insert(
            {"user_id": user_id, "role": role, "granted_by": user_id}).execute()
    for role in remove:
        sb.table("user_roles").delete().eq("user_id", user_id).eq("role", role).execute()
    sb.table("profiles").upsert({"id": user_id, "email": email}, on_conflict="id").execute()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", choices=["prod", "staging"], required=True)
    ap.add_argument("--yes", action="store_true", help="confirm writes")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if load_dotenv:
        os.environ.pop("SUPABASE_URL", None)
        os.environ.pop("SUPABASE_SERVICE_ROLE_KEY", None)
        load_dotenv(_BACKEND_ROOT / f".env.{args.env}", override=True)

    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    dry = args.dry_run or not args.yes
    print(f"→ Target ({args.env}) SUPABASE_URL = {url}")
    print(f"→ MODE = {'DRY-RUN (no writes)' if dry else 'APPLY (--yes)'}\n")

    from supabase import create_client
    sb = create_client(url, key)

    users = _all_auth_users(sb)
    by_email = {(u.email or "").lower(): u for u in users}

    # ── resolve / create the four accounts ─────────────────────────────
    print("ACCOUNTS")
    ids: dict[str, str] = {}
    created: dict[str, str] = {}
    for email in [ADMIN_EMAIL, *TARGET_EXACT.keys()]:
        u = by_email.get(email.lower())
        if u:
            ids[email] = u.id
            print(f"  • exists: {email} (id={u.id})")
        elif email in CREATE_IF_MISSING:
            if dry:
                print(f"  [dry-run] would CREATE {email} (email-confirmed, reviewer-only)")
                ids[email] = f"(new:{email})"
            else:
                pw = _gen_password()
                res = sb.auth.admin.create_user(
                    {"email": email, "password": pw, "email_confirm": True})
                ids[email] = res.user.id
                created[email] = pw
                print(f"  ✓ created: {email} (id={res.user.id})")
        else:
            print(f"  ✗ MISSING (required, not creating): {email} — skipping its role changes")

    # ── roles ──────────────────────────────────────────────────────────
    print("\nROLES")
    # nirav: ensure admin + leadership + reviewer (all three); remove nothing.
    nid = ids.get(ADMIN_EMAIL)
    if nid and not nid.startswith("(new"):
        cur = _roles_of(sb, nid)
        want = {"admin", "leadership", "reviewer"}
        add = want - cur
        print(f"  {ADMIN_EMAIL}: now={sorted(cur)} want⊇{sorted(want)} → "
              f"add={sorted(add) or '[]'} remove=[] (keeps all three roles)")
        if not dry:
            for r in add:
                sb.table("user_roles").insert(
                    {"user_id": nid, "role": r, "granted_by": nid}).execute()
    # the other three: exact role sets
    for email, target in TARGET_EXACT.items():
        uid = ids.get(email)
        if uid and not uid.startswith("(new"):
            _set_exact_roles(sb, uid, email, target, dry)
        elif uid and uid.startswith("(new"):
            print(f"  {email}: (new account) → set {sorted(target)}")

    # ── admin exclusivity: revoke 'admin' from everyone except nirav ────
    print("\nADMIN EXCLUSIVITY (only nirav may be admin)")
    admin_rows = sb.table("user_roles").select("user_id").eq("role", "admin").execute().data or []
    extra_admins = [r["user_id"] for r in admin_rows if r["user_id"] != nid]
    print(f"  other users with 'admin': {len(extra_admins)}")
    if not dry:
        for uid in extra_admins:
            sb.table("user_roles").delete().eq("user_id", uid).eq("role", "admin").execute()

    # ── assignments: clear nirav's (unreviewed), then round-robin pool ──
    print("\nASSIGNMENTS")
    pool = [ids[e] for e in POOL_EMAILS if ids.get(e) and not ids[e].startswith("(new")]
    pool_dry = [e for e in POOL_EMAILS if not (ids.get(e) and not ids[e].startswith("(new"))]
    if pool_dry:
        print(f"  (pool members not yet real this run: {pool_dry})")

    if nid and not nid.startswith("(new"):
        nir_assigns = (sb.table("reviewer_assignments")
                       .select("id,application_id,application_track")
                       .eq("reviewer_user_id", nid).execute().data or [])
        reviewed = {
            (r["application_id"], r["application_track"]) for r in
            (sb.table("reviews").select("application_id,application_track,status")
             .eq("reviewer_user_id", nid).eq("status", "submitted").execute().data or [])
        }
        clearable = [a for a in nir_assigns if (a["application_id"], a["application_track"]) not in reviewed]
        print(f"  nirav assignments: {len(nir_assigns)} ; clearable (no submitted review): {len(clearable)}")
        if not dry:
            for a in clearable:
                sb.table("reviewer_assignments").delete().eq("id", a["id"]).execute()
            print(f"  ✓ cleared {len(clearable)} nirav assignments")

    # all non-draft apps
    apps: list[tuple[str, str]] = []
    for track in ("tir", "sip"):
        rows = (sb.table(f"{track}_applications").select("id,status")
                .neq("status", "draft").execute().data or [])
        apps.extend((r["id"], track) for r in rows)
    apps.sort(key=lambda x: (x[1], x[0]))

    # existing pool assignments (skip dupes, and account for the clear above in apply mode)
    existing = set()
    if pool:
        ex = (sb.table("reviewer_assignments")
              .select("application_id,application_track,reviewer_user_id")
              .in_("reviewer_user_id", pool).execute().data or [])
        existing = {(r["application_id"], r["application_track"], r["reviewer_user_id"]) for r in ex}

    # column probe (schema drift safety)
    cand = ["application_id", "application_track", "reviewer_user_id",
            "assigned_by", "assigned_at", "state", "due_at"]
    present = []
    for c in cand:
        try:
            sb.table("reviewer_assignments").select(c).limit(1).execute()
            present.append(c)
        except Exception:  # noqa: BLE001
            pass

    now = datetime.now(UTC)
    due = (now + timedelta(days=14)).isoformat()
    pool_for_split = pool if pool else POOL_EMAILS  # for dry-run counts when accounts new
    n = len(pool_for_split)
    per = {e: 0 for e in (pool if pool else POOL_EMAILS)}
    to_insert = []
    for i, (app_id, track) in enumerate(apps):
        rid = pool_for_split[i % n]
        # skip if (in apply mode) this pair already exists
        if pool and (app_id, track, rid) in existing:
            continue
        to_insert.append((app_id, track, rid))
        per[rid] = per.get(rid, 0) + 1

    print(f"  non-draft apps: {len(apps)} ; round-robin across {n} reviewers")
    if pool:
        label = {v: k for k, v in ids.items()}
        for rid in pool:
            print(f"    → {label.get(rid, rid)}: +{per.get(rid,0)}")
    else:
        for e in POOL_EMAILS:
            print(f"    → {e}: ~{len(apps)//n}")
    print(f"  total new assignments to insert: {len(to_insert)}")

    if not dry and pool:
        for app_id, track, rid in to_insert:
            full = {
                "application_id": app_id, "application_track": track,
                "reviewer_user_id": rid, "assigned_by": nid or rid,
                "assigned_at": now.isoformat(), "state": "pending", "due_at": due,
            }
            sb.table("reviewer_assignments").insert(
                {k: v for k, v in full.items() if k in present}).execute()
        print(f"  ✓ inserted {len(to_insert)} reviewer_assignments")

    if created:
        print("\n================ NEW ACCOUNT HANDOVER ================")
        for email, pw in created.items():
            print(f"  {email}  password: {pw}")
        print("=====================================================")

    print("\nDONE" + (" (dry-run, no writes)" if dry else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
