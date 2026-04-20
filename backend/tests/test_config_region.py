"""Tests for the AWS_REGION_APP ↔ AWS_REGION fallback in config.py.

Lambda reserves AWS_REGION and pre-populates it with the runtime region, so
we can't pass our own value through that name. In production the SAM
template exports AWS_REGION_APP, which must win when both are set. Locally,
AWS_REGION in .env must still work unchanged.
"""

from __future__ import annotations

import pytest


@pytest.fixture
def _isolate_env(monkeypatch):
    """Strip both region vars + stub required secrets so Settings can construct."""
    monkeypatch.delenv("AWS_REGION", raising=False)
    monkeypatch.delenv("AWS_REGION_APP", raising=False)
    # Settings() requires these even though the test doesn't touch them.
    monkeypatch.setenv("SUPABASE_URL", "https://test.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "test-anon-key-not-real")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key-not-real")
    yield monkeypatch


def _fresh_settings():
    from app.config import Settings
    return Settings(_env_file=None)  # ignore .env for the test


def test_default_region_when_neither_set(_isolate_env):
    s = _fresh_settings()
    assert s.aws_region == "ap-south-1"


def test_reads_aws_region_locally(_isolate_env):
    _isolate_env.setenv("AWS_REGION", "us-east-1")
    s = _fresh_settings()
    assert s.aws_region == "us-east-1"


def test_reads_aws_region_app_in_lambda(_isolate_env):
    """Lambda pre-populates AWS_REGION; our SAM template also sets AWS_REGION_APP.
    AWS_REGION_APP must win so we can override region from the template.
    """
    _isolate_env.setenv("AWS_REGION", "us-east-1")
    _isolate_env.setenv("AWS_REGION_APP", "ap-south-1")
    s = _fresh_settings()
    assert s.aws_region == "ap-south-1"


def test_aws_region_app_alone_is_picked_up(_isolate_env):
    _isolate_env.setenv("AWS_REGION_APP", "eu-west-1")
    s = _fresh_settings()
    assert s.aws_region == "eu-west-1"
