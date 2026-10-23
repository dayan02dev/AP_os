"""Backfill current, ready VIP memos: verification tags and/or a re-researched market section.

    python -m scripts.refresh_vip_memo_market                       # dry run: counts per memo
    python -m scripts.refresh_vip_memo_market --retag --apply       # tags only, no model calls
    python -m scripts.refresh_vip_memo_market --market --apply --ids <app>,<app>
    python -m scripts.refresh_vip_memo_market --market --apply --workers 5

``--market`` re-writes only sections.market (plus its takeaway/source) under
``market.MARKET_MAX_COST_USD`` per memo, retags the whole memo, re-saves it in place (same
memo row and version) and re-renders the PDF/DOCX. The two hand-built pilot memos are
skipped for ``--market`` unless ``--include-pilots``.
Prints one line per memo (ids, counts, cost) — never memo content.
"""
from __future__ import annotations

import argparse
import json
from concurrent.futures import ThreadPoolExecutor

from app.services import vip_memo
from app.services.vip_memo_gen import market, store
from app.services.vip_memo_gen.config import load_config
from app.services.vip_memo_gen.inputs import build_application_block
from app.services.vip_memo_gen.pipeline import _export, _Runs
from app.services.vip_memo_gen.tags import LEGACY, retag
from app.supabase_client import get_admin_client

_COLS = "id,application_id,native_track,memo_json,error,models,cost_usd"


def _gaps(memo: dict) -> tuple[int, int, int]:
    """(legacy placeholders, market rows without a global size, rows without a slice)."""
    rows = ((memo.get("sections") or {}).get("market") or {}).get("rows") or []
    no_size = sum(1 for r in rows if "[" in str(r.get("global_size") or "["))
    no_slice = sum(1 for r in rows if not r.get("slice_high_cr"))
    return json.dumps(memo, ensure_ascii=False).count(LEGACY), no_size, no_slice


def _save(client, row: dict, memo: dict) -> None:
    store.persist_memo(client, row["id"], memo, error=row.get("error"))
    _export(client, row["id"], row["application_id"], memo)


def _retag_one(client, row: dict, apply: bool) -> str:
    memo, n = retag(row["memo_json"])
    if n and apply:
        _save(client, row, memo)
    return f"retagged={n}"


def _market_one(client, row: dict, apply: bool) -> str:
    before = _gaps(row["memo_json"])
    if not apply:
        return f"would refresh market (no_size={before[1]} no_slice={before[2]})"
    track = row["native_track"]
    app_rows = (client.table(f"{track}_applications").select("*")
                .eq("id", row["application_id"]).limit(1).execute().data) or []
    block = build_application_block(app_rows[0], track) if app_rows else ""
    runs = _Runs(client, row["id"])
    spent_before = store.spent_usd(client, row["id"])
    result = market.refresh(row["memo_json"], block, load_config(), market.new_budget(), runs)
    store.record_sources(client, row["id"], result.sources)
    _save(client, row, result.memo)
    models = {**(row.get("models") or {}), "market_writer": result.writer}
    cost = store.finalize_cost(client, row["id"], models) - spent_before
    after = _gaps(result.memo)
    return (f"market no_size {before[1]}->{after[1]} no_slice {before[2]}->{after[2]} "
            f"rows={len(result.memo['sections']['market']['rows'])} cost=${cost:.3f}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--retag", action="store_true", help="tags only (no model calls)")
    ap.add_argument("--market", action="store_true", help="re-research + re-write the market section")
    ap.add_argument("--ids", default="", help="comma-separated application ids")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--workers", type=int, default=1)
    ap.add_argument("--include-pilots", action="store_true")
    args = ap.parse_args()

    client = get_admin_client()
    rows = (client.table("vip_memos").select(_COLS)
            .eq("status", "ready").eq("is_current", True).limit(5000).execute().data) or []
    rows.sort(key=lambda r: r["application_id"])
    if args.ids:
        wanted = {i.strip() for i in args.ids.split(",") if i.strip()}
        rows = [r for r in rows if r["application_id"] in wanted]
    if args.market and not args.include_pilots:
        rows = [r for r in rows if r["application_id"] not in vip_memo.PILOT_APPLICATION_IDS]
    if args.limit:
        rows = rows[: args.limit]

    def one(row: dict) -> bool:
        try:
            if args.market:
                msg = _market_one(client, row, args.apply)
            elif args.retag:
                msg = _retag_one(client, row, args.apply)
            else:
                legacy, no_size, no_slice = _gaps(row["memo_json"])
                msg = f"legacy={legacy} market_no_size={no_size} market_no_slice={no_slice}"
            print(row["id"], row["application_id"], msg, flush=True)
            return True
        except Exception as e:  # noqa: BLE001 — one memo never stops the batch
            print(row["id"], row["application_id"], f"FAILED {type(e).__name__}: {str(e)[:200]}",
                  flush=True)
            return False

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        ok = list(pool.map(one, rows))
    failed = ok.count(False)
    print(f"{len(rows)} memos, {failed} failed, apply={args.apply}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
