"""Identify wired/wireless communication ventures for domain re-classification.

Two testable units: `shortlist` (pure keyword scan) and `confirm_is_comms`
(one gemini-flash call). `identify` composes them; the LLM call is injectable so
tests never hit the network.
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Callable

import httpx

log = logging.getLogger("app.comms_classifier")

CATEGORY_ID = "comms"

# Comms-specific terms. Deliberately excludes bare "communication"/"communicate"
# (too noisy); precision is delegated to the LLM confirm.
_PHRASES = [
    "fiber optic", "optical communication", "optical transceiver",
    "satellite communication", "satcom", "iot connectivity",
    "wireless network", "communication network", "networking hardware",
    "telecom infrastructure", "wi-fi", "software defined radio",
]
_WORDS = [
    "wireless", "rf", "5g", "6g", "wifi", "bluetooth", "zigbee", "lora",
    "lorawan", "spectrum", "antenna", "mmwave", "sdr", "transceiver",
    "cellular", "modem", "baseband", "ethernet", "docsis", "telecom",
    "telecommunications", "interconnect",
]
KEYWORDS = _WORDS + _PHRASES
_WORD_RE = {w: re.compile(r"\b" + re.escape(w) + r"\b", re.I) for w in _WORDS}

_PROMPT = (
    "You classify deep-tech startups by their CORE product. Answer is_comms=true "
    "ONLY if the venture's PRIMARY product IS communication technology or "
    "infrastructure that it builds or sells — e.g. wireless/RF systems, 5G/6G, "
    "antennas, transceivers, modems, telecom/network equipment, optical/fiber "
    "communication systems, networking hardware, or connectivity/spectrum "
    "solutions. Answer is_comms=false if communication is only a SUPPORTING "
    "component of a product whose core purpose is something else — a defense "
    "system, robot, drone, wearable/health device, sensor, vehicle, or software "
    "platform that merely USES connectivity (Wi-Fi, LoRa, 4G, mesh, telemetry) to "
    "function. When in doubt, answer false. Respond STRICT JSON: "
    '{"is_comms": true|false, "reason": "<=15 words"}.'
)

_URL = "https://openrouter.ai/api/v1/chat/completions"
_MODEL = "google/gemini-2.5-flash"
_TIMEOUT = 30.0


def shortlist(text: str) -> list[str]:
    """Return the comms keywords/phrases found in `text` (empty = not a candidate)."""
    if not text:
        return []
    low = text.lower()
    matched = [w for w in _WORDS if _WORD_RE[w].search(text)]
    matched += [p for p in _PHRASES if p in low]
    return matched


def _call_openrouter(text: str) -> str:
    api_key = os.getenv("OPENROUTER_API_KEY", "")
    payload = {
        "model": _MODEL,
        "temperature": 0,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": _PROMPT},
            {"role": "user", "content": text[:6000]},
        ],
    }
    with httpx.Client(timeout=_TIMEOUT) as client:
        resp = client.post(
            _URL,
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=payload,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]


def confirm_is_comms(text: str, *, call: Callable[[str], str] = _call_openrouter) -> dict[str, Any]:
    """One LLM call → {is_comms: bool, reason: str}. Parse/HTTP error → safe false."""
    try:
        data = json.loads(call(text))
        return {"is_comms": bool(data.get("is_comms")), "reason": str(data.get("reason", ""))[:120]}
    except Exception as exc:  # noqa: BLE001
        log.warning("comms confirm failed: %s", exc)
        return {"is_comms": False, "reason": ""}


def identify(
    apps: list[dict[str, Any]], *, confirm_fn: Callable[[str], dict] | None = None
) -> list[dict[str, Any]]:
    """`apps` items: {app_id, track, project_name, current_category, text}.
    Shortlist first (no LLM), then confirm only the candidates. Returns confirmed
    matches with matched_terms + reason."""
    confirm = confirm_fn or confirm_is_comms
    out: list[dict[str, Any]] = []
    for a in apps:
        terms = shortlist(a.get("text", ""))
        if not terms:
            continue
        verdict = confirm(a["text"])
        if verdict.get("is_comms"):
            out.append({
                "app_id": a["app_id"],
                "track": a["track"],
                "project_name": a.get("project_name"),
                "current_category": a.get("current_category"),
                "matched_terms": terms,
                "reason": verdict.get("reason", ""),
            })
    return out
