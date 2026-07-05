import json
from app.services import sqs_publisher


def test_publish_founder_check_sends_job_message(monkeypatch):
    sent = {}

    class _FakeSqs:
        def send_message(self, **kw):
            sent.update(kw)
            return {}

    monkeypatch.setenv("AI_SCREENING_QUEUE_URL", "https://sqs.example/q.fifo")
    monkeypatch.setattr(sqs_publisher, "_sqs_client", lambda: _FakeSqs())

    sqs_publisher.publish_founder_check("app-1", "tir")

    body = json.loads(sent["MessageBody"])
    assert body == {"application_id": "app-1", "application_track": "tir", "job": "founder_check"}
    assert sent["MessageGroupId"] == "app-1"


def test_publish_founder_check_noop_without_queue_url(monkeypatch):
    called = {"n": 0}

    class _FakeSqs:
        def send_message(self, **kw):
            called["n"] += 1

    monkeypatch.delenv("AI_SCREENING_QUEUE_URL", raising=False)
    monkeypatch.setattr(sqs_publisher, "_sqs_client", lambda: _FakeSqs())
    sqs_publisher.publish_founder_check("app-1", "tir")   # must not raise, must not send
    assert called["n"] == 0
