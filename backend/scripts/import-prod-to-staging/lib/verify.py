"""Post-import verification — row counts + FK integrity + storage sanity.

Three checks (spec §8). Each one prints its row in the summary table
and contributes a pass/fail bit to the overall exit code.
"""

from __future__ import annotations

import logging
import random
from dataclasses import dataclass, field

log = logging.getLogger(__name__)


@dataclass
class VerifyReport:
    row_counts_ok: bool = True
    fk_integrity_ok: bool = True
    storage_sanity_ok: bool = True
    rows: list[tuple[str, int, int, str]] = field(default_factory=list)
    # rows = [(label, prod_count, staging_count, mark)]
    fk_orphan_count: int = 0
    storage_checked: int = 0
    storage_404: int = 0

    @property
    def all_ok(self) -> bool:
        return self.row_counts_ok and self.fk_integrity_ok and self.storage_sanity_ok


def _count(client, table: str) -> int:
    res = client.table(table).select("id", count="exact").execute()
    return res.count if hasattr(res, "count") and res.count is not None else len(res.data or [])


def run_verify(
    *,
    prod_client,
    staging_client,
    preserve_set_size: int,
) -> VerifyReport:
    """Run all three checks and return a report."""
    report = VerifyReport()

    # ─── Row counts ─────────────────────────────────────────────────
    prod_apps = _count(prod_client, "applications")
    staging_apps = _count(staging_client, "tir_applications")
    report.rows.append(
        ("applications → tir_applications", prod_apps, staging_apps,
         "✓" if prod_apps == staging_apps else "✗")
    )
    if prod_apps != staging_apps:
        report.row_counts_ok = False

    prod_resumes = _count(prod_client, "resume_uploads")
    staging_resumes = _count(staging_client, "tir_resume_uploads")
    report.rows.append(
        ("resume_uploads → tir_resume_uploads", prod_resumes, staging_resumes,
         "✓" if prod_resumes == staging_resumes else "✗")
    )
    if prod_resumes != staging_resumes:
        report.row_counts_ok = False

    # ─── FK integrity ──────────────────────────────────────────────
    # Spot-check: every imported tir_applications.user_id must resolve
    # to a staging.auth.users row. We do this as a Python-side join via
    # two queries because PostgREST doesn't expose anti-joins cleanly.
    app_user_ids = {
        row["user_id"]
        for row in (staging_client.table("tir_applications")
                    .select("user_id").execute().data or [])
        if row.get("user_id")
    }
    auth_ids = {
        row["id"]
        for row in (staging_client.table("auth.users")
                    .select("id").execute().data or [])
        if row.get("id")
    }
    orphans = app_user_ids - auth_ids
    report.fk_orphan_count = len(orphans)
    if orphans:
        report.fk_integrity_ok = False
        log.error("FK orphans: %d tir_applications.user_id values have no auth.users row", len(orphans))

    # ─── Storage sanity (5 random apps with files) ─────────────────
    candidates = [
        row for row in
        (staging_client.table("tir_applications")
         .select("id, evidence_files").execute().data or [])
        if row.get("evidence_files")
    ]
    sample = random.sample(candidates, min(5, len(candidates)))
    for app in sample:
        for entry in (app.get("evidence_files") or [])[:1]:
            path = (entry or {}).get("storage_path")
            if not path:
                continue
            try:
                staging_client.storage.from_("tir-evidence-files").download(path)
                report.storage_checked += 1
            except Exception as exc:
                msg = str(exc).lower()
                if "not found" in msg or "404" in msg:
                    report.storage_404 += 1
                    log.warning("Storage sanity 404 on %s", path)
                else:
                    log.warning("Storage sanity unexpected error on %s: %s", path, exc)

    if sample and report.storage_404 == len(sample):
        # Every check 404'd — likely the storage sync step was skipped.
        report.storage_sanity_ok = False

    return report


def print_summary(report: VerifyReport, *, preserved: int, wiped_seed_apps: int) -> None:
    """Pretty-print the verification summary to stdout."""
    print("\n" + "─" * 68)
    print(" Verification summary")
    print("─" * 68)
    print(f"  {'table':<40} {'prod':>6}  {'staging':>8}  status")
    for label, p, s, mark in report.rows:
        print(f"  {label:<40} {p:>6}  {s:>8}    {mark}")
    print(f"  FK orphans (tir_applications.user_id): {report.fk_orphan_count}")
    print(f"  Storage sanity:  {report.storage_checked} ok, {report.storage_404} 404")
    print(f"  Preserved staging users: {preserved}")
    print(f"  Wiped synthetic seed apps: {wiped_seed_apps}")
    print("─" * 68)
    print(f"  Result: {'ALL GREEN ✓' if report.all_ok else 'FAILED ✗ — see above'}")
    print("─" * 68 + "\n")
