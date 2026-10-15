"""Recover a failed generated VIP memo from its stored raw model output, with no model call.

A failed vip_memos row keeps the paid writer output in ``memo_json`` as
{"_raw": ..., "_errors": [...], "_raw_write"?: ..., "_source_files"?: [...]}. This script
runs it (then ``_raw_write``) through the same salvage + validation the writer uses and,
with --apply, stores it as the ready, current version and renders the PDF/DOCX exports.

    # preview only (default): validates, writes nothing
    python -m scripts.revalidate_vip_memo <memo-uuid>

    # actually recover it (becomes the app's current memo, even over a newer version)
    python -m scripts.revalidate_vip_memo <memo-uuid> --apply

Prints one line per memo and never any memo content. Run against prod by sourcing the
prod env first:  cd backend && set -a && source .env.prod && set +a && python -m ...
"""
from __future__ import annotations

import argparse
import os
import sys
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

from app.services.vip_memo_gen import store  # noqa: E402
from app.services.vip_memo_gen.pipeline import _export, salvage_error  # noqa: E402
from app.services.vip_memo_gen.schema import MemoValidationError  # noqa: E402
from app.services.vip_memo_gen.writer import validate  # noqa: E402

_FAILED = ("failed", "failed_budget")


def revalidate(client, memo_id: str, apply: bool) -> str:
    row = store.get_memo(client, memo_id)
    if row is None:
        return f"{memo_id} - not found"
    if row["status"] not in _FAILED:
        return f"{memo_id} - not failed (status {row['status']})"
    blob = row.get("memo_json")
    candidates = [blob.get(k) for k in ("_raw", "_raw_write")] if isinstance(blob, dict) else []
    candidates = [t for t in candidates if isinstance(t, str) and t.strip()]
    if not candidates:
        return f"{memo_id} - no stored raw output"
    errors: list[str] = []
    for text in candidates:
        try:
            memo, notes = validate(text)
            break
        except MemoValidationError as e:
            errors = e.messages
    else:
        return f"{memo_id} - still invalid: {'; '.join(errors)[:300]}"
    if not apply:
        return f"{memo_id} ok notes={len(notes)} dry-run"
    if isinstance(blob.get("_source_files"), list):
        memo["source_files"] = blob["_source_files"]
    store.persist_memo(client, memo_id, memo, error=salvage_error(notes or ["no changes"], "revalidated"))
    _export(client, memo_id, row["application_id"], memo)
    return f"{memo_id} ready notes={len(notes)}"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("memo_ids", nargs="+", help="vip_memos.id values")
    ap.add_argument("--apply", action="store_true", help="write (default is a dry run)")
    args = ap.parse_args(argv)

    from app.supabase_client import get_admin_client
    client = get_admin_client()
    bad = 0
    for memo_id in args.memo_ids:
        try:
            line = revalidate(client, memo_id, args.apply)
        except Exception as e:  # never echo memo content: type name only
            line = f"{memo_id} - error {type(e).__name__}"
        bad += " - " in line
        print(line)
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
