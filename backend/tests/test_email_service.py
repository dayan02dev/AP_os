"""Unit tests for EmailService (Resend HTTP transport).

Mocks are scoped to the service instance's own `_http` attribute — NOT to
`httpx.Client.post` globally, because Starlette's TestClient also uses
httpx internally and a broad patch would swallow its own requests.

Covers:
  - payload shape sent to Resend (from / to / subject / html / text / reply_to)
  - Authorization header carries the Resend key
  - success path returns {"message_id", "status": "sent"}
  - non-2xx from Resend → EmailDeliveryError with upstream message
  - network failure (httpx.RequestError) → EmailDeliveryError
  - guard rails: missing FROM or missing API key both raise
  - Jinja templates render + contain the dynamic context
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import httpx
import pytest

from app.services import email_service as es


def _ok(json_body: dict | None = None) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = 200
    resp.json.return_value = json_body or {"id": "resend-msg-xyz"}
    resp.text = ""
    return resp


def _err(code: int, body: dict | None = None) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = code
    resp.json.return_value = body or {"message": "nope"}
    resp.text = "nope"
    return resp


def _svc_with_post(fake_post: MagicMock) -> es.EmailService:
    """Build an EmailService whose _http.post is the given mock."""
    svc = es.EmailService()
    svc._http = MagicMock(spec=httpx.Client)
    svc._http.post = fake_post
    return svc


@pytest.fixture(autouse=True)
def _reset_service():
    es.get_email_service.cache_clear()
    yield
    es.get_email_service.cache_clear()


@pytest.fixture
def configured():
    """Patch both required settings so send_raw doesn't short-circuit."""
    with (
        patch.object(es.settings, "ses_from_email", "noreply@artpark.test"),
        patch.object(es.settings, "resend_api_key", "re_test_not_real"),
    ):
        yield


# ─── send_raw ──────────────────────────────────────────────────────

def test_send_raw_success_shape(configured):
    fake = MagicMock(return_value=_ok())
    svc = _svc_with_post(fake)
    out = svc.send_raw(
        to=["a@example.com"],
        subject="hi",
        html="<p>hi</p>",
        text="hi",
    )
    assert out == {"message_id": "resend-msg-xyz", "status": "sent"}
    fake.assert_called_once()
    args, _ = fake.call_args
    assert args[0] == "https://api.resend.com/emails"


def test_send_raw_payload_and_auth(configured):
    fake = MagicMock(return_value=_ok())
    svc = _svc_with_post(fake)
    svc.send_raw(
        to=["a@example.com", "b@example.com"],
        subject="hello",
        html="<p>h</p>",
        text="h",
        reply_to="reply@example.com",
    )
    _, kwargs = fake.call_args
    payload = kwargs["json"]
    assert payload["from"] == "noreply@artpark.test"
    assert payload["to"] == ["a@example.com", "b@example.com"]
    assert payload["subject"] == "hello"
    assert payload["html"] == "<p>h</p>"
    assert payload["text"] == "h"
    assert payload["reply_to"] == ["reply@example.com"]
    assert kwargs["headers"]["Authorization"] == "Bearer re_test_not_real"
    assert kwargs["headers"]["Content-Type"] == "application/json"


def test_send_raw_no_recipients(configured):
    svc = es.EmailService()
    with pytest.raises(es.EmailDeliveryError, match="No recipients"):
        svc.send_raw(to=[], subject="x", html="<p/>", text="x")


def test_send_raw_missing_from():
    with (
        patch.object(es.settings, "ses_from_email", ""),
        patch.object(es.settings, "resend_api_key", "re_test"),
    ):
        svc = es.EmailService()
        with pytest.raises(es.EmailDeliveryError, match="SES_FROM_EMAIL"):
            svc.send_raw(to=["a@b.co"], subject="x", html="<p/>", text="x")


def test_send_raw_missing_api_key():
    with (
        patch.object(es.settings, "ses_from_email", "noreply@x.io"),
        patch.object(es.settings, "resend_api_key", ""),
    ):
        svc = es.EmailService()
        with pytest.raises(es.EmailDeliveryError, match="RESEND_API_KEY"):
            svc.send_raw(to=["a@b.co"], subject="x", html="<p/>", text="x")


def test_send_raw_http_error_surfaces(configured):
    fake = MagicMock(return_value=_err(422, {"message": "domain not verified"}))
    svc = _svc_with_post(fake)
    with pytest.raises(es.EmailDeliveryError, match="422"):
        svc.send_raw(to=["x@y.z"], subject="x", html="<p/>", text="x")


def test_send_raw_network_error_wraps(configured):
    fake = MagicMock(side_effect=httpx.ConnectError("dns fail"))
    svc = _svc_with_post(fake)
    with pytest.raises(es.EmailDeliveryError, match="request failed"):
        svc.send_raw(to=["x@y.z"], subject="x", html="<p/>", text="x")


# ─── Template-backed senders ──────────────────────────────────────

def test_submission_confirmation_renders_context(configured):
    fake = MagicMock(return_value=_ok())
    svc = _svc_with_post(fake)
    svc.send_submission_confirmation(
        to="applicant@example.com",
        applicant_name="Priya Sharma",
        application_id="abc-123",
    )
    payload = fake.call_args.kwargs["json"]
    assert "Priya Sharma" in payload["html"]
    assert "abc-123" in payload["html"]
    assert "Priya Sharma" in payload["text"]
    assert payload["subject"].startswith("ARTPARK EIR")
    assert payload["to"] == ["applicant@example.com"]


def test_support_ticket_fans_out_to_recipients(configured):
    fake = MagicMock(return_value=_ok())
    svc = _svc_with_post(fake)
    ticket = {
        "id": "t-1",
        "email": "user@example.com",
        "subject": "cv upload broken",
        "body": "it fails at 90 percent every single time",
        "category": "technical",
    }
    svc.send_support_ticket(
        ticket,
        recipients=["dev@artpark.in", "udayan@artpark.in", "nirav@artpark.in"],
    )
    payload = fake.call_args.kwargs["json"]
    assert payload["to"] == ["dev@artpark.in", "udayan@artpark.in", "nirav@artpark.in"]
    assert payload["reply_to"] == ["user@example.com"]
    assert "cv upload broken" in payload["subject"]
    assert "technical" in payload["subject"]


def test_ticket_ack_short_id_in_subject(configured):
    fake = MagicMock(return_value=_ok())
    svc = _svc_with_post(fake)
    svc.send_ticket_acknowledgement(
        to="user@example.com",
        ticket_id="deadbeef-0000-1111-2222-333344445555",
        subject_summary="CV upload fails",
    )
    payload = fake.call_args.kwargs["json"]
    assert "#deadbeef" in payload["subject"]
    assert "CV upload fails" in payload["html"]
