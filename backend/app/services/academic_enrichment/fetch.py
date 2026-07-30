"""Guarded fetch of one academic profile page + HTML → text reduction.

Every request here originates from a client-supplied URL, so the guard matters
more than the fetching does:

  1. The URL must be an EXACT member of the roster allow-list
     (app/data/academic_profile_urls.json). A host allow-list would not do —
     the roster spans 93 hostnames and ~15% are personal sites, so host rules
     either exclude professors or leave the door open.
  2. Redirects are NOT followed automatically. A compromised or careless
     third-party site could 302 us at 169.254.169.254 and hand a Lambda role
     credential to whoever asked. One manual hop is allowed, and only onto a
     host that the roster already contains.

     Host-level (not exact-URL) matching is required for the hop because real
     redirects here are canonicalisations: csa.iisc.ac.in → www.csa.iisc.ac.in
     for the same path, and http://x.weebly.com → https://x.weebly.com/. The
     SSRF pivot is still blocked — 169.254.169.254 is on no roster host.
  3. IP-literal hosts and embedded credentials are refused outright.
  4. Hard byte cap and timeout, so a huge or slow page can't eat the request.
"""
from __future__ import annotations

import ipaddress
import json
import logging
import re
from functools import lru_cache
from pathlib import Path
from urllib.parse import urljoin, urlsplit

import httpx

log = logging.getLogger(__name__)

_ALLOWLIST_PATH = Path(__file__).resolve().parents[2] / "data" / "academic_profile_urls.json"
_TIMEOUT = 8.0
_MAX_BYTES = 2 * 1024 * 1024      # 2 MiB of HTML is already absurd for a bio page
_MAX_TEXT_CHARS = 14_000          # what we hand the model
_UA = "ARTPARK-OS/1.0 (+https://apply.artpark.info) academic-roster-enrichment"


class FetchError(RuntimeError):
    """Raised with a machine-readable ``code`` for the router to surface."""

    def __init__(self, code: str, message: str, http_status: int | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status


@lru_cache(maxsize=1)
def allowed_urls() -> frozenset[str]:
    try:
        return frozenset(json.loads(_ALLOWLIST_PATH.read_text()))
    except Exception as exc:
        log.error("academic allow-list unreadable", extra={"err": str(exc)})
        return frozenset()


def is_allowed(url: str) -> bool:
    return (url or "").strip() in allowed_urls()


@lru_cache(maxsize=1)
def allowed_hosts() -> frozenset[str]:
    """Hostnames present in the roster, each with and without a ``www.`` prefix
    so a canonicalising redirect between the two is recognised."""
    hosts: set[str] = set()
    for u in allowed_urls():
        h = (urlsplit(u).hostname or "").lower()
        if not h:
            continue
        hosts.add(h)
        hosts.add(h[4:] if h.startswith("www.") else f"www.{h}")
    return frozenset(hosts)


def _is_ip_literal(host: str) -> bool:
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return False


def redirect_ok(target: str) -> bool:
    """May we follow this redirect target?

    http(s) only, no embedded credentials, no bare IP (which is how the metadata
    service would be reached), and the host must already appear in the roster.
    """
    try:
        parts = urlsplit(target)
    except ValueError:
        return False
    if parts.scheme not in ("http", "https"):
        return False
    if "@" in (parts.netloc or ""):
        return False
    host = (parts.hostname or "").lower()
    if not host or _is_ip_literal(host):
        return False
    return host in allowed_hosts()


def _get(client: httpx.Client, url: str) -> httpx.Response:
    return client.get(url, headers={"User-Agent": _UA, "Accept": "text/html,*/*"})


def fetch_html(url: str) -> tuple[str, int]:
    """Return ``(html, http_status)`` for an allow-listed URL.

    Raises FetchError for anything else — the caller records it as a failed
    enrichment rather than 500-ing.
    """
    url = (url or "").strip()
    if not is_allowed(url):
        raise FetchError("url_not_in_roster",
                         "That profile URL is not part of the academic roster.")

    try:
        with httpx.Client(timeout=_TIMEOUT, follow_redirects=False) as client:
            resp = _get(client, url)
            # One manual hop, onto a roster host only. urljoin handles the
            # relative and scheme-relative Location values sites actually send.
            if resp.status_code in (301, 302, 303, 307, 308):
                target = urljoin(url, (resp.headers.get("location") or "").strip())
                if not redirect_ok(target):
                    raise FetchError(
                        "redirect_blocked",
                        "That page redirects somewhere outside the roster; not followed.",
                        resp.status_code)
                resp = _get(client, target)
                if resp.status_code in (301, 302, 303, 307, 308):
                    raise FetchError("too_many_redirects",
                                     "That page redirects more than once; not followed.",
                                     resp.status_code)

            if resp.status_code >= 400:
                raise FetchError("page_unavailable",
                                 f"The profile page returned HTTP {resp.status_code}.",
                                 resp.status_code)
            raw = resp.content[:_MAX_BYTES]
            return raw.decode(resp.encoding or "utf-8", errors="replace"), resp.status_code
    except FetchError:
        raise
    except httpx.TimeoutException as exc:
        raise FetchError("page_timeout", "The profile page took too long to respond.") from exc
    except Exception as exc:
        log.warning("academic fetch failed", extra={"url": url, "err": str(exc)})
        raise FetchError("fetch_failed", "Couldn't reach the profile page.") from exc


_DROP_BLOCKS = re.compile(
    r"<(script|style|noscript|svg|head)\b[^>]*>.*?</\1>", re.I | re.S)
# Comments must go before tag-stripping: `<[^>]+>` eats only up to the first
# `>`, which on a commented-out block leaves a trail of bare `-->` in the text
# (several departmental pages are full of commented-out markup).
_COMMENT = re.compile(r"<!--.*?-->", re.S)
_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"[ \t\r\f\v]+")
_BLANKS = re.compile(r"\n{3,}")


def html_to_text(html: str) -> str:
    """Crude but dependency-free HTML → text. Good enough to feed an LLM:
    we want the prose and link text, not a faithful DOM."""
    s = _COMMENT.sub(" ", _DROP_BLOCKS.sub(" ", html or ""))
    # Keep mailto/href targets — emails and lab links are often only in attributes.
    s = re.sub(r'<a\b[^>]*href="(mailto:[^"]+)"[^>]*>', r" \1 ", s, flags=re.I)
    s = re.sub(r'<a\b[^>]*href="(https?://[^"]+)"[^>]*>', r" \1 ", s, flags=re.I)
    s = re.sub(r"<(br|/p|/div|/li|/tr|/h[1-6])\b[^>]*>", "\n", s, flags=re.I)
    s = _TAG.sub(" ", s)
    s = (s.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<")
          .replace("&gt;", ">").replace("&quot;", '"').replace("&#39;", "'"))
    s = _WS.sub(" ", s)
    s = "\n".join(line.strip() for line in s.split("\n"))
    s = _BLANKS.sub("\n\n", s).strip()
    return s[:_MAX_TEXT_CHARS]
