"""Per-table row copy from prod to staging with UUID remap application.

Two pure helpers (unit-tested) + one integration orchestrator.
"""

from __future__ import annotations

import logging
from typing import Iterable

from .tables import batched

log = logging.getLogger(__name__)


def apply_remap(
    row: dict, remap: dict[str, str], *, user_id_columns: Iterable[str],
) -> dict:
    """Return a copy of ``row`` with every user-id column routed through ``remap``.

    Unknown UUIDs pass through unchanged (caller logs/skips if needed).
    Null values pass through unchanged.
    """
    out = dict(row)
    for col in user_id_columns:
        val = out.get(col)
        if val is None:
            continue
        out[col] = remap.get(val, val)
    return out


def column_intersection(
    prod_cols: set[str], staging_cols: set[str],
) -> tuple[set[str], set[str], set[str]]:
    """Return (shared, extra_prod, extra_staging) sets."""
    shared = prod_cols & staging_cols
    extra_prod = prod_cols - staging_cols
    extra_staging = staging_cols - prod_cols
    return shared, extra_prod, extra_staging


def copy_table(
    *,
    prod_client,
    staging_client,
    prod_table: str,
    staging_table: str,
    remap: dict[str, str],
    user_id_columns: tuple[str, ...] = ("user_id",),
    shared_columns: set[str],
    batch_size: int = 100,
    dry_run: bool = False,
) -> int:
    """Copy every row from ``prod_table`` into ``staging_table`` applying ``remap``.

    Returns the number of rows inserted (0 on dry-run).
    """
    rows = (
        prod_client.table(prod_table)
        .select(",".join(sorted(shared_columns)))
        .execute()
    ).data or []

    log.info("Read %d rows from prod.%s", len(rows), prod_table)
    if dry_run:
        log.info("[dry-run] Would insert %d rows into staging.%s", len(rows), staging_table)
        return 0

    transformed = [
        apply_remap(row, remap, user_id_columns=user_id_columns)
        for row in rows
    ]
    inserted = 0
    for chunk in batched(transformed, batch_size):
        staging_client.table(staging_table).insert(chunk).execute()
        inserted += len(chunk)
        log.info("Inserted %d/%d into staging.%s", inserted, len(transformed), staging_table)
    return inserted
