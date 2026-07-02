import asyncio
from app.routers import profile_completion as pc


def test_get_state_valid(monkeypatch):
    row = {"token": "t", "application_id": "app-1", "needs_resume": True, "needs_linkedin": False,
           "is_preview": False, "used_at": None, "expires_at": "2999-01-01T00:00:00+00:00"}
    monkeypatch.setattr(pc, "get_admin_client", lambda: object())
    monkeypatch.setattr(pc.svc, "fetch_token", lambda c, t: row)
    monkeypatch.setattr(pc, "_applicant_display", lambda c, app_id: ("Asha", "TIR-26010"))
    out = asyncio.run(pc.get_token_state("t"))
    assert out["valid"] is True and out["needs_resume"] is True and out["applicant_name"] == "Asha"


def test_get_state_expired(monkeypatch):
    row = {"token": "t", "expires_at": "2000-01-01T00:00:00+00:00", "used_at": None,
           "application_id": "app-1", "needs_resume": True, "needs_linkedin": True, "is_preview": False}
    monkeypatch.setattr(pc, "get_admin_client", lambda: object())
    monkeypatch.setattr(pc.svc, "fetch_token", lambda c, t: row)
    out = asyncio.run(pc.get_token_state("t"))
    assert out == {"valid": False, "reason": "expired"}


def test_get_state_invalid(monkeypatch):
    monkeypatch.setattr(pc, "get_admin_client", lambda: object())
    monkeypatch.setattr(pc.svc, "fetch_token", lambda c, t: None)
    out = asyncio.run(pc.get_token_state("nope"))
    assert out == {"valid": False, "reason": "invalid"}


def test_send_sample(monkeypatch):
    calls = {}
    monkeypatch.setattr(pc, "get_admin_client", lambda: object())
    monkeypatch.setattr(pc.svc, "create_token", lambda c, **kw: calls.update(tok=kw) or "sample-tok")
    sent = {}

    class _ES:
        def send_profile_completion_request(self, **kw): sent.update(kw)
    monkeypatch.setattr(pc, "get_email_service", lambda: _ES())
    monkeypatch.setattr(pc, "frontend_url", lambda p: "https://x" + p)

    body = pc.SendBody(mode="sample", sample_email="me@x.com")
    out = asyncio.run(pc.send_requests(body, user={"user_id": "admin-1"}))
    assert out["mode"] == "sample" and out["sent"] == 1
    assert calls["tok"]["is_preview"] is True and calls["tok"]["application_id"] is None
    assert sent["to"] == "me@x.com" and "sample-tok" in sent["link_url"]
