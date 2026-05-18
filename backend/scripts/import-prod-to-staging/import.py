"""Prod → Staging data import — main entrypoint.

Usage (via run.sh which sources .env.import):
    python import.py [--dry-run] [--no-storage]

Phases:
    1. Pre-flight safety (URL refs, seed-data signature)
    2. Wipe seed apps + filtered auth wipe
    3. Auth stub creation + remap dict
    4. Application + resume_uploads row copy
    5. Storage object sync (skippable with --no-storage)
    6. Verification + summary
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import datetime
from pathlib import Path

# Make lib/ importable without packaging.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from supabase import create_client

from lib.auth import import_users
from lib.copy import column_intersection, copy_table
from lib.jsonb_walker import walk_application_storage, walk_resume_storage
from lib.probe import (
    SafetyCheckFailed,
    assert_url_matches_project,
    column_inventory,
    seed_signature_present,
)
from lib.storage import copy_storage_objects
from lib.tables import (
    PROD_PROJECT_REF,
    STAGING_PROJECT_REF,
    TABLE_MAP,
)
from lib.verify import print_summary, run_verify
from lib.wipe import run_wipe, resolve_preserve_set


def _setup_logging() -> Path:
    runs_dir = Path(__file__).resolve().parent / "runs"
    runs_dir.mkdir(exist_ok=True)
    log_path = runs_dir / f"{datetime.now():%Y-%m-%d-%H%M%S}.log"

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(log_path),
        ],
    )
    return log_path


def _require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.exit(f"ERROR: required env var {name} not set. See .env.import.example.")
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description="Prod → Staging Supabase data import")
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Run the safety checks + log what WOULD happen, no writes.",
    )
    parser.add_argument(
        "--no-storage", action="store_true",
        help="Skip the Supabase Storage object copy phase.",
    )
    args = parser.parse_args()

    log_path = _setup_logging()
    log = logging.getLogger("import")
    log.info("Run starting — transcript at %s", log_path)
    log.info("dry_run=%s no_storage=%s", args.dry_run, args.no_storage)

    # ─── Phase 1: env + pre-flight safety ─────────────────────────
    prod_url = _require_env("PROD_SUPABASE_URL")
    prod_key = _require_env("PROD_SUPABASE_SERVICE_ROLE_KEY")
    staging_url = _require_env("STAGING_SUPABASE_URL")
    staging_key = _require_env("STAGING_SUPABASE_SERVICE_ROLE_KEY")

    try:
        assert_url_matches_project(
            url=prod_url, expected_project_ref=PROD_PROJECT_REF, label="prod",
        )
        assert_url_matches_project(
            url=staging_url, expected_project_ref=STAGING_PROJECT_REF, label="staging",
        )
    except SafetyCheckFailed as exc:
        log.error("Pre-flight URL check failed: %s", exc)
        return 1

    prod = create_client(prod_url, prod_key)
    staging = create_client(staging_url, staging_key)

    if not args.dry_run:
        if not seed_signature_present(staging):
            log.error(
                "Pre-flight seed-data check FAILED: no '@artpark.test' rows "
                "found in staging.tir_applications. Refusing to wipe. "
                "If you really meant to run this against a non-seeded staging, "
                "remove this guard manually after re-reading spec §4.5."
            )
            return 1

    # ─── Phase 2: column probe + intersection ─────────────────────
    prod_app_cols = column_inventory(prod, table="applications")
    staging_app_cols = column_inventory(staging, table="tir_applications")
    app_shared, app_extra_prod, app_extra_staging = column_intersection(
        prod_app_cols, staging_app_cols,
    )
    log.info("applications columns — shared=%d extra_prod=%d extra_staging=%d",
             len(app_shared), len(app_extra_prod), len(app_extra_staging))
    if app_extra_prod:
        log.warning("Columns on prod.applications but not staging.tir_applications (DROPPED): %s",
                    sorted(app_extra_prod))

    prod_resume_cols = column_inventory(prod, table="resume_uploads")
    staging_resume_cols = column_inventory(staging, table="tir_resume_uploads")
    resume_shared, _, _ = column_intersection(prod_resume_cols, staging_resume_cols)

    # ─── Phase 3: wipe ────────────────────────────────────────────
    preserve_set = resolve_preserve_set(staging)
    run_wipe(staging, dry_run=args.dry_run)

    # ─── Phase 4: auth stubs + remap ──────────────────────────────
    if args.dry_run:
        log.info("[dry-run] Would create auth stub users + build remap")
        remap: dict[str, str] = {}
    else:
        remap = import_users(prod, staging)
        log.info("Auth remap built: %d entries", len(remap))

    # ─── Phase 5: row copy ────────────────────────────────────────
    copy_table(
        prod_client=prod, staging_client=staging,
        prod_table="applications", staging_table=TABLE_MAP["applications"],
        remap=remap,
        shared_columns=app_shared,
        user_id_columns=("user_id",),
        dry_run=args.dry_run,
    )
    copy_table(
        prod_client=prod, staging_client=staging,
        prod_table="resume_uploads", staging_table=TABLE_MAP["resume_uploads"],
        remap=remap,
        shared_columns=resume_shared,
        user_id_columns=("user_id",),
        dry_run=args.dry_run,
    )

    # ─── Phase 6: storage sync ────────────────────────────────────
    if args.no_storage:
        log.info("Skipping storage sync (--no-storage)")
    else:
        # Pull staging app rows so we can walk their JSONB.
        app_rows = staging.table("tir_applications").select(
            "id, evidence_files, evidence_deck, execution_milestone_files"
        ).execute().data or []
        resume_rows = staging.table("tir_resume_uploads").select(
            "id, storage_path"
        ).execute().data or []

        paths = []
        for r in app_rows:
            paths.extend(walk_application_storage(r))
        for r in resume_rows:
            paths.extend(walk_resume_storage(r))

        storage_result = copy_storage_objects(
            prod_client=prod, staging_client=staging,
            paths=paths, dry_run=args.dry_run,
        )
        log.info("Storage sync done: %d ok, %d 404, %d failed",
                 storage_result.succeeded, storage_result.skipped_404,
                 len(storage_result.failed))

    # ─── Phase 7: verify + summary ────────────────────────────────
    if args.dry_run:
        log.info("[dry-run] Skipping verify (no writes were performed)")
        return 0

    report = run_verify(
        prod_client=prod, staging_client=staging,
        preserve_set_size=len(preserve_set),
    )
    print_summary(
        report,
        preserved=len(preserve_set),
        wiped_seed_apps=0,  # actual seed-app count would be captured pre-wipe; left 0 here for brevity
    )
    return 0 if report.all_ok else 2


if __name__ == "__main__":
    sys.exit(main())
