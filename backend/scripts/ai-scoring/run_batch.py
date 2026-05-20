"""Run AI scoring against staging Supabase from the dev laptop.

Loads backend/.env.staging, instantiates the staging Supabase client,
and calls score_application for each requested TIR application.

Usage:
  cd backend
  .venv/bin/python scripts/ai-scoring/run_batch.py --limit 1     # smoke test
  .venv/bin/python scripts/ai-scoring/run_batch.py --limit 10
  .venv/bin/python scripts/ai-scoring/run_batch.py --all
  .venv/bin/python scripts/ai-scoring/run_batch.py --app-id <uuid>

The script writes a per-app result to stdout and persists ai_screening
rows as it goes (each app independently — a single failure does not
abort the batch).
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

# Load staging env BEFORE importing scoring modules (they read env at import)
ENV_PATH = ROOT / ".env.staging"
if not ENV_PATH.exists():
    print(f"FATAL: {ENV_PATH} not found", file=sys.stderr)
    sys.exit(2)
load_dotenv(ENV_PATH, override=True)

# Sanity-check required vars
_REQUIRED = ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OPENROUTER_API_KEY")
_missing = [k for k in _REQUIRED if not os.environ.get(k)]
if _missing:
    print(f"FATAL: missing env vars: {_missing}", file=sys.stderr)
    sys.exit(2)

from supabase import create_client  # noqa: E402

from app.services.ai_scoring.runner import score_application  # noqa: E402


def _build_supabase():
    return create_client(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SERVICE_ROLE_KEY"],
    )


def _fetch_target_ids(sb, limit: int | None, app_id: str | None) -> list[str]:
    if app_id:
        return [app_id]
    q = sb.table("tir_applications").select("id, created_at").order(
        "created_at", desc=False
    )
    if limit:
        q = q.limit(limit)
    res = q.execute()
    return [r["id"] for r in (res.data or [])]


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--limit", type=int, default=None,
                   help="Cap how many apps to score (default: no limit when --all is set)")
    p.add_argument("--all", action="store_true",
                   help="Score every application in tir_applications")
    p.add_argument("--app-id", type=str, default=None,
                   help="Single application UUID to score")
    p.add_argument("--skip-existing", action="store_true",
                   help="Skip applications that already have an ai_screening row")
    args = p.parse_args()

    if not (args.limit or args.all or args.app_id):
        print("FATAL: pass one of --limit N | --all | --app-id <uuid>", file=sys.stderr)
        return 2

    sb = _build_supabase()

    target_ids = _fetch_target_ids(sb, args.limit, args.app_id)

    if args.skip_existing and not args.app_id:
        existing = sb.table("ai_screening").select("application_id").execute()
        already = {r["application_id"] for r in (existing.data or [])}
        before = len(target_ids)
        target_ids = [i for i in target_ids if i not in already]
        print(f"--skip-existing: dropping {before - len(target_ids)} of {before} "
              f"already-scored apps; {len(target_ids)} remain.")

    if not target_ids:
        print("No target applications. Exiting.")
        return 0

    print(f"Scoring {len(target_ids)} application(s) on staging Supabase…")
    print(f"Model: {os.environ.get('AI_SCORING_MODEL', 'google/gemini-2.5-flash')}")
    print()

    t0 = time.time()
    ok = 0
    failed = 0
    for i, app_id in enumerate(target_ids, 1):
        ta = time.time()
        try:
            state = score_application(
                application_id=app_id, track="tir", supabase=sb,
            )
            pct = state.get("composite_percentage")
            label = state.get("strength_label")
            caps = len(state.get("caps_applied", []))
            retries = state.get("qg_retries", 0)
            needs_review = bool(state.get("qg_needs_human_review", False))
            tb = time.time() - ta
            print(f"  [{i:3d}/{len(target_ids)}] {app_id[:8]}… "
                  f"composite={pct:.1f}% {label:<15} "
                  f"caps={caps} retries={retries}"
                  f"{' ⚠ NEEDS HUMAN REVIEW' if needs_review else ''} "
                  f"({tb:.1f}s)")
            ok += 1
        except Exception as exc:
            tb = time.time() - ta
            print(f"  [{i:3d}/{len(target_ids)}] {app_id[:8]}… FAILED: "
                  f"{type(exc).__name__}: {str(exc)[:120]} ({tb:.1f}s)")
            failed += 1

    elapsed = time.time() - t0
    print()
    print(f"Done in {elapsed:.1f}s. ok={ok} failed={failed}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
