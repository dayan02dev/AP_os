"""Support tickets that ask for privileged roles must be flagged.

On 2026-08-19 an actor probed every admin route, was denied everywhere, and
then simply *asked* — a support ticket requesting "Leadership, Reviewer and
Jury platform access". Social engineering is the path of least resistance once
the technical one is shut, so those tickets should announce themselves rather
than sit in the queue looking ordinary.
"""
from __future__ import annotations

import pytest

from app.services.access_request_flag import looks_like_access_request


@pytest.mark.parametrize("subject,body", [
    # The real ticket from the incident.
    ("Request: Leadership, Reviewer and Jury platform access (TIR.2026)",
     "I need access to the Leadership platform, Reviewer platform, and Jury panel. "
     "Please grant the relevant roles to this account."),
    ("access request", "please grant me admin role"),
    ("Role", "Could you make me a reviewer on the platform?"),
    ("hello", "I should have leadership dashboard permissions"),
    ("", "grant admin access please"),
])
def test_access_requests_are_flagged(subject, body):
    assert looks_like_access_request(subject, body) is True


@pytest.mark.parametrize("subject,body", [
    ("Can't upload my resume", "The upload button spins forever on a 4MB PDF."),
    ("Deadline question", "Is the TIR deadline still 24 May?"),
    ("Login issue", "I never received my OTP email, can you resend?"),
    ("Thank you", "Thanks for reviewing my application."),
    # Mentions a role but is plainly not asking for access.
    ("Feedback", "My reviewer was very helpful, please pass on my thanks."),
])
def test_ordinary_tickets_are_not_flagged(subject, body):
    assert looks_like_access_request(subject, body) is False


def test_none_and_empty_input_is_safe():
    assert looks_like_access_request(None, None) is False
    assert looks_like_access_request("", "") is False
