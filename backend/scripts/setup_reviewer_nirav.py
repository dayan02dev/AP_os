#!/usr/bin/env python3
"""Set up nirav@artpark.in as a reviewer+leadership account and assign every
non-draft application to him. Idempotent + dry-run-able.

What it does (against the SUPABASE_URL in the loaded env):
  1. Find nirav@artpark.in in auth; CREATE him (email-confirmed) if missing
     (staging won't have him) — prints the generated password.
  2. Ensure user_roles has BOTH 'reviewer' and 'leadership' for him
     (adds whichever is missing; never removes anything).
  3. Ensure a profiles row exists.
  4. Assign EVERY non-draft tir_applications + sip_applications row to him via
     reviewer_assignments (state='pending'), skipping ones he's already
     assigned to. Splits them into 2 even "batches" purely for the due_at
     label (batch A due +14d, batch B due +28d) so the queue's Due column is
     populated and the apps visibly group into two halves.

Safety:
  * Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from env (load the right
    .env.{prod,staging} before running). Prints the target URL.
  * Requires --yes to mutate; --dry-run shows counts and writes nothing.
  * Only INSERTs/role-adds; never updates or deletes existing app/review data.

Usage:
    cd backend && source .venv/bin/activate
    # preview (no writes):
    python scripts/setup_reviewer_nirav.py --env staging --dry-run
    python scripts/setup_reviewer_nirav.py --env prod --dry-run
    # apply:
    python scripts/setup_reviewer_nirav.py --env staging --yes
    python scripts/setup_reviewer_nirav.py --env prod --yes
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

EMAIL = "nirav@artpark.in"
WANT_ROLES = ("reviewer", "leadership")


def _gen_password() -> str:
    return secrets.token_urlsafe(16) + "!1Aa"


def _find_user(sb, email: str):
    target = email.lower()
    page = 1
    while True:
        batch = sb.auth.admin.list_users(page=page, per_page=200)
        if not batch:
            return None
        hit = next((u for u in batch if (u.email or "").lower() == target), None)
        if hit:
            return hit
        if len(batch) < 200:
            return None
        page += 1


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--env", choices=["prod", "staging"], required=True)
    ap.add_argument("--password", default=None)
    ap.add_argument("--yes", action="store_true", help="confirm writes")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if load_dotenv:
        # clear so a second invocation in the same shell doesn't leak
        os.environ.pop("SUPABASE_URL", None)
        os.environ.pop("SUPABASE_SERVICE_ROLE_KEY", None)
        load_dotenv(_BACKEND_ROOT / f".env.{args.env}", override=True)

    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    print(f"→ Target ({args.env}) SUPABASE_URL = {url}")
    if not args.dry_run and not args.yes:
        print("✗ Refusing to mutate without --yes (or use --dry-run).")
        return 2

    from supabase import create_client
    sb = create_client(url, key)

    # ── 1. user ────────────────────────────────────────────────────────
    user = _find_user(sb, EMAIL)
    created_password = None
    if user is None:
        if args.dry_run:
            print(f"[dry-run] would CREATE auth user {EMAIL} (email-confirmed)")
            user_id = "(new-user-id)"
        else:
            created_password = args.password or _gen_password()
            res = sb.auth.admin.create_user({
                "email": EMAIL,
                "password": created_password,
                "email_confirm": True,
            })
            user = res.user
            user_id = user.id
            print(f"✓ created auth user {EMAIL}  (id={user_id})")
    else:
        user_id = user.id
        print(f"• auth user exists: {EMAIL}  (id={user_id})")

    # ── 2. roles (additive) ────────────────────────────────────────────
    existing_roles: list[str] = []
    if user_id != "(new-user-id)":
        existing_roles = [
            r["role"] for r in
            (sb.table("user_roles").select("role").eq("user_id", user_id).execute().data or [])
        ]
    to_add = [r for r in WANT_ROLES if r not in existing_roles]
    print(f"  roles now: {existing_roles or '[]'} ; will add: {to_add or '[]'} (removes: none)")
    if not args.dry_run:
        for role in to_add:
            sb.table("user_roles").insert({
                "user_id": user_id, "role": role, "granted_by": user_id,
            }).execute()
        # profiles row (upsert, no-op if present)
        try:
            sb.table("profiles").upsert(
                {"id": user_id, "email": EMAIL}, on_conflict="id",
            ).execute()
        except Exception as e:  # noqa: BLE001
            print(f"  (profiles upsert note: {str(e)[:80]})")

    # ── 3. assignments ─────────────────────────────────────────────────
    apps: list[tuple[str, str]] = []  # (id, track)
    for track in ("tir", "sip"):
        rows = (sb.table(f"{track}_applications").select("id,status")
                .neq("status", "draft").execute().data or [])
        apps.extend((r["id"], track) for r in rows)
    apps.sort(key=lambda x: (x[1], x[0]))  # stable order for the 2-way split

    if user_id != "(new-user-id)":
        already = {
            (a["application_id"], a["application_track"]) for a in
            (sb.table("reviewer_assignments").select("application_id,application_track")
             .eq("reviewer_user_id", user_id).execute().data or [])
        }
    else:
        already = set()
    todo = [a for a in apps if a not in already]

    half = (len(todo) + 1) // 2
    now = datetime.now(UTC)
    due_a = (now + timedelta(days=14)).isoformat()
    due_b = (now + timedelta(days=28)).isoformat()

    print(f"  non-draft apps total: {len(apps)} "
          f"(tir={sum(1 for _,t in apps if t=='tir')}, sip={sum(1 for _,t in apps if t=='sip')})")
    print(f"  already assigned to nirav: {len(apps) - len(todo)} ; to assign now: {len(todo)}")
    print(f"  batch A (due {due_a[:10]}): {half} ; batch B (due {due_b[:10]}): {len(todo)-half}")

    # Schema-aware: staging and prod reviewer_assignments have drifted
    # (staging lacks `state`; prod lacks declined_at/etc). Probe which of our
    # payload columns actually exist and only insert those.
    _CANDIDATE_COLS = ["application_id", "application_track", "reviewer_user_id",
                       "assigned_by", "assigned_at", "state", "due_at"]
    present_cols = []
    for c in _CANDIDATE_COLS:
        try:
            sb.table("reviewer_assignments").select(c).limit(1).execute()
            present_cols.append(c)
        except Exception:  # noqa: BLE001
            pass
    print(f"  reviewer_assignments insertable cols: {present_cols}")

    if not args.dry_run and todo:
        for i, (app_id, track) in enumerate(todo):
            full = {
                "application_id": app_id,
                "application_track": track,
                "reviewer_user_id": user_id,
                "assigned_by": user_id,
                "assigned_at": now.isoformat(),
                "state": "pending",
                "due_at": due_a if i < half else due_b,
            }
            row = {k: v for k, v in full.items() if k in present_cols}
            sb.table("reviewer_assignments").insert(row).execute()
        print(f"✓ inserted {len(todo)} reviewer_assignments")

    if created_password:
        print("\n================ HANDOVER ================")
        print(f"  {args.env} login: {EMAIL}")
        print(f"  password: {created_password}")
        print("=========================================")

    print("\nDONE" + (" (dry-run, no writes)" if args.dry_run else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
