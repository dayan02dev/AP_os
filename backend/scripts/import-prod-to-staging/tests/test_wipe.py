"""Unit tests for lib/wipe.py — wipe-order + preserve semantics.

We don't unit-test the actual DB delete calls (that's integration); we
DO test that resolve_preserve_set() returns the right set and that
WIPE_ORDER is correct (children before parents).
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib.wipe import (
    APPLICATIONS_TO_TRUNCATE,
    CHILD_TABLES_TO_TRUNCATE,
    WIPE_ORDER,
    resolve_preserve_set,
)


def test_wipe_order_children_before_parents():
    # Every CHILD_TABLES entry must appear in WIPE_ORDER before any
    # APPLICATIONS_TO_TRUNCATE entry — otherwise truncate fails with FK.
    order = list(WIPE_ORDER)
    for child in CHILD_TABLES_TO_TRUNCATE:
        for parent in APPLICATIONS_TO_TRUNCATE:
            assert order.index(child) < order.index(parent), (
                f"{child} must be truncated before {parent}"
            )


def test_resolve_preserve_set_includes_static_emails(fake_staging):
    # No reviewers in user_roles → only the 3 static emails survive.
    fake_staging.tables["user_roles"] = []
    # auth.users now reached via the Admin API — seed fake_staging.auth_users.
    fake_staging.auth_users = [
        {"id": "u-1", "email": "dev@artpark.in"},
        {"id": "u-2", "email": "manager@artpark.in"},
        {"id": "u-3", "email": "test@artpark.in"},
        {"id": "u-4", "email": "random@example.com"},
    ]

    preserved = resolve_preserve_set(fake_staging)

    assert "u-1" in preserved
    assert "u-2" in preserved
    assert "u-3" in preserved
    assert "u-4" not in preserved


def test_resolve_preserve_set_includes_reviewers(fake_staging):
    fake_staging.tables["user_roles"] = [
        {"user_id": "u-10", "role": "reviewer"},
        {"user_id": "u-11", "role": "reviewer"},
        {"user_id": "u-12", "role": "leadership"},   # NOT preserved as a reviewer
    ]
    fake_staging.auth_users = [
        {"id": "u-1", "email": "dev@artpark.in"},
        {"id": "u-10", "email": "reviewer-1@artpark.in"},
        {"id": "u-11", "email": "reviewer-2@artpark.in"},
        {"id": "u-12", "email": "leader@artpark.in"},
    ]

    preserved = resolve_preserve_set(fake_staging)

    assert "u-1" in preserved
    assert "u-10" in preserved
    assert "u-11" in preserved
    assert "u-12" not in preserved
