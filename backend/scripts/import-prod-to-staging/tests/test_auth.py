"""Unit tests for lib/auth.py — remap dict building.

The actual admin.create_user call hits Supabase GoTrue and is integration
territory. We test the in-memory orchestration: 'given these prod user
rows + this staging existing-users table, produce this remap dict'.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib.auth import scrambled_password, build_user_remap


def test_scrambled_password_is_64_hex_chars():
    pw = scrambled_password()
    assert len(pw) == 64
    assert all(c in "0123456789abcdef" for c in pw)


def test_scrambled_password_is_unique_per_call():
    assert scrambled_password() != scrambled_password()


def test_build_user_remap_preserves_existing_emails():
    # Prod has 2 applicants; staging already has dev@artpark.in.
    prod_users = [
        {"id": "prod-1", "email": "applicant-a@example.com",
         "raw_user_meta_data": {"track": "tir"}},
        {"id": "prod-2", "email": "dev@artpark.in",
         "raw_user_meta_data": {"track": "tir"}},
    ]
    staging_existing_by_email = {"dev@artpark.in": "staging-dev-uid"}

    created_user_responses = iter([
        {"id": "staging-new-1"},   # for applicant-a@example.com
    ])

    def fake_create_user(email: str, **_kwargs):
        return next(created_user_responses)

    remap = build_user_remap(
        prod_users=prod_users,
        staging_existing_by_email=staging_existing_by_email,
        create_user_fn=fake_create_user,
    )

    assert remap["prod-1"] == "staging-new-1"
    assert remap["prod-2"] == "staging-dev-uid"


def test_build_user_remap_handles_create_user_already_exists():
    # Admin API returns 422 user_already_exists — caller must look up
    # the existing UUID by email.
    prod_users = [
        {"id": "prod-99", "email": "duplicate@example.com",
         "raw_user_meta_data": {}},
    ]
    staging_existing_by_email = {"duplicate@example.com": "staging-existing"}

    def fake_create_user(email: str, **_kwargs):
        raise RuntimeError("user_already_exists")

    remap = build_user_remap(
        prod_users=prod_users,
        staging_existing_by_email=staging_existing_by_email,
        create_user_fn=fake_create_user,
    )

    assert remap["prod-99"] == "staging-existing"
