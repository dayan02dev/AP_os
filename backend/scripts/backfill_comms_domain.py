"""Re-classify wired/wireless communication apps into the `comms` domain.

    python -m scripts.backfill_comms_domain --dry-run   # preview CSV, no writes
    python -m scripts.backfill_comms_domain --apply      # backup + write

Dry-run writes comms-domain-preview.csv for human review. --apply backs up the
prior (app, old_category) to comms-domain-backup.json, then sets
ai_screening.industry_category_id='comms' for confirmed apps only (idempotent).
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT))
for _c in (".env.staging", ".env"):
    _p = _ROOT / _c
    if _p.exists():
        for _line in _p.read_text().splitlines():
            if "=" in _line and not _line.strip().startswith("#"):
                _k, _, _v = _line.partition("=")
                os.environ.setdefault(_k.strip(), _v.strip())
        break

from app.services import comms_classifier as cc  # noqa: E402
from app.services.ai_pipeline.serialize import build_app_text  # noqa: E402
from app.supabase_client import get_admin_client  # noqa: E402

_TRACKS = ("tir", "sip")


def assert_category_exists(sb) -> None:
    rows = (
        sb.table("industry_categories").select("id").eq("id", cc.CATEGORY_ID).execute().data
    ) or []
    if not any(r.get("id") == cc.CATEGORY_ID for r in rows):
        print(f"✗ category '{cc.CATEGORY_ID}' missing — apply migration 035 first")
        raise SystemExit(1)


def collect_rows(sb) -> list[dict]:
    """Build identify() inputs from screened apps on both tracks."""
    out: list[dict] = []
    for track in _TRACKS:
        screening = {
            r["application_id"]: r
            for r in (
                sb.table("ai_screening")
                .select("application_id,industry_category_id,project_name,summary")
                .eq("application_track", track)
                .execute()
                .data
                or []
            )
            if r.get("application_id")
        }
        if not screening:
            continue
        apps = (
            sb.table(f"{track}_applications")
            .select("*")
            .in_("id", list(screening.keys()))
            .execute()
            .data
            or []
        )
        for a in apps:
            sc = screening.get(a["id"], {})
            text = build_app_text(a, track)
            if sc.get("summary"):
                text += "\n" + sc["summary"]
            if sc.get("project_name"):
                text += "\n" + sc["project_name"]
            out.append({
                "app_id": a["id"],
                "track": track,
                "project_name": sc.get("project_name"),
                "current_category": sc.get("industry_category_id"),
                "text": text,
            })
    return out


def apply_matches(sb, matches: list[dict]) -> tuple[list[dict], int]:
    """Set industry_category_id='comms' for confirmed apps not already comms.
    Returns (backup_entries, changed_count)."""
    backup: list[dict] = []
    changed = 0
    for m in matches:
        if m.get("current_category") == cc.CATEGORY_ID:
            continue
        backup.append({
            "app_id": m["app_id"], "track": m["track"],
            "old_category_id": m.get("current_category"),
        })
        sb.table("ai_screening").update(
            {"industry_category_id": cc.CATEGORY_ID}
        ).eq("application_id", m["app_id"]).eq("application_track", m["track"]).execute()
        changed += 1
    return backup, changed


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write changes (default: dry-run)")
    ap.add_argument("--dry-run", action="store_true",
                    help="explicit no-op; dry-run is the default when --apply is absent")
    args = ap.parse_args()
    sb = get_admin_client()

    rows = collect_rows(sb)
    print(f"Screened apps scanned: {len(rows)}")
    matches = cc.identify(rows)
    print(f"Confirmed comms apps: {len(matches)}")

    with open("comms-domain-preview.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow([
            "app_id", "track", "project_name", "current_domain",
            "matched_terms", "llm_reason",
        ])
        for m in matches:
            w.writerow([
                m["app_id"], m["track"], m.get("project_name"),
                m.get("current_category"), "|".join(m["matched_terms"]), m.get("reason"),
            ])
    print("Wrote comms-domain-preview.csv")

    if not args.apply:
        print("DRY-RUN — no writes. Review the CSV, then re-run with --apply.")
        return
    assert_category_exists(sb)  # FK guard — the row must exist before --apply
    backup, changed = apply_matches(sb, matches)
    Path("comms-domain-backup.json").write_text(json.dumps(backup, indent=2))
    print(f"APPLIED — {changed} apps set to '{cc.CATEGORY_ID}'. Backup: comms-domain-backup.json")


if __name__ == "__main__":
    main()
