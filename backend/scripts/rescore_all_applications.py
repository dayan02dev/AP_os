#!/usr/bin/env python3
"""Re-score + re-summarize ALL non-draft applications with the ai_pipeline.

Scores inline (calls Gemini via OpenRouter directly — NOT the SQS worker) and
upserts ai_screening. Idempotent (upsert) and resumable (per-agent disk cache).
Does NOT advance application status.

Usage:
    cd backend && source .venv/bin/activate
    python scripts/rescore_all_applications.py --dry-run
    python scripts/rescore_all_applications.py --yes
    python scripts/rescore_all_applications.py --yes --track sip --limit 10
    python scripts/rescore_all_applications.py --yes --only-missing

Env (backend/.env.prod for prod): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
OPENROUTER_API_KEY.
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

_CACHE_DIR = _BACKEND_ROOT / ".rescore_cache"


def select_targets(rows: list[dict], already_scored: set[str] | None = None,
                   only_missing: bool = False) -> list[str]:
    """Non-draft application ids, preserving order; skip already-scored when only_missing."""
    skip = already_scored or set()
    out = []
    for r in rows:
        if r.get("status") == "draft":
            continue
        if only_missing and r["id"] in skip:
            continue
        out.append(r["id"])
    return out


def _fetch_all(client, table: str, limit: int | None) -> list[dict]:
    CHUNK = 1000
    rows: list[dict] = []
    offset = 0
    while True:
        remaining = (limit - len(rows)) if limit else None
        if remaining is not None and remaining <= 0:
            break
        end = offset + (min(CHUNK, remaining) if remaining else CHUNK) - 1
        page = (client.table(table).select("id, status")
                .neq("status", "draft").range(offset, end).execute().data) or []
        rows.extend(page)
        if len(page) < CHUNK:
            break
        offset += CHUNK
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--track", choices=["tir", "sip"], default=None)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--only-missing", action="store_true")
    args = ap.parse_args()

    if load_dotenv:
        load_dotenv(_BACKEND_ROOT / ".env.prod")
        load_dotenv(_BACKEND_ROOT / ".env", override=False)

    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    assert os.environ.get("OPENROUTER_API_KEY"), "OPENROUTER_API_KEY required"
    print(f"→ DB = {url}")
    if not args.dry_run and not args.yes:
        print("✗ Refusing to run without --yes (or use --dry-run).")
        return 2

    from supabase import create_client
    from app.services.ai_pipeline import pipeline

    client = create_client(url, key)
    tracks = [args.track] if args.track else ["tir", "sip"]
    total_ok = total_fail = 0

    for track in tracks:
        scored = set()
        if args.only_missing:
            scored = {r["application_id"] for r in (
                client.table("ai_screening").select("application_id")
                .eq("application_track", track).execute().data or [])}
        rows = _fetch_all(client, f"{track}_applications", args.limit)
        ids = select_targets(rows, already_scored=scored, only_missing=args.only_missing)
        print(f"→ {track.upper()}: {len(ids)} applications to (re)score")
        if args.dry_run:
            print(f"  [dry-run] first 10: {ids[:10]}")
            continue
        for i, app_id in enumerate(ids, 1):
            try:
                result = pipeline.run_for_application(
                    app_id, track, client=client, cache_dir=_CACHE_DIR, no_cache=False)
                pipeline.persist(client, app_id, track, result, advance_status=False)
                total_ok += 1
                if i % 10 == 0 or i == len(ids):
                    print(f"  {track} {i}/{len(ids)} (last overall={result.score_overall})")
            except Exception as exc:  # noqa: BLE001 — log and continue
                total_fail += 1
                print(f"  ✗ {track} {app_id}: {str(exc)[:160]}")
            time.sleep(0.3)  # gentle throttle for OpenRouter

    print(f"✓ done — {total_ok} scored, {total_fail} failed")
    return 0 if total_fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
