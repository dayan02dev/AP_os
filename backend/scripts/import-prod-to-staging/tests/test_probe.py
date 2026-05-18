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
