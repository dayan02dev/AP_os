#!/usr/bin/env python3
"""Backfill AI scores for existing SIP applications by enqueuing them to
the same SQS worker path used on submit. The deployed worker (AI_STUB=false)
does the real scoring; this script only enqueues. Idempotent — the worker
upserts ai_screening ON CONFLICT, so re-enqueuing is harmless.

PROVISIONAL_V0: SIP scoring reuses the TIR graph + prompts as a baseline.
This backfill is the SIP twin of scripts/backfill_tir_scores.py.

Usage:
    cd backend && source .venv/bin/activate
    python scripts/backfill_sip_ai_scores.py --dry-run
    python scripts/backfill_sip_ai_scores.py --yes
    python scripts/backfill_sip_ai_scores.py --yes --limit 10

Reads SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and AI_SCREENING_QUEUE_URL
from the environment (backend/.env.prod for production). Needs AWS creds
on PATH for ap-south-1 (boto3 SQS send). Prints the target queue + DB and
requires --yes (or --dry-run). Throttles ~1s between publishes.
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


def select_app_ids(rows: list[dict], already_scored: set[str] | None = None) -> list[str]:
    """IDs of submitted applications not yet in ai_screening, preserving input order."""
    skip = already_scored or set()
    return [
        r["id"]
        for r in rows
        if r.get("status") == "submitted" and r["id"] not in skip
    ]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=None)
    args = ap.parse_args()

    if load_dotenv:
        load_dotenv(_BACKEND_ROOT / ".env.prod")
        load_dotenv(_BACKEND_ROOT / ".env", override=False)

    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    queue = os.environ["AI_SCREENING_QUEUE_URL"]
    print(f"→ DB    = {url}")
    print(f"→ QUEUE = {queue}")
    if not args.dry_run and not args.yes:
        print("✗ Refusing to enqueue without --yes (or use --dry-run).")
        return 2

    from supabase import create_client
    client = create_client(url, key)

    # Fetch application_ids that already have an ai_screening row for the SIP
    # track so the backfill skips them (avoids redundant re-scoring).
    scored_page = (
        client.table("ai_screening")
        .select("application_id")
        .eq("application_track", "sip")
        .execute()
        .data
    ) or []
    already_scored: set[str] = {r["application_id"] for r in scored_page}
    print(f"→ {len(already_scored)} SIP applications already scored (will skip)")

    # PostgREST caps each request at 1000 rows by default, and supabase-py
    # does not auto-paginate. Walk the table in chunks so the backfill never
    # silently misses the tail on a corpus larger than the cap.
    CHUNK = 1000
    rows: list[dict] = []
    offset = 0
    while True:
        remaining = (args.limit - len(rows)) if args.limit else None
        if remaining is not None and remaining <= 0:
            break
        end = offset + (min(CHUNK, remaining) if remaining else CHUNK) - 1
        page = (
            client.table("sip_applications")
            .select("id, status")
            .eq("status", "submitted")
            .range(offset, end)
            .execute()
            .data
        ) or []
        rows.extend(page)
        if len(page) < CHUNK:
            break
        offset += CHUNK
    app_ids = select_app_ids(rows, already_scored)
    print(f"→ {len(app_ids)} SIP applications to enqueue")

    if args.dry_run:
        print(f"[dry-run] first 10 ids: {app_ids[:10]}")
        return 0

    # Reuse the tested publisher; it reads AI_SCREENING_QUEUE_URL from env.
    from app.services import sqs_publisher
    for i, app_id in enumerate(app_ids, 1):
        sqs_publisher.publish(app_id, "sip")
        if i % 25 == 0:
            print(f"  enqueued {i}/{len(app_ids)}")
        time.sleep(1)  # throttle so the worker's reserved concurrency keeps up
    print(f"✓ enqueued {len(app_ids)} applications")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
