"""Disposable-email guard used at signup.

A blocklist raises the cost of throwaway accounts; it cannot eliminate them
(these services rotate domains constantly). The alarms are the real defence —
this just stops the cheapest version of the attack.
"""
from __future__ import annotations

import pytest

from app.services.email_guard import is_disposable_email, DISPOSABLE_DOMAINS


@pytest.mark.parametrize("email", [
    "wiwohow412@hutdot.com",          # the domain used in the 2026-08-19 probing
    "someone@mailinator.com",
    "x@guerrillamail.com",
    "y@10minutemail.com",
    "z@yopmail.com",
    "WIWOHOW412@HUTDOT.COM",          # case-insensitive
    "  spaced@hutdot.com  ",          # trimmed
])
def test_known_disposable_domains_are_rejected(email):
    assert is_disposable_email(email) is True


@pytest.mark.parametrize("email", [
    "sumitlonkar@iisc.ac.in",
    "harikumar1897@gmail.com",
    "udayan.pawar@artpark.in",
    "someone@outlook.com",
    "founder@a-real-startup.io",
])
def test_real_addresses_are_allowed(email):
    assert is_disposable_email(email) is False


def test_subdomains_of_a_blocked_domain_are_also_rejected():
    """Temp-mail services hand out per-user subdomains; matching only the exact
    domain would let those straight through."""
    assert is_disposable_email("x@inbox.mailinator.com") is True


def test_a_domain_merely_ending_in_a_blocked_string_is_allowed():
    """'notmailinator.com' must NOT match 'mailinator.com' — a naive endswith
    check would block a legitimate domain."""
    assert is_disposable_email("x@notmailinator.com") is False


@pytest.mark.parametrize("junk", ["", "   ", "not-an-email", "@nodomain", "no-at-sign.com", None])
def test_malformed_input_is_never_treated_as_disposable(junk):
    """Malformed input is the validator's problem, not ours. Returning True here
    would turn a typo into a signup block with a misleading reason."""
    assert is_disposable_email(junk) is False


def test_the_blocklist_is_lowercase_and_bare_domains():
    """A stray uppercase entry or an '@' would silently never match."""
    for d in DISPOSABLE_DOMAINS:
        assert d == d.lower().strip(), f"not normalised: {d!r}"
        assert "@" not in d, f"blocklist holds domains, not addresses: {d!r}"
        assert "." in d, f"not a domain: {d!r}"
