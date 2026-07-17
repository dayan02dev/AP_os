"""Seed the staging DB with test data for the Founder Portal (Wave 1).

Creates/updates two TIR applicants:
  A) status 'offered', no MOU  → test the sign gate yourself
  B) status 'onboarded' + seeded team/BOM/equipment/procurement (mockup 'Priya')

STAGING ONLY. Refuses to run unless the Supabase URL is the staging project.
Run:  cd backend && set -a && source .env.staging && set +a && python scripts/seed_post_onboarding.py
"""
from __future__ import annotations

import os
import sys

STAGING_REF = "exqmxvdtcsvpgtftwjml"


def _guard():
    url = os.environ.get("SUPABASE_URL", "")
    if STAGING_REF not in url:
        sys.exit(f"refusing to run: SUPABASE_URL is not staging ({STAGING_REF}). Got: {url!r}")


def main() -> None:
    _guard()
    from app.supabase_client import get_admin_client
    sb = get_admin_client()

    # NOTE: applicants must already exist as auth users on staging. Set
    # SEED_USER_A / SEED_USER_B env vars to two existing staging auth user ids
    # (create them via the staging signup flow first, or reuse test accounts).
    ua = os.environ["SEED_USER_A"]
    ub = os.environ["SEED_USER_B"]

    def _app(user_id, status, project):
        existing = sb.table("tir_applications").select("id").eq("user_id", user_id) \
            .eq("status", status).limit(1).execute().data or []
        if existing:
            return existing[0]["id"]
        row = sb.table("tir_applications").insert({
            "user_id": user_id, "status": status, "grant_amount": 2500000,
        }).execute().data[0]
        # best-effort project name for display
        sb.table("ai_screening").upsert(
            {"application_id": row["id"], "application_track": "tir", "project_name": project},
            on_conflict="application_id,application_track").execute()
        return row["id"]

    app_a = _app(ua, "offered", "Test venture A")
    app_b = _app(ub, "onboarded", "Neonatal sepsis monitor")

    # applicant B sample data (idempotent-ish: only seed when empty)
    if not (sb.table("founder_team_members").select("id").eq("application_id", app_b).limit(1).execute().data or []):
        sb.table("founder_team_members").insert([
            {"application_id": app_b, "name": "Priya Ramachandran", "title": "Founder · CEO", "employment_type": "full-time", "monthly_cost": 180000, "sort_order": 1},
            {"application_id": app_b, "name": "Arjun Nair", "title": "Founder · CTO", "employment_type": "full-time", "monthly_cost": 170000, "sort_order": 2},
            {"application_id": app_b, "name": "Meera Das", "title": "ML Engineer", "employment_type": "full-time", "monthly_cost": 120000, "sort_order": 3},
        ]).execute()
        sb.table("founder_bom_items").insert([
            {"application_id": app_b, "item": "Acoustic sensor module (MEMS mic array)", "qty": 6, "unit_cost": 8500, "sort_order": 1},
            {"application_id": app_b, "item": "HRV / ECG analog front-end board", "qty": 6, "unit_cost": 12000, "sort_order": 2},
        ]).execute()
        sb.table("founder_equipment_items").insert([
            {"application_id": app_b, "item": "NICU-grade enclosure + isolated power", "cost": 220000, "sort_order": 1},
            {"application_id": app_b, "item": "Bench oscilloscope + logic analyzer", "cost": 145000, "sort_order": 2},
        ]).execute()
        sb.table("founder_procurement_items").insert([
            {"application_id": app_b, "item": "Acoustic sensor module (MEMS mic array)", "category": "BOM", "qty": 6, "estimate": 8500, "vendor": "Knowles India", "quote": 8200, "lead_weeks": 4, "status": "quoted"},
            {"application_id": app_b, "item": "NICU-grade enclosure + isolated power", "category": "Equipment", "qty": 1, "estimate": 220000, "vendor": "Precision Enclosures", "quote": 210000, "lead_weeks": 10, "status": "po"},
        ]).execute()

    print(f"seeded: offered app={app_a}  onboarded app={app_b}")


if __name__ == "__main__":
    main()
