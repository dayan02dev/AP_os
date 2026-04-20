"""/health endpoint tests (Phase 8).

Two endpoints:
  /health        shallow liveness — always 200, no external deps
  /health/ready  deep readiness — db + auth + llm checks
"""

from __future__ import annotations


def test_health_returns_200(client):
    res = client.get("/health")
    assert res.status_code == 200


def test_health_shape(client):
    data = client.get("/health").json()
    assert data["status"] == "ok"
    assert "version" in data
    assert "uptime_seconds" in data
    assert isinstance(data["uptime_seconds"], int)
    assert data["uptime_seconds"] >= 0


def test_health_ready_shape(client):
    """Deep check — status may be degraded if external deps are unreachable."""
    res = client.get("/health/ready")
    assert res.status_code in (200, 503)
    data = res.json()
    assert data["status"] in {"ok", "degraded"}
    assert "checks" in data
    for key in ("db", "auth", "llm"):
        assert data["checks"][key] in {"ok", "error"}


def test_health_is_rate_limited(client):
    """61st request inside the 60/min window must return 429."""
    codes = [client.get("/health").status_code for _ in range(61)]
    assert codes[:60].count(200) == 60, f"first 60 should all be 200, got: {codes[:60]}"
    assert codes[60] == 429, f"61st call should be 429, got {codes[60]}"
