"""Unit tests for lib/tables.py — constants + batched() helper."""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib.tables import (
    PRESERVE_EMAILS,
    PROD_PROJECT_REF,
    STAGING_PROJECT_REF,
    TABLE_MAP,
    batched,
)


def test_batched_yields_complete_chunks():
    chunks = list(batched(list(range(10)), batch_size=4))
    assert chunks == [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9]]


def test_batched_empty_input():
    assert list(batched([], batch_size=4)) == []


def test_batched_smaller_than_batch():
    assert list(batched([1, 2], batch_size=10)) == [[1, 2]]


def test_table_map_only_two_entries():
    # Prod is pre-migration-010 so only `applications` + `resume_uploads`
    # need renaming. Adding more entries here without spec update is a
    # signal something else changed.
    assert set(TABLE_MAP.keys()) == {"applications", "resume_uploads"}
    assert TABLE_MAP["applications"] == "tir_applications"
    assert TABLE_MAP["resume_uploads"] == "tir_resume_uploads"


def test_preserve_emails_contains_test_logins():
    # The 3 staging sign-in test users must always be in the preserve list
    # — losing them would lock everyone out of staging.
    assert "dev@artpark.in" in PRESERVE_EMAILS
    assert "manager@artpark.in" in PRESERVE_EMAILS
    assert "test@artpark.in" in PRESERVE_EMAILS


def test_project_refs_are_correct():
    assert PROD_PROJECT_REF == "xtmszlpwgbyoumalgbhs"
    assert STAGING_PROJECT_REF == "exqmxvdtcsvpgtftwjml"
