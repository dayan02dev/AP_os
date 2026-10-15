"""Import existing VIP memo JSON files into the vip_memos tables.

    # preview only (default): validates + resolves the track, writes nothing
    python -m scripts.import_vip_memo_json path/<application-uuid>.json [...]

    # actually import (creates a ready, current version + PDF/DOCX exports)
    python -m scripts.import_vip_memo_json path/<application-uuid>.json --apply

The application id is the file's stem. Prints one `id version status` line per
file and never any memo content. Run against prod by sourcing the prod env first:
    cd backend && set -a && source .env.prod && set +a \
      && python -m scripts.import_vip_memo_json <files> --apply
"""
from __future__ import annotations

import argparse
import json
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
from app.services.vip_memo_gen.pipeline import _export  # noqa: E402  (reused, not duplicated)
from app.services.vip_memo_gen.schema import memo_to_dict, parse_memo  # noqa: E402


def resolve_native_track(client, application_id: str) -> str | None:
    """'sip' for a native VIP app, 'tir' for a TIR app moved to VIP, else None."""
    sip = client.table("sip_applications").select("id").eq("id", application_id).limit(1).execute()
    if sip.data:
        return "sip"
    tir = (
        client.table("tir_applications").select("id")
        .eq("id", application_id).eq("moved_to_track", "sip").limit(1).execute()
    )
    return "tir" if tir.data else None


def import_file(client, path: Path, apply: bool) -> str:
    """Return the `id version status` line for one file; raises on a bad file."""
    application_id = path.stem
    memo = memo_to_dict(parse_memo(json.loads(path.read_text())))
    native = resolve_native_track(client, application_id)
    if native is None:
        raise ValueError("application not found as a VIP app or a TIR app moved to VIP")
    if not apply:
        return f"{application_id} - dry-run"
    row = store.create_memo_version(client, application_id, native, triggered_by=None)
    store.persist_memo(client, row["id"], memo)
    _export(client, row["id"], application_id, memo)
    store.finalize_cost(client, row["id"], {"source": "import"})
    return f"{application_id} {row['version']} ready"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("files", nargs="+", type=Path, help="<application-uuid>.json files")
    ap.add_argument("--apply", action="store_true", help="write (default is a dry run)")
    args = ap.parse_args(argv)

    from app.supabase_client import get_admin_client
    client = get_admin_client()
    failed = 0
    for path in args.files:
        try:
            print(import_file(client, path, args.apply))
        except Exception as e:  # never echo memo content: type name only
            failed += 1
            print(f"{path.stem} - error {type(e).__name__}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
