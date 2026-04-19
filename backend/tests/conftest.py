"""Shared pytest fixtures.

The TestClient fixture is function-scoped so the slowapi in-memory bucket
resets between tests (otherwise the rate-limit test leaks state into
whatever runs next).
"""

from __future__ import annotations

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
