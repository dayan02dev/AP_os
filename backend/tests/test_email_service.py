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
    assert payload["subject"].startswith("ARTPARK TIR")
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


# ─── Phase 1 admin platform senders (Session 8 / Task 26) ──────────────


def test_role_granted_renders_role_label_and_signin_link(configured):
    fake = MagicMock(return_value=_ok())
    svc = _svc_with_post(fake)
    svc.send_role_granted(
        to="newrev@artpark.in",
        user_name="New Reviewer",
        role="reviewer",
        granted_by="admin@artpark.in",
        signin_url="https://example.test/apply/signin",
    )
    payload = fake.call_args.kwargs["json"]
    assert "Reviewer" in payload["subject"]  # _role_copy maps to "Reviewer"
    assert payload["to"] == ["newrev@artpark.in"]
    assert "New Reviewer" in payload["html"]
    assert "https://example.test/apply/signin" in payload["html"]
    assert "admin@artpark.in" in payload["html"]
    # The blurb describes what the reviewer role lets them do.
    assert "Score applications" in payload["html"]


def test_role_granted_unknown_role_falls_back_gracefully(configured):
    fake = MagicMock(return_value=_ok())
    svc = _svc_with_post(fake)
    svc.send_role_granted(
        to="u@x.com",
        user_name="U",
        role="mystery-role",
        granted_by="admin",
        signin_url="https://example.test/apply/signin",
    )
    payload = fake.call_args.kwargs["json"]
    # Title-cased fallback for the label; generic blurb body.
    assert "Mystery-Role" in payload["subject"]
    assert "mystery-role" in payload["html"]


def test_reviewer_assigned_carries_inbox_url_and_applicant_name(configured):
    fake = MagicMock(return_value=_ok())
    svc = _svc_with_post(fake)
    svc.send_reviewer_assigned(
        to="rev@artpark.in",
        reviewer_name="R Reviewer",
        applicant_name="A Applicant",
        application_id="ffffffff-1111-2222-3333-444455556666",
        track="tir",
        inbox_url="https://example.test/reviewer/inbox",
    )
    payload = fake.call_args.kwargs["json"]
    assert payload["to"] == ["rev@artpark.in"]
    assert "TIR" in payload["subject"]
    assert "A Applicant" in payload["subject"]
    assert "A Applicant" in payload["html"]
    assert "https://example.test/reviewer/inbox" in payload["html"]
    # Application id is short-formed (first 8 chars) for readability.
    assert "ffffffff" in payload["html"]


def test_status_change_shortlisted_voice(configured):
    fake = MagicMock(return_value=_ok())
    svc = _svc_with_post(fake)
    svc.send_status_change(
        to="appy@example.com",
        applicant_name="Priya",
        application_id="aaaa1111-2222-3333-4444-555566667777",
        track="tir",
        to_status="shortlisted",
    )
    payload = fake.call_args.kwargs["json"]
    assert payload["subject"] == "Great news — you've been shortlisted"
    assert "shortlisted" in payload["html"].lower()
    assert "Priya" in payload["html"]


def test_status_change_rejected_avoids_scores_and_uses_neutral_voice(configured):
    fake = MagicMock(return_value=_ok())
    svc = _svc_with_post(fake)
    svc.send_status_change(
        to="appy@example.com",
        applicant_name="Sam",
        application_id="bbbb2222-3333-4444-5555-666677778888",
        track="sip",
        to_status="rejected",
    )
    payload = fake.call_args.kwargs["json"]
    body = payload["html"].lower()
    # Per spec §8: no raw scores, neutral rejection voice.
    assert "score" not in body
    assert "won't be advancing" in body or "thank you for applying" in body
    # Subject doesn't expose the rejection word — applicants don't need that
    # in their inbox preview text.
    assert "rejected" not in payload["subject"].lower()


def test_status_change_waitlisted_voice(configured):
    fake = MagicMock(return_value=_ok())
    svc = _svc_with_post(fake)
    svc.send_status_change(
        to="appy@example.com",
        applicant_name="Liu",
        application_id="cccc3333-4444-5555-6666-777788889999",
        track="tir",
        to_status="waitlisted",
    )
    payload = fake.call_args.kwargs["json"]
    body = payload["html"].lower()
    assert "waitlist" in body


# ─── Module-level helpers ──────────────────────────────────────────────


def test_role_copy_for_known_role():
    label, blurb = es._role_copy("leadership")
    assert label == "Leadership"
    assert "Gate 1" in blurb


def test_role_copy_unknown_role_titlecases():
    label, blurb = es._role_copy("custodian")
    assert label == "Custodian"
    assert "custodian" in blurb


def test_track_label_known():
    assert es._track_label("tir") == "TIR"
    assert es._track_label("sip") == "SIP"


def test_track_label_unknown_uppercases():
    assert es._track_label("foo") == "FOO"


def test_track_label_none_returns_empty():
    assert es._track_label(None) == ""


def test_frontend_url_uses_first_origin():
    with patch.object(es.settings, "frontend_origin", "https://a.test,https://b.test"):
        assert es.frontend_url("/apply/signin") == "https://a.test/apply/signin"


def test_frontend_url_strips_trailing_slash_on_origin():
    with patch.object(es.settings, "frontend_origin", "https://a.test/"):
        assert es.frontend_url("/x") == "https://a.test/x"


def test_frontend_url_inserts_leading_slash_if_missing():
    with patch.object(es.settings, "frontend_origin", "https://a.test"):
        assert es.frontend_url("x") == "https://a.test/x"
