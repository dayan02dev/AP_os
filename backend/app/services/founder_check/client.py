"""OpenRouter chat calls for the founder-check pipeline: a multimodal résumé
message (PDF file part or extracted text) and a plain talent-scout message.
Reads OPENROUTER_API_KEY from the environment directly (like ai_pipeline's
BaseAgent) so it runs inside the AI-screener Lambda without app.config.
"""
from __future__ import annotations

import base64
import os
from typing import Any

import httpx

_URL = "https://openrouter.ai/api/v1/chat/completions"
_MODEL = "google/gemini-2.5-flash"
_TIMEOUT = 60.0
_TEMP = 0.2


def _post(messages: list[dict], *, json_mode: bool) -> str:
    payload: dict[str, Any] = {
        "model": _MODEL, "messages": messages, "temperature": _TEMP,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    with httpx.Client(timeout=_TIMEOUT) as c:
        resp = c.post(
            _URL,
            headers={
                "Authorization": f"Bearer {os.getenv('OPENROUTER_API_KEY', '')}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


def ocr_pdf_to_json(pdf_bytes: bytes, extract_prompt: str) -> str:
    """Send a PDF résumé to the multimodal model as a file part and ask for JSON."""
    b64 = base64.b64encode(pdf_bytes).decode("ascii")
    messages = [
        {"role": "system", "content": extract_prompt},
        {"role": "user", "content": [
            {"type": "text", "text": "Extract this résumé into the described JSON schema."},
            {"type": "file", "file": {
                "filename": "resume.pdf",
                "file_data": f"data:application/pdf;base64,{b64}",
            }},
        ]},
    ]
    return _post(messages, json_mode=True)


def structure_text_to_json(resume_text: str, extract_prompt: str) -> str:
    """Structure already-extracted résumé text (e.g. from DOCX) into JSON."""
    messages = [
        {"role": "system", "content": extract_prompt},
        {"role": "user", "content": f"RÉSUMÉ TEXT:\n{resume_text}"},
    ]
    return _post(messages, json_mode=True)


def scout(resume_json_str: str, scout_prompt: str) -> str:
    """Run the talent-scout prompt over the structured résumé JSON (plain text out)."""
    messages = [
        {"role": "system", "content": scout_prompt},
        {"role": "user", "content": f"CANDIDATE PROFILE JSON:\n{resume_json_str}"},
    ]
    return _post(messages, json_mode=False)
