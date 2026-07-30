"""Revoke a user's JURY access without touching their account or other roles.

    # preview only (default) — prints exactly what would be deleted
    python -m scripts.revoke_jury_access udita@artpark.in dev@artpark.in

    # every current jury-role holder
    python -m scripts.revoke_jury_access --all

    # actually delete
    python -m scripts.revoke_jury_access --all --apply

Removes, per user: jury_selections, jury_assignments, jury_recommendations,
jury_profiles, jury_invites (matched on email), and the `jury` row in
user_roles.

DELIBERATELY NOT TOUCHED:
  * auth.users — the login survives.
  * every other role (admin / leadership / reviewer / applicant) — so a staff
    account that was only *also* a juror keeps working everywhere else.
  * application status — apps stay in jury_review; they simply become unassigned.

Run against prod by sourcing the prod env first:
    cd backend && set -a && source .env.prod && set +a \
      && python -m scripts.revoke_jury_access <emails…> --apply
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))
# Only used when the caller hasn't already exported real credentials.
for _c in (".env.staging", ".env"):
    _p = _ROOT / _c
    if _p.exists():
        for _line in _p.read_text().splitlines():
            if "=" in _line and not _line.strip().startswith("#"):
                _k, _, _v = _line.partition("=")
                os.environ.setdefault(_k.strip(), _v.strip())
        break

from app.supabase_client import get_admin_client  # noqa: E402

# Child tables keyed by juror_user_id, deleted in FK-safe order.
_JURY_TABLES = (
    "jury_selections",
    "jury_assignments",
    "jury_recommendations",
    "jury_profiles",
)


def _all_rows(sb, table: str, column: str, value: str) -> list[dict]:
    try:
        rows = sb.table(table).select("*").eq(column, value).execute().data or []
    except Exception as exc:
        print(f"    ! could not read {table}: {exc}")
        return []
    # PostgREST honours .eq; re-filter anyway so a client quirk can never
    # widen a DELETE beyond the intended user.
    return [r for r in rows if r.get(column) == value]


def resolve(sb, emails: list[str] | None, take_all: bool) -> list[dict]:
    """Return [{user_id, email, name, roles}] for the targets."""
    role_rows = sb.table("user_roles").select("user_id,role").execute().data or []
    roles_by_user: dict[str, list[str]] = {}
    for r in role_rows:
        roles_by_user.setdefault(r["user_id"], []).append(r["role"])
    jury_ids = sorted({u for u, rs in roles_by_user.items() if "jury" in rs})

    if take_all:
        target_ids = jury_ids
    else:
        wanted = {e.strip().lower() for e in (emails or []) if e.strip()}
        if not wanted:
            return []
        profs = sb.table("profiles").select("id,email,full_name").execute().data or []
        target_ids = [p["id"] for p in profs if (p.get("email") or "").lower() in wanted]
        missing = wanted - {(p.get("email") or "").lower() for p in profs}
        for m in sorted(missing):
            print(f"  ?  no profile found for {m} — skipped")

    if not target_ids:
        return []
    profs = {p["id"]: p for p in
             (sb.table("profiles").select("id,email,full_name")
              .in_("id", target_ids).execute().data or [])}
    return [{
        "user_id": uid,
        "email": (profs.get(uid) or {}).get("email"),
        "name": (profs.get(uid) or {}).get("full_name"),
        "roles": sorted(roles_by_user.get(uid, [])),
    } for uid in target_ids]


def plan_for(sb, target: dict) -> dict:
    uid = target["user_id"]
    counts = {t: len(_all_rows(sb, t, "juror_user_id", uid)) for t in _JURY_TABLES}
    invites = []
    if target.get("email"):
        invites = _all_rows(sb, "jury_invites", "email", target["email"].lower())
    counts["jury_invites"] = len(invites)
    counts["user_roles(jury)"] = 1 if "jury" in target["roles"] else 0
    return {"counts": counts, "invite_ids": [i["id"] for i in invites]}


def apply_for(sb, target: dict, plan: dict) -> None:
    uid = target["user_id"]
    for table in _JURY_TABLES:
        try:
            sb.table(table).delete().eq("juror_user_id", uid).execute()
        except Exception as exc:
            print(f"    ! {table} delete failed: {exc}")
    for invite_id in plan["invite_ids"]:
        try:
            sb.table("jury_invites").delete().eq("id", invite_id).execute()
        except Exception as exc:
            print(f"    ! jury_invites delete failed: {exc}")
    try:
        sb.table("user_roles").delete().eq("user_id", uid).eq("role", "jury").execute()
    except Exception as exc:
        print(f"    ! user_roles delete failed: {exc}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("emails", nargs="*", help="emails to strip jury access from")
    ap.add_argument("--all", action="store_true", dest="take_all",
                    help="every current holder of the jury role")
    ap.add_argument("--apply", action="store_true",
                    help="perform the deletes (default is a dry run)")
    args = ap.parse_args()

    if not args.emails and not args.take_all:
        ap.error("give at least one email, or --all")

    sb = get_admin_client()
    print(f"Supabase: {os.environ.get('SUPABASE_URL', '(unset)')}")
    print("MODE: APPLY (deleting)" if args.apply else "MODE: DRY RUN (no writes)")
    print("=" * 78)

    targets = resolve(sb, args.emails, args.take_all)
    if not targets:
        print("Nothing to do — no matching users.")
        return 0

    backup: list[dict] = []
    total = {}
    for t in targets:
        plan = plan_for(sb, t)
        keeps = [r for r in t["roles"] if r != "jury"]
        print(f"{t['name'] or '(no name)'}  <{t['email']}>  {t['user_id']}")
        print(f"    all roles now      : {t['roles']}")
        print(f"    roles AFTER revoke : {keeps or ['(none — account keeps working, no roles)']}")
        for k, v in plan["counts"].items():
            print(f"    {k:22}: {v}")
            total[k] = total.get(k, 0) + v
        backup.append({"target": t, "counts": plan["counts"],
                       "invite_ids": plan["invite_ids"]})
        if args.apply:
            apply_for(sb, t, plan)
            print("    → revoked")
        print()

    print("=" * 78)
    print(f"{len(targets)} user(s); rows " + ("deleted" if args.apply else "that WOULD be deleted"))
    for k, v in total.items():
        print(f"    {k:22}: {v}")

    out = _ROOT / ("jury-revoke-applied.json" if args.apply else "jury-revoke-preview.json")
    out.write_text(json.dumps(
        {"at": datetime.now(UTC).isoformat(), "applied": args.apply,
         "users": backup}, indent=2))
    print(f"\nWrote {out}")
    if not args.apply:
        print("Re-run with --apply to perform the deletes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
