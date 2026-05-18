"""Unit tests for lib/probe.py — URL safety + project-ref guard."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib.probe import (
    SafetyCheckFailed,
    assert_url_matches_project,
)


def test_url_matches_correct_project_ref():
    # Should not raise.
    assert_url_matches_project(
        url="https://xtmszlpwgbyoumalgbhs.supabase.co",
        expected_project_ref="xtmszlpwgbyoumalgbhs",
        label="prod",
    )


def test_url_with_path_suffix_still_passes():
    # URLs with trailing slashes / paths are tolerated.
    assert_url_matches_project(
        url="https://exqmxvdtcsvpgtftwjml.supabase.co/",
        expected_project_ref="exqmxvdtcsvpgtftwjml",
        label="staging",
    )


def test_url_with_wrong_project_ref_raises():
    with pytest.raises(SafetyCheckFailed) as exc:
        assert_url_matches_project(
            url="https://xtmszlpwgbyoumalgbhs.supabase.co",
            expected_project_ref="exqmxvdtcsvpgtftwjml",
            label="staging",
        )
    msg = str(exc.value)
    assert "staging" in msg
    assert "exqmxvdtcsvpgtftwjml" in msg
    assert "xtmszlpwgbyoumalgbhs" in msg


def test_empty_url_raises():
    with pytest.raises(SafetyCheckFailed):
        assert_url_matches_project(
            url="",
            expected_project_ref="xtmszlpwgbyoumalgbhs",
            label="prod",
        )


def test_malformed_url_raises():
    with pytest.raises(SafetyCheckFailed):
        assert_url_matches_project(
            url="not-a-url",
            expected_project_ref="xtmszlpwgbyoumalgbhs",
            label="prod",
        )


def test_url_with_evil_subdomain_attack_raises():
    """An attacker prefixing the legit ref onto an evil hostname must be rejected.

    Without a full-hostname check, host.split('.', 1)[0] would extract
    'xtmszlpwgbyoumalgbhs' and the comparison would succeed even though
    the actual hostname is evil.com.
    """
    with pytest.raises(SafetyCheckFailed):
        assert_url_matches_project(
            url="https://xtmszlpwgbyoumalgbhs.supabase.co.evil.com",
            expected_project_ref="xtmszlpwgbyoumalgbhs",
            label="prod",
        )


# ─── Column inventory ────────────────────────────────────────────────


def test_column_inventory_returns_set(fake_prod):
    # Seed the fake with a synthetic information_schema response. Each
    # row needs the filter keys (table_schema, table_name) because the
    # FakeQuery now filters .eq() per real Supabase semantics — without
    # those keys the rows would be dropped by the filter.
    fake_prod.tables["information_schema.columns"] = [
        {"column_name": "id", "table_schema": "public", "table_name": "applications"},
        {"column_name": "basic_full_name", "table_schema": "public", "table_name": "applications"},
        {"column_name": "basic_email", "table_schema": "public", "table_name": "applications"},
        # Extra row that should be filtered out (different schema).
        {"column_name": "other_col", "table_schema": "auth", "table_name": "users"},
    ]
    from lib.probe import column_inventory

    cols = column_inventory(fake_prod, schema="public", table="applications")
    assert cols == {"id", "basic_full_name", "basic_email"}
    # The other_col row had table_schema="auth", so it must NOT be in the result.
    assert "other_col" not in cols


# ─── Seed signature ──────────────────────────────────────────────────


def test_seed_signature_present(fake_staging):
    fake_staging.tables["tir_applications"] = [
        {"id": "aaa", "basic_email": "seed-app-001@artpark.test"},
        {"id": "bbb", "basic_email": "seed-app-002@artpark.test"},
    ]
    from lib.probe import seed_signature_present

    assert seed_signature_present(fake_staging) is True


def test_seed_signature_absent(fake_staging):
    fake_staging.tables["tir_applications"] = []
    from lib.probe import seed_signature_present

    assert seed_signature_present(fake_staging) is False
