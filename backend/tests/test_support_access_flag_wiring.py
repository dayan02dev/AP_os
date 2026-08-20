"""Filing an access-request ticket must emit a distinctive log line that the
CloudWatch metric filter can alarm on."""
from __future__ import annotations

import logging
from unittest.mock import MagicMock

import pytest

from app.routers import support as support_mod


@pytest.fixture
def fake_admin(monkeypatch):
    admin = MagicMock()
    admin.table.return_value.insert.return_value.execute.return_value = MagicMock(
        data=[{"id": "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0", "email": "x@y.com", "subject": "s", "body": "b",
               "category": "general", "status": "open", "created_at": "2026-08-20T00:00:00Z"}]
    )
    monkeypatch.setattr(support_mod, "get_admin_client", lambda: admin)
    return admin


def test_access_request_ticket_logs_the_security_marker(client, fake_admin, monkeypatch, caplog):
    monkeypatch.setattr(support_mod, "_resolve_support_recipients", lambda: ["staff@artpark.in"])
    monkeypatch.setattr(support_mod, "get_email_service",
                        lambda: MagicMock(send_support_ticket=MagicMock(),
                                          send_ticket_acknowledgement=MagicMock()))
    with caplog.at_level(logging.WARNING):
        res = client.post("/support/ticket", json={
            "email": "wiwohow412@example.com",
            "subject": "Request: Leadership, Reviewer and Jury platform access",
            "body": "Please grant the relevant roles to this account.",
            "category": "general",
        })
    assert res.status_code == 200
    assert "SECURITY_ACCESS_REQUEST" in caplog.text


def test_an_ordinary_ticket_does_not_log_the_marker(client, fake_admin, monkeypatch, caplog):
    monkeypatch.setattr(support_mod, "_resolve_support_recipients", lambda: ["staff@artpark.in"])
    monkeypatch.setattr(support_mod, "get_email_service",
                        lambda: MagicMock(send_support_ticket=MagicMock(),
                                          send_ticket_acknowledgement=MagicMock()))
    with caplog.at_level(logging.WARNING):
        res = client.post("/support/ticket", json={
            "email": "real@iisc.ac.in",
            "subject": "Can't upload my resume",
            "body": "The upload button spins forever on a 4MB PDF.",
            "category": "general",
        })
    assert res.status_code == 200
    assert "SECURITY_ACCESS_REQUEST" not in caplog.text
