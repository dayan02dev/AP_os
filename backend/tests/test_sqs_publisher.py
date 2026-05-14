"""Unit tests for the AI-screening SQS publisher.

The publisher is called from the submit endpoint after status flips to
``submitted``. Tests cover:

* The happy path posts the right MessageBody and MessageGroupId.
* An unset ``AI_SCREENING_QUEUE_URL`` short-circuits (no boto3 call).
* SQS failures are swallowed so submit stays best-effort.
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

from app.services import sqs_publisher


@pytest.fixture(autouse=True)
def _reset_client_cache():
    """Each test gets a fresh boto3 client cache so patches actually bite."""
    sqs_publisher._sqs_client.cache_clear()
    yield
    sqs_publisher._sqs_client.cache_clear()


def test_publish_sends_message_with_correct_payload(monkeypatch):
    monkeypatch.setenv("AI_SCREENING_QUEUE_URL", "https://sqs.example/queue.fifo")
    fake_client = MagicMock()

    with patch.object(sqs_publisher, "_sqs_client", return_value=fake_client):
        sqs_publisher.publish("app-123", "tir")

    fake_client.send_message.assert_called_once()
    kwargs = fake_client.send_message.call_args.kwargs

    assert kwargs["QueueUrl"] == "https://sqs.example/queue.fifo"
    assert kwargs["MessageGroupId"] == "app-123"

    body = json.loads(kwargs["MessageBody"])
    assert body == {"application_id": "app-123", "application_track": "tir"}


def test_publish_skips_when_queue_url_unset(monkeypatch):
    monkeypatch.delenv("AI_SCREENING_QUEUE_URL", raising=False)
    fake_client = MagicMock()

    with patch.object(sqs_publisher, "_sqs_client", return_value=fake_client):
        sqs_publisher.publish("app-456", "tir")

    fake_client.send_message.assert_not_called()


def test_publish_swallows_sqs_failures(monkeypatch):
    """If SQS raises we must NOT propagate — submit stays best-effort."""
    monkeypatch.setenv("AI_SCREENING_QUEUE_URL", "https://sqs.example/queue.fifo")
    fake_client = MagicMock()
    fake_client.send_message.side_effect = RuntimeError("SQS unreachable")

    with patch.object(sqs_publisher, "_sqs_client", return_value=fake_client):
        # Must not raise.
        sqs_publisher.publish("app-789", "tir")

    fake_client.send_message.assert_called_once()


def test_publish_passes_track_through(monkeypatch):
    """Track is captured verbatim in the body — the worker dispatches on it."""
    monkeypatch.setenv("AI_SCREENING_QUEUE_URL", "https://sqs.example/queue.fifo")
    fake_client = MagicMock()

    with patch.object(sqs_publisher, "_sqs_client", return_value=fake_client):
        sqs_publisher.publish("app-sip-1", "sip")

    body = json.loads(fake_client.send_message.call_args.kwargs["MessageBody"])
    assert body["application_track"] == "sip"
