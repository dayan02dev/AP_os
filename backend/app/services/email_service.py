"""AWS SES v2 email service — transactional email for the EIR portal.

Wraps `boto3.client('sesv2')` behind three high-level methods:

  send_submission_confirmation(to, applicant_name, application_id)
  send_support_ticket(ticket, recipients)
  send_ticket_acknowledgement(to, ticket_id, subject_summary)

Each method renders a paired Jinja2 template (`*.html` + `*.txt`) from
`backend/app/templates/email/` and hands both parts to `send_raw()`.

`EmailDeliveryError` is raised on SES ClientError so callers can decide whether
to swallow or propagate — the support-ticket route swallows (so the ticket row
is never lost) and marks `email_delivery_status='failed'`.

════════════════════════════════════════════════════════════════════════
 AWS SES setup checklist (do this once per environment before go-live)
════════════════════════════════════════════════════════════════════════
 1. Verified Identities
    AWS Console → SES → Verified Identities → verify `artpark.online`
    (or, for sandbox: verify each From/To address individually).
 2. IAM user `artpark-ses` with this inline policy:
      {
        "Version": "2012-10-17",
        "Statement": [{
          "Effect": "Allow",
          "Action": ["ses:SendEmail"],
          "Resource": "*"
        }]
      }
 3. Populate `backend/.env`:
      AWS_REGION=ap-south-1
      SES_FROM_EMAIL=noreply@artpark.online
      SUPPORT_RECIPIENT_EMAILS=dev@artpark.in,udayan.pawar@artpark.in,nirav@artpark.in
      AWS_ACCESS_KEY_ID=AKIA...
      AWS_SECRET_ACCESS_KEY=...
    (boto3 reads AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY from the process
     environment automatically via its default credential chain — no code in
     this service reads them directly.)
 4. Sandbox constraints
    While the AWS account is in the SES sandbox you can only send to verified
    addresses. The three hardcoded default support recipients
    (dev@artpark.in, udayan.pawar@artpark.in, nirav@artpark.in) MUST be
    verified in SES during sandbox testing.
 5. Request production access at least 5 days before launch — the approval is
    a manual review by AWS.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path
from typing import Any

import boto3
from botocore.exceptions import ClientError
from jinja2 import Environment, FileSystemLoader, select_autoescape

from ..config import settings

log = logging.getLogger(__name__)

_TEMPLATE_DIR = Path(__file__).resolve().parents[1] / "templates" / "email"


class EmailDeliveryError(Exception):
    """Raised when SES rejects a send or the API call fails."""


class EmailService:
    """Thin wrapper around SESv2 + Jinja2.

    One instance per process is sufficient; use `get_email_service()` to get
    the memoised singleton. The boto3 client and Jinja environment are both
    created eagerly in `__init__` so the first request doesn't pay the cost.
    """

    def __init__(self) -> None:
        self._client = boto3.client("sesv2", region_name=settings.aws_region)

        self._html_env = Environment(
            loader=FileSystemLoader(str(_TEMPLATE_DIR)),
            autoescape=select_autoescape(enabled_extensions=("html", "htm", "xml")),
            keep_trailing_newline=True,
        )
        self._text_env = Environment(
            loader=FileSystemLoader(str(_TEMPLATE_DIR)),
            autoescape=False,
            keep_trailing_newline=True,
        )

    def _render_pair(self, template_base: str, context: dict[str, Any]) -> tuple[str, str]:
        """Render `<base>.html` and `<base>.txt` with the same context."""
        html = self._html_env.get_template(f"{template_base}.html").render(**context)
        text = self._text_env.get_template(f"{template_base}.txt").render(**context)
        return html, text

    # ── Low-level send ────────────────────────────────────────────────
    def send_raw(
        self,
        to: list[str],
        subject: str,
        html: str,
        text: str,
        reply_to: str | None = None,
    ) -> dict[str, str]:
        """Send one message to one or more recipients.

        Returns {"message_id", "status": "sent"} on success.
        Raises EmailDeliveryError on any SES ClientError.
        """
        if not to:
            raise EmailDeliveryError("No recipients supplied")
        if not settings.ses_from_email:
            raise EmailDeliveryError("SES_FROM_EMAIL is not configured")

        kwargs: dict[str, Any] = {
            "FromEmailAddress": settings.ses_from_email,
            "Destination": {"ToAddresses": list(to)},
            "Content": {
                "Simple": {
                    "Subject": {"Data": subject, "Charset": "UTF-8"},
                    "Body": {
                        "Html": {"Data": html, "Charset": "UTF-8"},
                        "Text": {"Data": text, "Charset": "UTF-8"},
                    },
                }
            },
        }
        if reply_to:
            kwargs["ReplyToAddresses"] = [reply_to]

        try:
            response = self._client.send_email(**kwargs)
        except ClientError as exc:
            log.error(
                "ses send_email failed",
                extra={"to": to, "subject": subject, "err": str(exc)},
            )
            raise EmailDeliveryError(f"SES rejected the message: {exc}") from exc

        message_id = response.get("MessageId", "")
        log.info(
            "ses send_email ok",
            extra={"message_id": message_id, "to": to, "subject": subject},
        )
        return {"message_id": message_id, "status": "sent"}

    # ── High-level, template-backed senders ───────────────────────────
    def send_submission_confirmation(
        self,
        to: str,
        applicant_name: str,
        application_id: str,
    ) -> dict[str, str]:
        html, text = self._render_pair(
            "submission_confirmation",
            {"applicant_name": applicant_name, "application_id": application_id},
        )
        return self.send_raw(
            to=[to],
            subject="ARTPARK EIR — Your application has been received",
            html=html,
            text=text,
        )

    def send_support_ticket(
        self,
        ticket: dict[str, Any],
        recipients: list[str],
    ) -> dict[str, str]:
        html, text = self._render_pair("support_ticket", {"ticket": ticket})
        subject = (
            f"[ARTPARK Support] {ticket.get('category', 'other')}: "
            f"{ticket.get('subject', '(no subject)')}"
        )
        return self.send_raw(
            to=recipients,
            subject=subject,
            html=html,
            text=text,
            reply_to=ticket.get("email"),
        )

    def send_ticket_acknowledgement(
        self,
        to: str,
        ticket_id: str,
        subject_summary: str,
    ) -> dict[str, str]:
        ticket_id_short = str(ticket_id)[:8]
        html, text = self._render_pair(
            "ticket_ack",
            {
                "ticket_id": ticket_id,
                "ticket_id_short": ticket_id_short,
                "subject_summary": subject_summary,
            },
        )
        return self.send_raw(
            to=[to],
            subject=f"ARTPARK Support — We've received your ticket #{ticket_id_short}",
            html=html,
            text=text,
        )


@lru_cache(maxsize=1)
def get_email_service() -> EmailService:
    """Memoised accessor. Tests can `get_email_service.cache_clear()` to reset."""
    return EmailService()
