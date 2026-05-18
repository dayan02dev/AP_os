"""Unit tests for lib/copy.py — remap application + column intersection."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib.copy import apply_remap, column_intersection


def test_apply_remap_rewrites_user_id():
    row = {"id": "app-1", "user_id": "prod-uid-1", "basic_email": "a@b.co"}
    remap = {"prod-uid-1": "staging-uid-1"}

    out = apply_remap(row, remap, user_id_columns=("user_id",))

    assert out["user_id"] == "staging-uid-1"
    assert out["id"] == "app-1"   # app PK is NOT remapped
    assert out["basic_email"] == "a@b.co"


def test_apply_remap_handles_multiple_user_id_columns():
    row = {"reviewer_user_id": "prod-r-1", "assigned_by": "prod-l-1"}
    remap = {"prod-r-1": "staging-r-1", "prod-l-1": "staging-l-1"}

    out = apply_remap(
        row, remap,
        user_id_columns=("reviewer_user_id", "assigned_by"),
    )

    assert out["reviewer_user_id"] == "staging-r-1"
    assert out["assigned_by"] == "staging-l-1"


def test_apply_remap_passes_through_unknown_ids():
    # If a UUID isn't in the remap, the row passes through with the
    # original UUID. Caller decides whether to log/skip.
    row = {"user_id": "unknown-prod-uid"}
    remap: dict[str, str] = {}

    out = apply_remap(row, remap, user_id_columns=("user_id",))

    assert out["user_id"] == "unknown-prod-uid"


def test_apply_remap_skips_null_values():
    row = {"user_id": None, "assigned_by": None}
    remap = {"prod-1": "staging-1"}

    out = apply_remap(row, remap, user_id_columns=("user_id", "assigned_by"))

    assert out["user_id"] is None
    assert out["assigned_by"] is None


def test_column_intersection():
    prod_cols = {"id", "basic_email", "legacy_field_dropped_in_staging"}
    staging_cols = {"id", "basic_email", "newer_field_only_in_staging"}

    shared, extra_prod, extra_staging = column_intersection(prod_cols, staging_cols)

    assert shared == {"id", "basic_email"}
    assert extra_prod == {"legacy_field_dropped_in_staging"}
    assert extra_staging == {"newer_field_only_in_staging"}
