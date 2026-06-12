"""Shared pytest fixtures.

The TestClient fixture is function-scoped so the slowapi in-memory bucket
resets between tests (otherwise the rate-limit test leaks state into
whatever runs next).
"""

from __future__ import annotations

import os

# Sentry must never initialise under pytest: with a real SENTRY_DSN in
# backend/.env the SDK sends events over the network during tests and its
# shutdown flush interacts badly with pytest_freezer's frozen clock. Env vars
# beat the .env file in pydantic-settings, so this wins on machines whose
# backend/.env has a real DSN. Must run before any `from app.main import app`.
os.environ["SENTRY_DSN"] = ""

# Pre-import modules that are pathologically slow to import under freezegun's
# frozen clock. pandas (pulled in lazily by the langchain/langsmith stack)
# makes thousands of time calls in pandas._libs.tslibs at import; if its first
# import happens inside a pytest_freezer test, that test stalls for minutes
# (confirmed via faulthandler dump 2026-06-13). Importing it here caches it in
# sys.modules before any clock is frozen.
try:
    import pandas  # noqa: F401
except ImportError:
    pass

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client() -> TestClient:
    # Import inside the fixture so slowapi's default Limiter state is freshly
    # initialised on each test run that asks for a client.
    from app.main import app

    # Reset the per-IP counters in slowapi before each test.
    if hasattr(app.state, "limiter"):
        app.state.limiter.reset()

    return TestClient(app)
