"""SIP-specific orchestration over the schema-agnostic template_parser.

Mirrors the shape of services.template_parser.parse_template() but for
the SIP question schema (17 questions Q5..Q24 minus Q7/Q22/Q23) and
the SIP MCQ option lists. Delegates docx/pdf extraction + anchor
slicing + checkbox reading to template_parser; this module only owns
the SIP-specific facts:

  - Which question IDs to expect
  - Which questions are MCQ (so we know to fold checkbox state in)
  - The mapping from question ID to sip_applications column
  - Which LLM methods to call (the SIP variants on OpenRouterClient)
"""
from __future__ import annotations

import logging
from typing import Any

from .llm_service import LLMParseError, OpenRouterClient
from .template_parser import (
    DOCX_MIME,
    PDF_MIME,
    TemplateParseError,
    _docx_checkbox_states,
    _docx_concatenated_text,
    _extract_anchor_blocks,
    _pdf_text,
    _split_options_from_block,
)

log = logging.getLogger(__name__)

SIP_QUESTION_IDS: list[str] = [
    "Q5", "Q6", "Q8", "Q9", "Q10", "Q11", "Q12", "Q13", "Q14",
    "Q15", "Q16", "Q17", "Q18", "Q19", "Q20", "Q21", "Q24",
]

# MCQ questions in document order. Q5, Q6, Q8, Q10, Q15 each have an
# A/B/C option list. The SIP template doesn't ship with Word checkbox
# controls (Task 4 confirmed 0 w14:checkbox controls in the doc), so
# checkbox state will be empty at runtime and the LLM normaliser will
# resolve MCQs from free_text + option labels.
SIP_MCQ_QUESTIONS: tuple[str, ...] = ("Q5", "Q6", "Q8", "Q10", "Q15")

# Mapping consumed by routers.sip_application_templates apply flow.
# Every column listed here already exists on public.sip_applications
# (migrations 011 + 012).
QUESTION_TO_SIP_COLUMN: dict[str, str] = {
    "Q5":  "sip_incorporated",
    "Q6":  "sip_trl",
    "Q8":  "basic_incubator_association",
    "Q9":  "basic_incubator_details",
    "Q10": "basic_hear_about",
    "Q11": "problem_describe",
    "Q12": "solution_describe",
    "Q13": "solution_core_tech",
    "Q14": "solution_contrarian_insight",
    "Q15": "sip_traction",
    "Q16": "sip_traction_details",
    "Q17": "execution_will_break",
    "Q18": "execution_milestone",
    "Q19": "execution_infrastructure",
    "Q20": "execution_failure",
    "Q21": "execution_hwsw_integration",
    "Q24": "sip_demo_video_url",
}


async def parse_sip_template(
    *,
    file_bytes: bytes,
    mime: str,
    user_id: str | None = None,
) -> dict[str, Any]:
    """Run the SIP pipeline and return the normalised dict.

    Output shape (always emitted, never partial):
        {Q5: str|None, Q6: str|None, ..., Q24: str|None}
    """
    if not file_bytes:
        raise TemplateParseError("empty_document", "Empty file uploaded.")

    mime = (mime or "").lower().strip()

    # 1. Extract concatenated text + checkbox states.
    if mime == DOCX_MIME:
        try:
            full_text = _docx_concatenated_text(file_bytes)
            checkbox_states = _docx_checkbox_states(file_bytes)
        except Exception as exc:
            log.warning("sip docx extraction failed", extra={"err": str(exc)})
            raise TemplateParseError("empty_document", f"Could not read .docx: {exc}") from exc
    elif mime == PDF_MIME:
        try:
            full_text = _pdf_text(file_bytes)
        except Exception as exc:
            log.warning("sip pdf extraction failed", extra={"err": str(exc)})
            raise TemplateParseError("empty_document", f"Could not read PDF: {exc}") from exc
        checkbox_states = []
    else:
        raise TemplateParseError(
            "unsupported_mime",
            "Please upload the filled SIP template as .docx (preferred) or .pdf.",
        )

    if not full_text.strip():
        raise TemplateParseError("empty_document", "No text could be extracted.")

    # 2. Split into per-question anchor blocks.
    blocks = _extract_anchor_blocks(full_text)

    sip_blocks = {k: v for k, v in blocks.items() if k in SIP_QUESTION_IDS}
    if len(sip_blocks) < 3:
        log.info(
            "sip template anchor extraction sparse, falling back to freeform LLM",
            extra={"user_id": user_id, "anchor_count": len(sip_blocks)},
        )
        try:
            normalised = await OpenRouterClient().extract_sip_template_answers_freeform(
                full_text, user_id=user_id,
            )
        except LLMParseError as exc:
            if not sip_blocks:
                raise TemplateParseError(
                    "no_anchors_detected",
                    "We couldn't find any of the answer markers in this file, "
                    "and the fallback parser couldn't extract answers either. "
                    "Please download the SIP template above and fill answers "
                    "between the >>> ANSWER QN START >>> markers.",
                ) from exc
            raise TemplateParseError("llm_normalization_failed", str(exc)) from exc
        return {qid: normalised.get(qid) for qid in SIP_QUESTION_IDS}

    # 3. Fold checkbox state into MCQ blocks by document-order position.
    mcq_payload: dict[str, dict[str, Any]] = {}
    cb_cursor = 0
    for qid in SIP_MCQ_QUESTIONS:
        block = sip_blocks.get(qid, "")
        leftover, options = _split_options_from_block(block)
        states_for_q: list[tuple[str, str, bool | None]] = []
        for letter, label in options:
            state: bool | None
            if cb_cursor < len(checkbox_states):
                state = checkbox_states[cb_cursor]
            else:
                state = None
            states_for_q.append((letter, label, state))
            cb_cursor += 1
        mcq_payload[qid] = {
            "free_text": leftover,
            "options": [
                {"letter": l, "label": lbl, "checked": st}
                for (l, lbl, st) in states_for_q
            ],
        }

    # 4. Build LLM input.
    payload: dict[str, Any] = {}
    for qid in SIP_QUESTION_IDS:
        if qid in SIP_MCQ_QUESTIONS:
            payload[qid] = mcq_payload.get(qid, {"free_text": "", "options": []})
        else:
            payload[qid] = {"free_text": sip_blocks.get(qid, "").strip()}

    try:
        normalised = await OpenRouterClient().normalize_sip_template_answers(
            payload, user_id=user_id,
        )
    except LLMParseError as exc:
        raise TemplateParseError("llm_normalization_failed", str(exc)) from exc

    return {qid: normalised.get(qid) for qid in SIP_QUESTION_IDS}
