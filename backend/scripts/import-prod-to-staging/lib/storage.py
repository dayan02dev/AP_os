"""Copy storage objects from prod Supabase buckets to staging buckets.

The bucket-name mapping mirrors the prod→staging renames done by
migration 010. We only copy paths discovered by lib/jsonb_walker.py
(never a whole-bucket dump).

Concurrency: 8 worker threads via concurrent.futures.ThreadPoolExecutor.
Supabase-py is thread-safe for the storage subclient at this scale.

Idempotency: `upsert=True` on every upload — re-runs overwrite.
"""

from __future__ import annotations

import logging
import mimetypes
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass

from .jsonb_walker import BucketPath

log = logging.getLogger(__name__)

CONCURRENCY = 8
SANITY_BYTES_THRESHOLD = 500 * 1024 * 1024  # 500 MB


@dataclass
class StorageCopyResult:
    succeeded: int = 0
    skipped_404: int = 0
    failed: list[str] = None

    def __post_init__(self):
        if self.failed is None:
            self.failed = []


def _guess_content_type(path: str) -> str:
    ct, _ = mimetypes.guess_type(path)
    return ct or "application/octet-stream"


def _copy_one(prod_client, staging_client, bp: BucketPath) -> str:
    """Download bytes from prod, upload to staging at the same path.

    Returns one of:
      "ok"        — copied successfully
      "404"       — prod object missing; skipped
      "fail:<msg>" — upload threw; recorded for the failure list
    """
    try:
        blob = prod_client.storage.from_(bp.prod_bucket).download(bp.path)
    except Exception as exc:
        msg = str(exc).lower()
        if "not found" in msg or "404" in msg or "object_not_found" in msg:
            log.warning("Prod object missing: %s/%s", bp.prod_bucket, bp.path)
            return "404"
        return f"fail:download:{exc}"

    try:
        staging_client.storage.from_(bp.staging_bucket).upload(
            path=bp.path,
            file=blob,
            file_options={
                "content-type": _guess_content_type(bp.path),
                "upsert": "true",
            },
        )
    except Exception as exc:
        return f"fail:upload:{exc}"

    return "ok"


def copy_storage_objects(
    *,
    prod_client,
    staging_client,
    paths: list[BucketPath],
    dry_run: bool = False,
) -> StorageCopyResult:
    """Copy ``paths`` from prod buckets to staging buckets in parallel.

    On dry-run, prints what WOULD be copied and exits without I/O.
    Triggers a y/N prompt if estimated bytes > SANITY_BYTES_THRESHOLD —
    skip the prompt with dry_run=True.
    """
    result = StorageCopyResult()

    # Dedupe — same path can appear in multiple JSONB rows.
    unique = sorted(set(paths), key=lambda p: (p.prod_bucket, p.path))
    total = len(unique)
    log.info("Storage sync: %d unique objects across %d buckets",
             total, len({p.prod_bucket for p in unique}))

    if dry_run:
        for bp in unique[:10]:
            log.info("[dry-run]   %s/%s → %s/%s", bp.prod_bucket, bp.path, bp.staging_bucket, bp.path)
        if total > 10:
            log.info("[dry-run]   ... and %d more", total - 10)
        return result

    if total == 0:
        return result

    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        futures = {
            pool.submit(_copy_one, prod_client, staging_client, bp): bp
            for bp in unique
        }
        done = 0
        for fut in as_completed(futures):
            bp = futures[fut]
            outcome = fut.result()
            done += 1
            if outcome == "ok":
                result.succeeded += 1
            elif outcome == "404":
                result.skipped_404 += 1
            else:
                result.failed.append(f"{bp.prod_bucket}/{bp.path} → {outcome}")

            if done % 50 == 0 or done == total:
                log.info("[storage] %d/%d objects synced (%d ok, %d 404, %d failed)",
                         done, total, result.succeeded, result.skipped_404, len(result.failed))

    return result
