#!/usr/bin/env python3
"""Backfill ai_screening.sections (4 AI analyst sections) for ALL non-draft apps.

Runs ONLY the SectionAgent (Gemini Flash via OpenRouter) and UPDATES just the
`sections` column of the existing ai_screening row — it does NOT re-score,
re-summarize, or change status. Idempotent + resumable (per-app disk cache).
Apps with no ai_screening row yet are skipped and logged (run rescore first).

Usage:
    cd backend && source .venv/bin/activate
    python scripts/backfill_sections.py --dry-run
    python scripts/backfill_sections.py --yes
    python scripts/backfill_sections.py --yes --track sip --limit 10
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

_CACHE_DIR = _BACKEND_ROOT / ".sections_cache"


def select_targets(rows: list[dict]) -> list[str]:
    """Non-draft application ids, preserving order."""
    return [r["id"] for r in rows if r.get("status") != "draft"]


def update_sections(client, app_id: str, track: str, sections: dict) -> int:
    """UPDATE ai_screening.sections for one (app, track). Returns rows affected."""
    res = (client.table("ai_screening")
           .update({"sections": sections})
           .eq("application_id", app_id)
           .eq("application_track", track)
           .execute())
    return len(res.data or [])


def _fetch_full_rows(client, table: str, limit: int | None) -> list[dict]:
    CHUNK = 500
    rows: list[dict] = []
    offset = 0
    while True:
        remaining = (limit - len(rows)) if limit else None
        if remaining is not None and remaining <= 0:
            break
        end = offset + (min(CHUNK, remaining) if remaining else CHUNK) - 1
        page = (client.table(table).select("*")
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
    ap.add_argument("--no-cache", action="store_true")
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
    from app.services.ai_pipeline.section_agent import SectionAgent
    from app.services.ai_pipeline.serialize import build_app_text

    client = create_client(url, key)
    agent = SectionAgent(cache_dir=_CACHE_DIR)
    tracks = [args.track] if args.track else ["tir", "sip"]
    total_ok = total_skip = total_fail = 0

    for track in tracks:
        rows = _fetch_full_rows(client, f"{track}_applications", args.limit)
        by_id = {r["id"]: r for r in rows}
        ids = select_targets(rows)
        print(f"→ {track.upper()}: {len(ids)} applications")
        if args.dry_run:
            print(f"  [dry-run] first 10: {ids[:10]}")
            continue
        for i, app_id in enumerate(ids, 1):
            try:
                app_text = build_app_text(by_id[app_id], track)
                sections, _flags = agent.run(
                    app_id, app_text=app_text, no_cache=args.no_cache)
                n = update_sections(client, app_id, track, sections)
                if n == 0:
                    total_skip += 1
                    print(f"  ⚠ {track} {app_id}: no ai_screening row — skipped")
                else:
                    total_ok += 1
                if i % 10 == 0 or i == len(ids):
                    print(f"  {track} {i}/{len(ids)}")
            except Exception as exc:  # noqa: BLE001
                total_fail += 1
                print(f"  ✗ {track} {app_id}: {str(exc)[:160]}")
            time.sleep(0.3)

    print(f"✓ done — {total_ok} updated, {total_skip} skipped (no row), {total_fail} failed")
    return 0 if total_fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
