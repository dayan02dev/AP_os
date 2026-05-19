"""Export every submitted application + every evidence file from a Supabase
project into a single folder, ready to ship.

Usage:
    cd backend
    source .venv/bin/activate
    SUPABASE_URL=<prod-url> \
    SUPABASE_SERVICE_ROLE_KEY=<prod-service-role> \
    OUTPUT_DIR=./prod_export \
    python scripts/export_prod_apps/export.py

Outputs:

    <OUTPUT_DIR>/
        manifest.json                  one-shot summary: counts + run time
        applications_tir.csv           one row per non-draft TIR app
        applications_sip.csv           one row per non-draft SIP app
        ai_screening.csv               AI scoring rows
        reviews.csv                    reviewer scores
        reviewer_assignments.csv       who got assigned what
        profiles.csv                   founder profiles (PII)
        files/
            TIR-26225/
                evidence/<file-name>
                milestone/<file-name>
                resume.<ext>
            SIP-26030/
                pitch_deck.<ext>
                cap_table.<ext>
                traction/<file-name>
                patents/<file-name>
                milestone/<file-name>
                resume.<ext>

JSONB columns are written as JSON strings inside CSV cells. Downstream
tooling (pandas, jq, etc.) parses them back trivially.

Re-running is safe: existing files in <OUTPUT_DIR>/files/ are skipped so
you can resume a partial run without re-downloading from Supabase Storage.

WARNING: this script reads PRODUCTION data including all founder PII
(emails, phones, raw answers, uploaded documents). Handle the output
folder accordingly — do not push to a public bucket, do not commit it
to git (this folder is .gitignored), and prefer a private channel for
sharing.
"""

from __future__ import annotations

import csv
import hashlib
import json
import logging
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    from supabase import create_client
except ImportError:
    print(
        "ERROR: supabase-py not installed.\n"
        "  cd backend && source .venv/bin/activate && pip install -r requirements.txt",
        file=sys.stderr,
    )
    sys.exit(2)


# ─── Config from env ───────────────────────────────────────────────────


SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
OUTPUT_DIR = Path(os.environ.get("OUTPUT_DIR", "./prod_export")).resolve()
PAGE_SIZE = int(os.environ.get("PAGE_SIZE", "1000"))

if not SUPABASE_URL or not SUPABASE_KEY:
    print(
        "ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n"
        "Set them to the PRODUCTION project's values (not staging).",
        file=sys.stderr,
    )
    sys.exit(2)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("export")


# ─── Constants matching the prod schema ────────────────────────────────


# Track → list of (column_name, sub_folder, bucket_name).
# A JSONB column may hold a single file object {path,name,size,...} or an
# array of such objects; the downloader handles both.
TIR_FILE_COLUMNS: list[tuple[str, str, str]] = [
    ("evidence_files",           "evidence",  "tir-evidence-files"),
    ("execution_milestone_files", "milestone", "tir-milestone-files"),
]

SIP_FILE_COLUMNS: list[tuple[str, str, str]] = [
    ("sip_traction_files",        "traction",  "sip-evidence-files"),
    ("sip_pitch_deck",            "pitch_deck","sip-evidence-files"),
    ("sip_cap_table_file",        "cap_table", "sip-evidence-files"),
    ("sip_patents_files",         "patents",   "sip-evidence-files"),
    ("execution_milestone_files", "milestone", "sip-milestone-files"),
]

# Resume tables → (table_name, file_jsonb_column, bucket_name).
# Resume rows store the file object in a `file` column per migration 008.
RESUME_TABLES: list[tuple[str, str]] = [
    ("resume_uploads",     "tir-resumes"),  # TIR resumes (legacy bucket name "resumes" may also exist)
    ("sip_resume_uploads", "sip-resumes"),
]


# ─── Helpers ───────────────────────────────────────────────────────────


def compose_display_id(track: str, app_id: str | None) -> str:
    """Same logic as backend/app/services/stats.py:compose_display_id.

    Duplicated here so the export script has zero imports from the live
    app code (lets you run it against any Supabase project regardless of
    whether the backend code is reachable).
    """
    prefix = (track or "?").upper()
    if not app_id:
        return f"{prefix}-?????"
    try:
        n = int(str(app_id).replace("-", "")[:8], 16) % 100_000
        return f"{prefix}-{n:05d}"
    except (ValueError, TypeError):
        return f"{prefix}-{str(app_id)[:5]}"


def safe_filename(name: str) -> str:
    """Sanitise an arbitrary string for use as a filename."""
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", (name or "").strip())
    return cleaned[:200] or "unnamed"


def short_hash(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:8]


def paginate(client, table: str, *, columns: str = "*") -> list[dict[str, Any]]:
    """Pull all rows from a table in PAGE_SIZE chunks. PostgREST caps at 1000
    rows per response by default; we use .range() to walk the offsets."""
    out: list[dict[str, Any]] = []
    page = 0
    while True:
        start = page * PAGE_SIZE
        end = start + PAGE_SIZE - 1
        try:
            res = client.table(table).select(columns).range(start, end).execute()
            rows = res.data or []
        except Exception as exc:
            log.warning("paginate(%s) page=%d failed: %s", table, page, exc)
            break
        out.extend(rows)
        if len(rows) < PAGE_SIZE:
            break
        page += 1
    return out


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    """Write a list of dicts to CSV. Union of all keys becomes the header.
    JSONB / dict / list values are json-encoded into the cell."""
    if not rows:
        # Still write an empty file with a placeholder header so the
        # consumer knows the table was checked.
        path.write_text("(no rows)\n", encoding="utf-8")
        return
    cols: list[str] = []
    seen: set[str] = set()
    for r in rows:
        for k in r.keys():
            if k not in seen:
                seen.add(k)
                cols.append(k)
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        for r in rows:
            out = {}
            for k in cols:
                v = r.get(k)
                if isinstance(v, (dict, list)):
                    out[k] = json.dumps(v, ensure_ascii=False)
                else:
                    out[k] = v
            w.writerow(out)


def extract_file_refs(jsonb_value: Any) -> list[dict[str, Any]]:
    """Normalise a JSONB column value to a list of file-ref dicts.
    Each entry should have at least a `path` and a `name` key per the
    upload convention; we tolerate variations like `storage_path` /
    `filename` and skip anything that doesn't look like a file ref.
    """
    if jsonb_value is None:
        return []
    if isinstance(jsonb_value, dict):
        items = [jsonb_value]
    elif isinstance(jsonb_value, list):
        items = jsonb_value
    else:
        return []
    refs: list[dict[str, Any]] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        path = it.get("path") or it.get("storage_path") or it.get("key")
        name = it.get("name") or it.get("filename") or (path or "").split("/")[-1]
        if not path:
            continue
        refs.append({"path": path, "name": name, "raw": it})
    return refs


def download_file(client, bucket: str, path: str, dest: Path) -> bool:
    """Pull one file from Supabase Storage. Returns True if the file is
    now present on disk (downloaded or already existed)."""
    if dest.exists() and dest.stat().st_size > 0:
        return True  # idempotent skip
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        blob = client.storage.from_(bucket).download(path)
        # supabase-py returns bytes; older versions return a Response — handle both.
        if hasattr(blob, "content"):
            blob = blob.content
        if not isinstance(blob, (bytes, bytearray)):
            log.warning("unexpected blob type for %s/%s: %r", bucket, path, type(blob))
            return False
        dest.write_bytes(blob)
        return True
    except Exception as exc:
        log.warning("download failed %s/%s → %s", bucket, path, exc)
        return False


# ─── Main export passes ────────────────────────────────────────────────


def export_apps_track(client, track: str, output_root: Path) -> tuple[list[dict], int, int]:
    """Pull every non-draft application for a track, write the CSV, and
    download all referenced files. Returns (rows, files_downloaded, files_failed)."""
    table = f"{track}_applications"
    log.info("=== %s: fetching applications ===", track)
    rows = paginate(client, table)
    log.info("  fetched %d total rows", len(rows))

    submitted = [r for r in rows if r.get("status") and r.get("status") != "draft"]
    log.info("  %d non-draft (will be exported)", len(submitted))

    # Write CSV
    csv_path = output_root / f"applications_{track}.csv"
    write_csv(csv_path, submitted)
    log.info("  wrote %s", csv_path.name)

    # Download files
    file_columns = TIR_FILE_COLUMNS if track == "tir" else SIP_FILE_COLUMNS
    files_root = output_root / "files"
    n_ok = 0
    n_fail = 0
    for i, app in enumerate(submitted, start=1):
        display_id = compose_display_id(track, app.get("id"))
        app_dir = files_root / display_id
        for col, subfolder, bucket in file_columns:
            refs = extract_file_refs(app.get(col))
            for ref in refs:
                # File name = original name + short hash so duplicates don't collide.
                base = safe_filename(ref["name"])
                stem, _, ext = base.rpartition(".")
                if not ext:
                    stem, ext = base, ""
                final_name = f"{stem}-{short_hash(ref['path'])}"
                if ext:
                    final_name = f"{final_name}.{ext}"
                dest = app_dir / subfolder / final_name
                ok = download_file(client, bucket, ref["path"], dest)
                if ok:
                    n_ok += 1
                else:
                    n_fail += 1
        if i % 25 == 0:
            log.info("  %s: processed %d/%d apps (files ok=%d fail=%d)",
                     track, i, len(submitted), n_ok, n_fail)

    log.info("%s: %d files downloaded, %d failed", track, n_ok, n_fail)
    return submitted, n_ok, n_fail


def export_resumes(client, output_root: Path,
                   tir_user_ids: set[str], sip_user_ids: set[str]) -> tuple[int, int]:
    """Pull resume_uploads + sip_resume_uploads, write a single resumes.csv,
    and download each resume file under files/<display_id>/resume.<ext>.

    Resume rows are scoped to the applicant's user_id. We only export
    resumes belonging to users with a submitted application on the same
    track (passed in as sets) — otherwise the export carries unrelated
    user CVs that aren't actionable downstream.
    """
    log.info("=== resumes ===")
    all_rows: list[dict[str, Any]] = []
    n_ok = 0
    n_fail = 0

    files_root = output_root / "files"

    for table_name, bucket in RESUME_TABLES:
        track = "tir" if table_name == "resume_uploads" else "sip"
        try:
            rows = paginate(client, table_name)
        except Exception as exc:
            log.warning("resumes: table %s fetch failed: %s", table_name, exc)
            continue
        log.info("  %s: %d rows", table_name, len(rows))
        scope_ids = tir_user_ids if track == "tir" else sip_user_ids
        kept = [r for r in rows if r.get("user_id") in scope_ids]
        log.info("  %s: %d in-scope (linked to a submitted app)", table_name, len(kept))
        for r in kept:
            all_rows.append({**r, "track": track})
            path = r.get("storage_path") or r.get("path")
            name = r.get("filename") or r.get("name") or "resume"
            if not path:
                continue
            user_id = r.get("user_id") or "unknown-user"
            base = safe_filename(name)
            stem, _, ext = base.rpartition(".")
            if not ext:
                stem, ext = base, ""
            final_name = f"resume-{short_hash(path)}"
            if ext:
                final_name = f"{final_name}.{ext}"
            # File lands under each app the user has on that track. We
            # can't pick "the right one" without re-joining, so we drop
            # the file in a dedicated subfolder keyed by user_id.
            dest = files_root / f"_resumes_{track}" / user_id / final_name
            ok = download_file(client, bucket, path, dest)
            if ok:
                n_ok += 1
            else:
                n_fail += 1

    write_csv(output_root / "resumes.csv", all_rows)
    log.info("resumes: %d files downloaded, %d failed", n_ok, n_fail)
    return n_ok, n_fail


def export_aux_tables(client, output_root: Path,
                      tir_ids: set[str], sip_ids: set[str]) -> dict[str, int]:
    """ai_screening + reviews + reviewer_assignments + profiles."""
    counts: dict[str, int] = {}

    for name in ("ai_screening", "reviews", "reviewer_assignments"):
        try:
            rows = paginate(client, name)
        except Exception as exc:
            log.warning("aux fetch %s failed: %s", name, exc)
            rows = []
        # Scope to the apps we exported so we don't ship orphan rows.
        scoped = []
        for r in rows:
            track = r.get("application_track")
            aid = r.get("application_id")
            if (track == "tir" and aid in tir_ids) or (track == "sip" and aid in sip_ids):
                scoped.append(r)
        write_csv(output_root / f"{name}.csv", scoped)
        counts[name] = len(scoped)
        log.info("%s: %d rows", name, len(scoped))

    # Profiles for the founders whose apps we exported.
    user_ids: set[str] = set()
    for r in paginate(client, "tir_applications", columns="user_id,status"):
        if r.get("user_id") and r.get("status") != "draft":
            user_ids.add(r["user_id"])
    for r in paginate(client, "sip_applications", columns="user_id,status"):
        if r.get("user_id") and r.get("status") != "draft":
            user_ids.add(r["user_id"])
    profiles: list[dict] = []
    if user_ids:
        # Fetch profiles in batches via .in_() — PostgREST handles long lists fine
        # but we batch to keep URL length reasonable.
        ids_list = sorted(user_ids)
        batch = 200
        for i in range(0, len(ids_list), batch):
            chunk = ids_list[i:i + batch]
            try:
                res = client.table("profiles").select("*").in_("id", chunk).execute()
                profiles.extend(res.data or [])
            except Exception as exc:
                log.warning("profiles batch fetch failed: %s", exc)
    write_csv(output_root / "profiles.csv", profiles)
    counts["profiles"] = len(profiles)
    log.info("profiles: %d rows", len(profiles))

    return counts


# ─── Top-level orchestrator ────────────────────────────────────────────


def main() -> int:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    log.info("output dir: %s", OUTPUT_DIR)
    log.info("supabase:   %s", SUPABASE_URL)

    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    started = datetime.now(timezone.utc)
    t0 = time.time()

    tir_rows, tir_ok, tir_fail = export_apps_track(client, "tir", OUTPUT_DIR)
    sip_rows, sip_ok, sip_fail = export_apps_track(client, "sip", OUTPUT_DIR)

    tir_ids = {r["id"] for r in tir_rows if r.get("id")}
    sip_ids = {r["id"] for r in sip_rows if r.get("id")}
    tir_user_ids = {r["user_id"] for r in tir_rows if r.get("user_id")}
    sip_user_ids = {r["user_id"] for r in sip_rows if r.get("user_id")}

    aux_counts = export_aux_tables(client, OUTPUT_DIR, tir_ids, sip_ids)
    resumes_ok, resumes_fail = export_resumes(
        client, OUTPUT_DIR, tir_user_ids, sip_user_ids,
    )

    finished = datetime.now(timezone.utc)
    duration_s = round(time.time() - t0, 1)

    manifest = {
        "started_at_utc":  started.isoformat(),
        "finished_at_utc": finished.isoformat(),
        "duration_seconds": duration_s,
        "supabase_url":    SUPABASE_URL,
        "counts": {
            "applications_tir": len(tir_rows),
            "applications_sip": len(sip_rows),
            **aux_counts,
        },
        "files": {
            "tir_downloaded":     tir_ok,
            "tir_failed":         tir_fail,
            "sip_downloaded":     sip_ok,
            "sip_failed":         sip_fail,
            "resumes_downloaded": resumes_ok,
            "resumes_failed":     resumes_fail,
        },
    }
    (OUTPUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8",
    )
    log.info("manifest: %s", json.dumps(manifest, indent=2))
    log.info("done in %.1fs", duration_s)
    return 0


if __name__ == "__main__":
    sys.exit(main())
