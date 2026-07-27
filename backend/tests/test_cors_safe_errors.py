"""Any unhandled 500 must be returned INSIDE the CORS layer so the browser
gets Access-Control-Allow-Origin instead of an opaque 'Failed to fetch'."""
from __future__ import annotations

from app.config import settings
from app.deps import get_current_user
from app.main import app


def _override_jury():
    return {"user_id": "j1", "email": "j1@x.com", "roles": ["jury"]}


def test_unhandled_500_carries_cors_headers(client, monkeypatch):
    from app.services import jury_query
    monkeypatch.setattr(jury_query, "fetch_jury_queue",
                        lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("boom")))
    app.dependency_overrides[get_current_user] = _override_jury
    try:
        origin = settings.frontend_origins[0] if settings.frontend_origins else None
        headers = {"Origin": origin} if origin else {}
        r = client.get("/jury/queue", headers=headers)
        assert r.status_code == 500, r.text
        assert r.json()["error"]["code"] == "internal_error"
        if origin:
            assert r.headers.get("access-control-allow-origin") == origin
    finally:
        app.dependency_overrides.clear()
