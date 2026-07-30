"""fetch page → LLM-extract → normalise. Persistence lives in the router.

Runs synchronously inside the API Lambda (29s ceiling), so the budget is fetch
8s + model 15s. That is why this uses plain ``gemini-2.5-flash`` and not the
``:online`` web-search variant the jury enrichment uses — we already hold the
exact page URL, so there is nothing to search for, and the plain model is
cheaper, faster and has no dependency on OpenRouter's search add-on.
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

import httpx

from .fetch import FetchError, fetch_html, html_to_text
from .prompts import EXTRACT_SYSTEM

log = logging.getLogger(__name__)

MODEL = "google/gemini-2.5-flash"
_URL = "https://openrouter.ai/api/v1/chat/completions"
_LLM_TIMEOUT = 15.0
_MAX_PUBS = 8
_MAX_ITEMS = 12
_MAX_STR = 400

_EMAIL_RE = re.compile(r"[^@\s]+@[^@\s]+\.[A-Za-z]{2,}")


def _post(messages: list[dict]) -> str:
    key = os.getenv("OPENROUTER_API_KEY", "")
    if not key:
        raise FetchError("llm_unconfigured", "AI extraction is not configured.")
    resp = httpx.Client(timeout=_LLM_TIMEOUT).post(
        _URL,
        json={"model": MODEL, "messages": messages, "temperature": 0.1,
              "response_format": {"type": "json_object"}},
        headers={"Authorization": f"Bearer {key}"},
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def _parse_json(raw: str) -> dict:
    cleaned = (raw or "").strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:]
    try:
        out = json.loads(cleaned)
    except json.JSONDecodeError:
        try:
            from json_repair import repair_json
            out = json.loads(repair_json(cleaned))
        except Exception:
            return {}
    return out if isinstance(out, dict) else {}


def _clean_str(v: Any, limit: int = _MAX_STR) -> str | None:
    if not isinstance(v, str):
        return None
    s = " ".join(v.split()).strip()
    return s[:limit] or None


def _clean_list(v: Any, limit: int = _MAX_ITEMS) -> list[str]:
    if not isinstance(v, list):
        return []
    out: list[str] = []
    for item in v:
        s = _clean_str(item)
        if s and s not in out:
            out.append(s)
        if len(out) >= limit:
            break
    return out


def _clean_emails(v: Any) -> list[str]:
    out: list[str] = []
    for raw in _clean_list(v):
        s = raw.replace("mailto:", "").strip().rstrip(".,;")
        # The model is asked to de-obfuscate, but belt-and-braces.
        s = (s.replace(" [at] ", "@").replace(" (at) ", "@")
              .replace(" [dot] ", ".").replace(" (dot) ", "."))
        s = s.replace(" ", "")
        if _EMAIL_RE.fullmatch(s) and s.lower() not in {o.lower() for o in out}:
            out.append(s)
    return out


def _clean_links(v: Any) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    if not isinstance(v, list):
        return out
    for item in v:
        if not isinstance(item, dict):
            continue
        url = _clean_str(item.get("url"))
        if not url or not url.lower().startswith(("http://", "https://")) or url in seen:
            continue
        seen.add(url)
        out.append({"label": _clean_str(item.get("label"), 80) or url, "url": url})
        if len(out) >= _MAX_ITEMS:
            break
    return out


def _clean_pubs(v: Any) -> list[dict]:
    out: list[dict] = []
    if not isinstance(v, list):
        return out
    for item in v:
        if not isinstance(item, dict):
            title = _clean_str(item)
            if title:
                out.append({"title": title, "venue": None, "year": None})
        else:
            title = _clean_str(item.get("title"))
            if not title:
                continue
            year = _clean_str(item.get("year"), 12)
            out.append({
                "title": title,
                "venue": _clean_str(item.get("venue"), 200),
                # Only keep something that actually looks like a year.
                "year": year if year and re.fullmatch(r"(19|20)\d{2}", year) else None,
            })
        if len(out) >= _MAX_PUBS:
            break
    return out


def normalise(parsed: dict) -> dict:
    """Coerce the model's object into the exact shape the UI renders.

    Everything is bounded and type-checked here so a malformed model response
    degrades to empty fields instead of rendering junk (or crashing the page).
    """
    lab_raw = parsed.get("lab")
    lab_name = lab_url = None
    if isinstance(lab_raw, dict):
        lab_name = _clean_str(lab_raw.get("name"), 200)
        lab_url = _clean_str(lab_raw.get("url"))
        if lab_url and not lab_url.lower().startswith(("http://", "https://")):
            lab_url = None
    elif isinstance(lab_raw, str):
        lab_name = _clean_str(lab_raw, 200)

    return {
        "emails": _clean_emails(parsed.get("emails")),
        "phone": _clean_str(parsed.get("phone"), 60),
        "position": _clean_str(parsed.get("position"), 200),
        "lab": {"name": lab_name, "url": lab_url},
        "education": _clean_list(parsed.get("education")),
        "research_interests": _clean_list(parsed.get("research_interests")),
        "publications": _clean_pubs(parsed.get("publications")),
        "awards": _clean_list(parsed.get("awards")),
        "links": _clean_links(parsed.get("links")),
        "summary": _clean_str(parsed.get("summary"), 1200),
    }


def is_empty(extracted: dict) -> bool:
    """True when nothing usable came back — the UI says so rather than showing
    an all-empty card that looks broken."""
    if not extracted:
        return True
    return not any([
        extracted.get("emails"), extracted.get("phone"), extracted.get("position"),
        (extracted.get("lab") or {}).get("name"), extracted.get("education"),
        extracted.get("research_interests"), extracted.get("publications"),
        extracted.get("awards"), extracted.get("links"), extracted.get("summary"),
    ])


def enrich(url: str) -> dict:
    """Fetch + extract one profile page.

    Returns ``{extracted, http_status, content_chars, model}``.
    Raises FetchError (with .code) on any failure the UI should explain.
    """
    html, http_status = fetch_html(url)
    text = html_to_text(html)
    if len(text) < 80:
        raise FetchError("page_too_thin",
                         "That page has almost no readable text to extract from.",
                         http_status)
    try:
        raw = _post([
            {"role": "system", "content": EXTRACT_SYSTEM},
            {"role": "user", "content": f"Profile page: {url}\n\n{text}"},
        ])
    except FetchError:
        raise
    except httpx.TimeoutException as exc:
        raise FetchError("llm_timeout", "AI extraction timed out. Try again.") from exc
    except Exception as exc:
        log.warning("academic extract failed", extra={"url": url, "err": str(exc)})
        raise FetchError("llm_failed", "AI extraction failed. Try again.") from exc

    return {
        "extracted": normalise(_parse_json(raw)),
        "http_status": http_status,
        "content_chars": len(text),
        "model": MODEL,
    }
