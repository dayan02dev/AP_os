"""Transactional email service — Resend HTTP API.

Wraps Resend's ``POST https://api.resend.com/emails`` behind three
high-level methods that take a Jinja template base + context:

  send_submission_confirmation(to, applicant_name, application_id)
  send_support_ticket(ticket, recipients)
  send_ticket_acknowledgement(to, ticket_id, subject_summary)

Each method renders a paired Jinja2 template (`*.html` + `*.txt`) from
``backend/app/templates/email/`` and hands both parts to ``send_raw()``.

``EmailDeliveryError`` is raised on any non-2xx response so callers can
decide whether to swallow or propagate — the support-ticket route swallows
(so the ticket row is never lost) and marks ``email_delivery_status='failed'``.

─────────────────────────────────────────────────────────────────
 Why Resend instead of SES
─────────────────────────────────────────────────────────────────
We originally wired AWS SES (see git history pre-Phase-9E). SES sandbox
mode requires every *recipient* to be pre-verified — fine for tests,
fatal at launch because real applicants are arbitrary Gmail / college
addresses. Resend accepts any recipient as long as the *sender* domain is
verified, and ``artpark.info`` is already DKIM-verified in Resend for
Supabase OTPs, so the infrastructure piggy-backs on existing setup.

Operational notes:
  - Set ``RESEND_API_KEY`` in the environment (same key used by Supabase
    SMTP for OTPs). ``SES_FROM_EMAIL`` (or alias ``EMAIL_FROM``) controls
    the ``From:`` header — the chosen address must be on a domain
    verified in Resend.
  - The ``boto3`` dependency is retained in ``requirements.txt`` for
    future AWS work (Sentry spans, SES bounce-handling, S3) but this
    service does **not** import it.
"""

from __future__ import annotations

import logging
import time
from functools import lru_cache
from pathlib import Path
from typing import Any

import httpx
from jinja2 import Environment, FileSystemLoader, select_autoescape

from ..config import settings

log = logging.getLogger(__name__)

_TEMPLATE_DIR = Path(__file__).resolve().parents[1] / "templates" / "email"

# Resend's REST endpoint. Held as a module constant (not injected) because
# Resend doesn't offer multiple regions; if they ever do, flip this.
_RESEND_URL = "https://api.resend.com/emails"

# HTTP timeout in seconds. Resend is fast — anything over ~10s is a sign
# the connection is wedged, not a slow mail server. Fail fast.
_HTTP_TIMEOUT_S = 10.0


class EmailDeliveryError(Exception):
    """Raised when Resend rejects a send or the HTTP call fails."""


class EmailService:
    """Thin wrapper around Resend's HTTP API + Jinja2.

    One instance per process. Use ``get_email_service()`` to get the
    memoised singleton. The ``httpx.Client`` and Jinja environment are
    both created eagerly in ``__init__`` so the first request doesn't pay
    the cost.
    """

    def __init__(self) -> None:
        # httpx.Client uses a keep-alive connection pool; reused across
        # calls it amortises TLS handshake on warm Lambda invocations.
        self._http = httpx.Client(timeout=_HTTP_TIMEOUT_S)

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
        """Render ``<base>.html`` and ``<base>.txt`` with the same context."""
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
        """Send one message via Resend to one or more recipients.

        Returns ``{"message_id", "status": "sent"}`` on success.
        Raises ``EmailDeliveryError`` on any HTTP failure or non-2xx.
        """
        if not to:
            raise EmailDeliveryError("No recipients supplied")
        if not settings.ses_from_email:
            raise EmailDeliveryError("SES_FROM_EMAIL is not configured")
        if not settings.resend_api_key:
            raise EmailDeliveryError("RESEND_API_KEY is not configured")

        payload: dict[str, Any] = {
            "from": settings.ses_from_email,
            "to": list(to),
            "subject": subject,
            "html": html,
            "text": text,
        }
        if reply_to:
            # Resend accepts string OR list here; lists pass cleanly.
            payload["reply_to"] = [reply_to]

        headers = {
            "Authorization": f"Bearer {settings.resend_api_key}",
            "Content-Type": "application/json",
        }

        try:
            response = self._http.post(_RESEND_URL, json=payload, headers=headers)
        except httpx.RequestError as exc:
            # Network / DNS / timeout — the send never landed at Resend.
            log.error(
                "resend request failed",
                extra={"to": to, "subject": subject, "err": str(exc)},
            )
            raise EmailDeliveryError(f"Resend request failed: {exc}") from exc

        # Resend caps free-tier sends at 2/sec. Support tickets fan out to
        # staff + submitter back-to-back, which trips the limit. One retry
        # with a small sleep clears the bucket without surfacing as ERROR.
        if response.status_code == 429:
            time.sleep(0.7)
            try:
                response = self._http.post(_RESEND_URL, json=payload, headers=headers)
            except httpx.RequestError as exc:
                raise EmailDeliveryError(f"Resend request failed: {exc}") from exc

        if response.status_code >= 400:
            # Pull the structured error from Resend's JSON body if present
            # so we log a useful message, not just "HTTP 422".
            try:
                body = response.json()
                err_msg = body.get("message") or body.get("name") or response.text
            except Exception:
                err_msg = response.text
            log.error(
                "resend rejected send",
                extra={
                    "to": to,
                    "subject": subject,
                    "status_code": response.status_code,
                    "err": err_msg,
                },
            )
            raise EmailDeliveryError(
                f"Resend rejected the message ({response.status_code}): {err_msg}"
            )

        try:
            data = response.json()
        except Exception as exc:
            raise EmailDeliveryError(f"Resend returned non-JSON on 2xx: {exc}") from exc
        message_id = data.get("id", "")
        log.info(
            "resend send ok",
            extra={"message_id": message_id, "to": to, "subject": subject},
        )
        return {"message_id": message_id, "status": "sent"}

    # ── High-level, template-backed senders ───────────────────────────
    def send_submission_confirmation(
        self,
        to: str,
        applicant_name: str,
        application_id: str,
        track: str = "tir",
    ) -> dict[str, str]:
        track_norm = (track or "tir").lower()
        program_name = "ARTPARK SIP" if track_norm == "sip" else "ARTPARK TIR"
        html, text = self._render_pair(
            "submission_confirmation",
            {
                "applicant_name": applicant_name,
                "application_id": application_id,
                "track": track_norm,
                "program_name": program_name,
            },
        )
        return self.send_raw(
            to=[to],
            subject=f"{program_name} — Your application has been received",
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

    # ── Phase 1 admin platform senders (Session 8 / Task 26) ──────────
    #
    # Three new triggers wired from leadership + admin write endpoints:
    #
    #   send_role_granted        admin_users.grant_role
    #   send_reviewer_assigned   leadership_actions.assign_reviewers
    #   send_status_change       leadership_actions.change_status
    #                            (only for shortlisted/rejected/waitlisted)
    #
    # All callers wrap these in try/except so an email-infra failure can't
    # roll back the primary mutation (per spec §8 "best-effort" rule).

    def send_role_granted(
        self,
        *,
        to: str,
        user_name: str,
        role: str,
        granted_by: str,
        signin_url: str,
    ) -> dict[str, str]:
        """Notify a user that an admin granted them a role.

        ``granted_by`` is a display string (email or "admin"). The template
        renders it inside a code block so an empty value falls back gracefully.
        """
        role_label, role_blurb = _role_copy(role)
        html, text = self._render_pair(
            "role_granted",
            {
                "user_name": user_name or to,
                "role": role,
                "role_label": role_label,
                "role_blurb": role_blurb,
                "granted_by": granted_by or "admin",
                "signin_url": signin_url,
            },
        )
        return self.send_raw(
            to=[to],
            subject=f"You've been granted {role_label} access on ARTPARK OS",
            html=html,
            text=text,
        )

    def send_reviewer_assigned(
        self,
        *,
        to: str,
        reviewer_name: str,
        applicant_name: str,
        application_id: str,
        track: str,
        inbox_url: str,
    ) -> dict[str, str]:
        """Notify a reviewer that an application has been assigned to them."""
        track_label = _track_label(track)
        application_id_short = str(application_id)[:8]
        html, text = self._render_pair(
            "reviewer_assigned",
            {
                "reviewer_name": reviewer_name or to,
                "applicant_name": applicant_name or "an applicant",
                "application_id": application_id,
                "application_id_short": application_id_short,
                "track": track,
                "track_label": track_label,
                "inbox_url": inbox_url,
            },
        )
        return self.send_raw(
            to=[to],
            subject=f"New {track_label} application to review — {applicant_name or application_id_short}",
            html=html,
            text=text,
        )

    def send_status_change(
        self,
        *,
        to: str,
        applicant_name: str,
        application_id: str,
        track: str,
        to_status: str,
        reason: str | None = None,
    ) -> dict[str, str]:
        """Notify an applicant that their status has moved to a terminal-ish
        Gate 1 outcome (shortlisted / waitlisted / rejected). The template
        also has a generic branch for any other status the caller chooses to
        send, but Phase 1 only fires this for the three outcomes per spec §8."""
        status_label, headline, subject_line = _status_copy(to_status, applicant_name)
        track_label = _track_label(track)
        application_id_short = str(application_id)[:8]
        html, text = self._render_pair(
            "status_change",
            {
                "applicant_name": applicant_name or "there",
                "application_id": application_id,
                "application_id_short": application_id_short,
                "track": track,
                "track_label": track_label,
                "to_status": to_status,
                "status_label": status_label,
                "headline": headline,
                "subject_line": subject_line,
                "reason": reason,
            },
        )
        return self.send_raw(
            to=[to],
            subject=subject_line,
            html=html,
            text=text,
        )


# ── Copy helpers (module-level so tests can import + diff against them) ─


_ROLE_COPY: dict[str, tuple[str, str]] = {
    "admin": (
        "Admin",
        "Manage users, grant or revoke roles, reset passwords, and handle support tickets.",
    ),
    "leadership": (
        "Leadership",
        "See every application across both tracks, assign reviewers, and make Gate 1 decisions on shortlist / waitlist / reject.",
    ),
    "reviewer": (
        "Reviewer",
        "Score applications assigned to you across five rubric categories. The full scoring screen ships in Phase 1.5.",
    ),
    "mentor": (
        "Mentor",
        "Guide accepted founders through their residency milestones. The mentor surface arrives in Phase 2.",
    ),
    "founder": (
        "Founder",
        "Access your post-acceptance founder portal (milestones, evidence uploads). The founder surface arrives in Phase 2.",
    ),
    "applicant": (
        "Applicant",
        "Continue your application via the apply portal.",
    ),
}


def _role_copy(role: str) -> tuple[str, str]:
    """(display_label, body_blurb) for the role-granted email. Falls back to
    a generic line so an unrecognised role still produces a sensible email."""
    return _ROLE_COPY.get(
        role,
        (role.title(), f"You've been granted the '{role}' role on the platform."),
    )


def _track_label(track: str | None) -> str:
    """Map 'tir'/'sip' to the human label used in subject lines + body."""
    if not track:
        return ""
    return {"tir": "TIR", "sip": "SIP"}.get(track.lower(), track.upper())


def frontend_url(path: str) -> str:
    """Compose ``<primary frontend origin> + path`` for email-body links.

    `settings.frontend_origins` is a comma-parsed list — the first entry is
    the user-facing origin (apply.artpark.info in prod, the Vercel preview
    URL in staging). Falls back to localhost so dev runs don't 500 when no
    env is configured.

    Lives here because every caller is an email-body helper; if anything
    else needs frontend URLs later, this can move to ``app/utils/urls.py``.
    """
    base = (settings.frontend_origins or ["http://localhost:5173"])[0].rstrip("/")
    return f"{base}{path if path.startswith('/') else '/' + path}"


def _status_copy(to_status: str, applicant_name: str) -> tuple[str, str, str]:
    """Returns (status_label, headline, subject_line) for the status-change
    email. Kept in one place so subject + body stay aligned across edits."""
    name = applicant_name or "applicant"
    if to_status == "shortlisted":
        return (
            "Shortlisted",
            f"You've been shortlisted, {name}.",
            "Great news — you've been shortlisted",
        )
    if to_status == "waitlisted":
        return (
            "Waitlisted",
            f"An update on your application, {name}.",
            "An update on your ARTPARK application",
        )
    if to_status == "rejected":
        return (
            "Not selected",
            f"An update on your application, {name}.",
            "An update on your ARTPARK application",
        )
    # Generic fallback — keeps the worker safe if a future state lands here.
    return (
        to_status.replace("_", " ").title(),
        f"An update on your application, {name}.",
        "An update on your ARTPARK application",
    )


@lru_cache(maxsize=1)
def get_email_service() -> EmailService:
    """Memoised accessor. Tests can ``get_email_service.cache_clear()`` to reset."""
    return EmailService()
