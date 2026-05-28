"""Pure functions that extract storage-object paths from application rows.

The bucket for each path is determined by which COLUMN the path came
from (not by parsing the path string), because the wizard stores only
``<uid>/<filename>`` paths — no bucket prefix.

See spec §7.2 for the column→bucket mapping rationale.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BucketPath:
    """One storage object to copy from prod_bucket → staging_bucket at ``path``."""

    prod_bucket: str
    staging_bucket: str
    path: str


# JSONB column → (prod bucket, staging bucket, "array" or "single")
_APPLICATION_FILE_COLUMNS: list[tuple[str, str, str, str]] = [
    ("evidence_files", "evidence-files", "tir-evidence-files", "array"),
    ("evidence_deck", "evidence-files", "tir-evidence-files", "single"),
    ("execution_milestone_files", "milestone-files", "tir-milestone-files", "array"),
]


def walk_application_storage(row: dict) -> list[BucketPath]:
    """Return every storage-object reference in one ``tir_applications`` row."""
    out: list[BucketPath] = []
    for column, prod_bucket, staging_bucket, kind in _APPLICATION_FILE_COLUMNS:
        value = row.get(column)
        if value is None:
            continue
        if kind == "single":
            entries = [value]
        else:
            entries = value if isinstance(value, list) else []
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            path = entry.get("storage_path")
            if not path:
                continue
            out.append(BucketPath(prod_bucket, staging_bucket, path))
    return out


def walk_resume_storage(row: dict) -> list[BucketPath]:
    """Return the single storage path from one ``tir_resume_uploads`` row."""
    path = row.get("storage_path")
    if not path:
        return []
    return [BucketPath("resumes", "tir-resumes", path)]
