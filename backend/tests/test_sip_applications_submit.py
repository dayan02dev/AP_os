"""Submit-path test for the SIP router: a valid submit enqueues SQS.

Mirrors TIR's applications.submit → sqs_publisher.publish(id, "tir") wiring,
which the SIP submit now mirrors with track "sip". The full submit handler
has rate-limit / fetch / validation steps; we monkeypatch the module-level
helpers so the test exercises the publish wiring without a live Supabase or
queue.
"""
from __future__ import annotations

import asyncio

import app.routers.sip_applications as sip_router


def test_sip_submit_publishes_to_sqs(monkeypatch):
    app_id = "5151515b-0000-0000-0000-000000000042"
    user_id = "00000000-0000-0000-0000-000000000002"

    published: list[tuple[str, str]] = []

    # No-op the side effects so submit reaches the publish line.
    monkeypatch.setattr(sip_router, "check_rate", lambda *a, **k: None)
    monkeypatch.setattr(sip_router, "record_rate", lambda *a, **k: None)
    monkeypatch.setattr(sip_router, "_audit", lambda **k: None)
    monkeypatch.setattr(sip_router, "_send_submission_email", lambda **k: None)
    monkeypatch.setattr(
        sip_router, "_validate_submission", lambda row: ([], [])
    )
    monkeypatch.setattr(sip_router, "_completion_pct", lambda row: (100, []))

    draft = {"id": app_id, "status": "draft", "user_id": user_id}
    monkeypatch.setattr(sip_router, "_fetch_application", lambda uid: draft)

    def _fake_update(application_id, patch):
        return {
            "id": application_id,
            "status": "submitted",
            "submitted_at": "2026-06-11T00:00:00+00:00",
            "basic_full_name": "SIP Founder",
            "basic_email": "f@example.com",
        }

    monkeypatch.setattr(sip_router, "_update_application", _fake_update)
    monkeypatch.setattr(
        sip_router.sqs_publisher,
        "publish",
        lambda aid, track: published.append((aid, track)),
    )

    class _Req:
        client = None
        headers: dict = {}

    result = asyncio.run(
        sip_router.submit_application(
            request=_Req(),
            current_user={"user_id": user_id, "email": "f@example.com"},
        )
    )

    assert published == [(app_id, "sip")]
    assert result.application_id == app_id
    assert result.ok is True
