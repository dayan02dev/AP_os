"""Disposable-email guard for the signup path.

Added after 2026-08-19, when an actor signed up from a throwaway `hutdot.com`
inbox and spent a session fuzzing 246 routes and attempting to grant himself an
admin role. Every privileged request was denied — RBAC and the OTP rate limits
both held — but the throwaway inbox made the attempt free and repeatable.

SCOPE, honestly stated: a blocklist raises the cost of the cheapest attack. It
does NOT stop a determined actor — these services rotate domains constantly and
new ones appear weekly. Detection (the CloudWatch authz-failure alarms) is the
real control; this is the cheap complement to it.

Kept as a small curated set rather than a vendored 100k-domain list: the big
lists are stale within weeks, cost Lambda cold-start memory, and carry a real
risk of blocking a legitimate applicant on an obscure-but-real provider. We
would rather under-block than turn away a real founder.
"""

from __future__ import annotations

# Bare, lowercased registrable domains. Matching covers subdomains too
# (see _matches), because several of these hand out per-user subdomains.
DISPOSABLE_DOMAINS: frozenset[str] = frozenset({
    # Used in the 2026-08-19 probing session.
    "hutdot.com",
    # Long-lived, high-volume throwaway providers.
    "mailinator.com",
    "guerrillamail.com",
    "sharklasers.com",
    "grr.la",
    "10minutemail.com",
    "10minutemail.net",
    "yopmail.com",
    "yopmail.fr",
    "temp-mail.org",
    "tempmail.com",
    "tempmailo.com",
    "tempr.email",
    "throwawaymail.com",
    "trashmail.com",
    "trashmail.de",
    "dispostable.com",
    "maildrop.cc",
    "mailnesia.com",
    "getnada.com",
    "nada.email",
    "mohmal.com",
    "fakeinbox.com",
    "spamgourmet.com",
    "mintemail.com",
    "discard.email",
    "mailcatch.com",
    "emailondeck.com",
    "moakt.com",
    "mailpoof.com",
    "burnermail.io",
    "guerrillamailblock.com",
    "spam4.me",
    "byom.de",
    "einrot.com",
    "fleckens.hu",
    "harakirimail.com",
    "inboxbear.com",
    "mytemp.email",
    "tmpmail.org",
    "tmails.net",
    "vomoto.com",
    "wegwerfmail.de",
})


def _domain_of(email: str) -> str:
    """Bare lowercased domain, or '' when the input is not address-shaped."""
    if not isinstance(email, str):
        return ""
    cleaned = email.strip().lower()
    if cleaned.count("@") != 1:
        return ""
    _local, _, domain = cleaned.partition("@")
    domain = domain.strip()
    # A domain must have a label either side of a dot to be usable.
    if "." not in domain or domain.startswith(".") or domain.endswith("."):
        return ""
    return domain


def _matches(domain: str, blocked: str) -> bool:
    """Exact match, or a subdomain of the blocked domain.

    The dot in the suffix test is what stops 'notmailinator.com' matching
    'mailinator.com' — a plain endswith would block a legitimate domain.
    """
    return domain == blocked or domain.endswith("." + blocked)


def is_disposable_email(email: str | None) -> bool:
    """True when `email` belongs to a known throwaway provider.

    Malformed input returns False on purpose: rejecting it here would surface a
    typo as "disposable address", which is a confusing and wrong message. Format
    validation belongs to the request model.
    """
    domain = _domain_of(email or "")
    if not domain:
        return False
    return any(_matches(domain, b) for b in DISPOSABLE_DOMAINS)
