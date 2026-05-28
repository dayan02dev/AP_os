#!/usr/bin/env python3
"""Seed (or promote) a single LEADERSHIP user. Prod-safe + idempotent.

Makes the given email a leadership-only account:
  * creates the auth user (email-confirmed) if missing, else updates password
  * upserts profiles
  * ensures user_roles has 'leadership'; removes 'applicant' if present
Prints the email + password at the end so it can be handed over.

Usage:
    cd backend && source .venv/bin/activate
    python scripts/seed_leadership_user.py dev@artpark.in --yes
    python scripts/seed_leadership_user.py dev@artpark.in --password 'Xyz!1Aa' --yes
    python scripts/seed_leadership_user.py dev@artpark.in --dry-run

Reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from the environment
(populate via backend/.env.prod for production). Uses the service-role
key and bypasses RLS — it prints the target SUPABASE_URL and requires
--yes (or --dry-run) so you can confirm you are pointed at the right DB.
"""
from __future__ import annotations

import argparse
import os
import secrets
import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None


def reconcile_roles(existing: list[str]) -> tuple[list[str], list[str]]:
    """Return (roles_to_insert, roles_to_delete) for a leadership-only acct."""
    to_insert = [] if "leadership" in existing else ["leadership"]
    to_delete = ["applicant"] if "applicant" in existing else []
    return to_insert, to_delete


def _gen_password() -> str:
    # Supabase policy: upper+lower+digit+symbol. token_urlsafe lacks a symbol.
    return secrets.token_urlsafe(16) + "!1Aa"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("email")
    ap.add_argument("--password", default=None)
    ap.add_argument("--yes", action="store_true", help="confirm DB target")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if load_dotenv:
        load_dotenv(_BACKEND_ROOT / ".env.prod")
        load_dotenv(_BACKEND_ROOT / ".env", override=False)

    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    print(f"→ Target SUPABASE_URL = {url}")
    if not args.dry_run and not args.yes:
        print("✗ Refusing to mutate without --yes (or use --dry-run).")
        return 2

    from supabase import create_client
    client = create_client(url, key)

    password = args.password or _gen_password()
    users = client.auth.admin.list_users()
    user = next((u for u in users if (u.email or "").lower() == args.email.lower()), None)

    if args.dry_run:
        existing_roles: list[str] = []
        if user:
            rr = client.table("user_roles").select("role").eq("user_id", user.id).execute()
            existing_roles = [r["role"] for r in (rr.data or [])]
        ins, dele = reconcile_roles(existing_roles)
        print(f"[dry-run] user_exists={bool(user)} insert={ins} delete={dele}")
        return 0

    if user is None:
        created = client.auth.admin.create_user({
            "email": args.email,
            "password": password,
            "email_confirm": True,
        })
        user = created.user
        print(f"✓ created auth user {args.email}")
    else:
        client.auth.admin.update_user_by_id(user.id, {"password": password})
        print(f"✓ updated password for existing user {args.email}")

    client.table("profiles").upsert({"id": user.id, "email": args.email}).execute()

    rr = client.table("user_roles").select("role").eq("user_id", user.id).execute()
    existing_roles = [r["role"] for r in (rr.data or [])]
    to_insert, to_delete = reconcile_roles(existing_roles)
    for role in to_insert:
        client.table("user_roles").insert({"user_id": user.id, "role": role}).execute()
    for role in to_delete:
        client.table("user_roles").delete().eq("user_id", user.id).eq("role", role).execute()

    print("✓ leadership role ensured; applicant removed if present")
    print("\n──────── HAND OVER ────────")
    print(f"email:    {args.email}")
    print(f"password: {password}")
    print("───────────────────────────")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
