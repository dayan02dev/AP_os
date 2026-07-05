#!/usr/bin/env python3
"""Backfill ai_screening.founder_check for TIR apps that have a résumé.

Runs the founder_check LangGraph pipeline (multimodal OCR -> talent-scout) and
UPDATEs only the `founder_check` column of the existing ai_screening row. TIR
only. Idempotent + resumable (per-app disk cache) and parallel (thread pool).
Apps with no ai_screening row are skipped (run rescore_all_applications first).

Usage:
    cd backend && source .venv/bin/activate
    python scripts/backfill_founder_check.py --dry-run
    python scripts/backfill_founder_check.py --yes
    python scripts/backfill_founder_check.py --yes --workers 6 --limit 20
    python scripts/backfill_founder_check.py --yes --force        # re-run existing
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

_CACHE_DIR = _BACKEND_ROOT / ".founder_check_cache"
_TRACK = "tir"


def select_targets(rows: list[dict]) -> list[str]:
    """Non-draft TIR application ids that have a résumé, preserving order."""
    return [r["id"] for r in rows
            if r.get("status") != "draft" and r.get("resume_file_id")]


def _cache_get(app_id: str) -> dict | None:
    p = _CACHE_DIR / f"{app_id}.json"
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
    return None


def _cache_put(app_id: str, verdict: dict) -> None:
    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        (_CACHE_DIR / f"{app_id}.json").write_text(json.dumps(verdict), encoding="utf-8")
    except (OSError, TypeError):
        pass


def _fetch_full_rows(client, limit: int | None) -> list[dict]:
    CHUNK, rows, offset = 500, [], 0
    while True:
        remaining = (limit - len(rows)) if limit else None
        if remaining is not None and remaining <= 0:
            break
        end = offset + (min(CHUNK, remaining) if remaining else CHUNK) - 1
        page = (client.table("tir_applications").select("*")
                .neq("status", "draft").range(offset, end).execute().data) or []
        rows.extend(page)
        if len(page) < CHUNK:
            break
        offset += CHUNK
    return rows


def _process_one(client, app_id: str, *, no_cache: bool, force: bool) -> str:
    """Return 'ok' | 'skip' | 'fail' for one app."""
    from app.services.founder_check import run as fc_run
    try:
        verdict = None if force else (None if no_cache else _cache_get(app_id))
        if verdict is None:
            verdict = fc_run.compute_founder_check(client, app_id)
            if verdict is None:
                return "skip"   # no résumé (shouldn't happen post-filter)
            if not no_cache:
                _cache_put(app_id, verdict)
        fc_run.persist_founder_check(client, app_id, _TRACK, verdict)
        return "ok"
    except Exception as exc:  # noqa: BLE001
        print(f"  ✗ {app_id}: {str(exc)[:160]}")
        return "fail"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--no-cache", action="store_true")
    ap.add_argument("--force", action="store_true")
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
    client = create_client(url, key)

    rows = _fetch_full_rows(client, args.limit)
    ids = select_targets(rows)
    print(f"→ TIR with résumé: {len(ids)} applications")
    if args.dry_run:
        print(f"  [dry-run] first 10: {ids[:10]}")
        return 0

    counts = {"ok": 0, "skip": 0, "fail": 0}
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futs = {pool.submit(_process_one, client, app_id,
                            no_cache=args.no_cache, force=args.force): app_id
                for app_id in ids}
        done = 0
        for fut in as_completed(futs):
            counts[fut.result()] += 1
            done += 1
            if done % 10 == 0 or done == len(ids):
                print(f"  {done}/{len(ids)} "
                      f"(ok={counts['ok']} skip={counts['skip']} fail={counts['fail']})")

    print(f"✓ done — {counts['ok']} ok, {counts['skip']} skipped, {counts['fail']} failed")
    return 0 if counts["fail"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
