"""Re-render the stored PDF/DOCX of current, ready VIP memos with the current
exporter. No model calls — it only re-renders memo_json and re-uploads.

    python -m scripts.rerender_vip_memo_exports            # dry run: list memos
    python -m scripts.rerender_vip_memo_exports --apply    # re-render + upload

Prints one line per memo (memo id, application id, result) — never memo content.
"""
from __future__ import annotations

import argparse

from app.services.vip_memo_gen.pipeline import _export
from app.supabase_client import get_admin_client


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    client = get_admin_client()
    rows = (
        client.table("vip_memos").select("id,application_id,memo_json")
        .eq("status", "ready").eq("is_current", True).limit(5000).execute().data
    ) or []
    failed = 0
    for r in rows:
        if not args.apply:
            print(r["id"], r["application_id"], "would re-render")
            continue
        try:
            _export(client, r["id"], r["application_id"], r["memo_json"])
            print(r["id"], r["application_id"], "re-rendered")
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(r["id"], r["application_id"], f"FAILED {type(e).__name__}")
    print(f"{len(rows)} memos, {failed} failed, apply={args.apply}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
