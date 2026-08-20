"""Flag support tickets that are really privilege requests.

On 2026-08-19 an actor probed every admin route, was denied everywhere, and
then simply asked: a support ticket requesting "Leadership, Reviewer and Jury
platform access". Once the technical path is shut, asking a human is the next
cheapest attack, and that ticket looked entirely ordinary in the queue.

This is a heuristic, and deliberately a conservative one: it needs BOTH a
privileged-role word AND an access-seeking verb near it. A ticket that merely
mentions "my reviewer was helpful" must not trip it — false alarms train staff
to ignore the flag, which is worse than no flag.
"""

from __future__ import annotations

import re

# Roles worth escalating for. 'applicant' and 'founder' are deliberately absent:
# every user is entitled to those, so asking about them is not suspicious.
_PRIVILEGED = (
    "admin", "administrator", "leadership", "reviewer", "jury", "juror",
    "mentor", "moderator", "superuser", "staff",
)

# Words that turn a mention into a request.
_SEEKING = (
    "access", "grant", "give me", "permission", "permissions", "role", "roles",
    "privilege", "privileges", "enable", "add me", "make me", "assign me",
    "elevate", "upgrade my", "credentials", "dashboard access", "onboard me",
)

_PRIV_RE = re.compile("|".join(re.escape(w) for w in _PRIVILEGED), re.I)
_SEEK_RE = re.compile("|".join(re.escape(w) for w in _SEEKING), re.I)

# How close the two ideas must appear (characters). Keeps "my reviewer was
# helpful … how do I access my application?" from matching across paragraphs.
_PROXIMITY = 120


def looks_like_access_request(subject: str | None, body: str | None) -> bool:
    """True when the ticket reads as a request for privileged access."""
    text = f"{subject or ''}\n{body or ''}".strip()
    if not text:
        return False

    priv_spans = [m.span() for m in _PRIV_RE.finditer(text)]
    if not priv_spans:
        return False
    seek_spans = [m.span() for m in _SEEK_RE.finditer(text)]
    if not seek_spans:
        return False

    # Require the role word and the asking word to sit near each other.
    for ps, pe in priv_spans:
        for ss, se in seek_spans:
            if max(ps, ss) - min(pe, se) <= _PROXIMITY:
                return True
    return False
