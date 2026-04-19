"""/health endpoint tests.

The `db` field depends on Supabase connectivity. Assert status=ok always;
for `db` accept either "ok" (typical locally with .env populated) or "error"
(CI without network / Supabase creds).
"""

from __future__ import annotations


def test_health_returns_200(client):
    res = client.get("/health")
    assert res.status_code == 200


def test_health_shape(client):
    data = client.get("/health").json()
    assert data["status"] == "ok"
    assert data["db"] in {"ok", "error"}


def test_health_is_rate_limited(client):
    """61st request inside the 60/min window must return 429.

    We hit /health 61 times. The first 60 must succeed; at least one of the
    remainder must be 429 (slowapi's in-memory bucket counts per IP).
    """
    codes = [client.get("/health").status_code for _ in range(61)]
    assert codes[:60].count(200) == 60, f"first 60 should all be 200, got: {codes[:60]}"
    assert codes[60] == 429, f"61st call should be 429, got {codes[60]}"
