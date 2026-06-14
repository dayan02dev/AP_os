"""Lambda entrypoint for the AI screening worker.

Triggered by SQS. Each record payload is a JSON object:
    {"application_id": "<uuid>", "application_track": "tir" | "sip"}

Processing steps per record:
1.  Branch on AI_STUB env var (default "true").
2.  Fetch the application row from the appropriate _applications table.
3.  Score the application (stub or real OpenRouter call).
4.  Upsert into ai_screening (UNIQUE ON CONFLICT application_id, application_track).
5.  Write an application_status_log row.
6.  Advance application status from submitted → under_review.

Partial-batch-response (ReportBatchItemFailures) is implemented: only
failed message IDs are returned so the Lambda runtime replays only those
records, not the whole batch.

Env vars read by this module (deliberately NOT via the app.config singleton,
because this worker may run in a separate Lambda with its own env):
    AI_STUB           "true" | "false"  (default "true")
    OPENROUTER_API_KEY  bearer token for OpenRouter
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

from app.services import industry_categories
from app.supabase_client import get_admin_client

from .scoring import ScoreResult
from . import stub as stub_module
from . import openrouter_client

log = logging.getLogger(__name__)

# Status values in the state machine (spec §4.8). The worker only acts on
# rows in `submitted`; anything past that is treated as already-screened
# and skipped (idempotency). This is simpler and safer than enumerating
# every downstream status — if a row left `submitted` it shouldn't be
# touched by the screener again.
_STATUS_SUBMITTED = "submitted"
_STATUS_UNDER_REVIEW = "under_review"


# ─── Helpers ───────────────────────────────────────────────────────────────


def _is_stub_mode() -> bool:
    """Return True if AI_STUB env var is truthy (case-insensitive)."""
    val = os.getenv("AI_STUB", "true").strip().lower()
    return val not in ("false", "0", "no")


def _score(
    application_id: str,
    app_row: dict,
    *,
    categories: list[dict],
    slots_remaining: int,
) -> ScoreResult:
    """Dispatch to stub or real scorer based on AI_STUB env var.

    The stub ignores `categories` / `slots_remaining` (industry fields stay
    None). The real OpenRouter client uses them to classify alongside the
    five score dimensions.
    """
    if _is_stub_mode():
        log.info("AI_STUB=true — using deterministic stub scorer")
        return stub_module.score(application_id)
    log.info("AI_STUB=false — calling OpenRouter")
    return openrouter_client.score_application(
        app_row,
        categories=categories,
        slots_remaining=slots_remaining,
    )


def _upsert_ai_screening(
    client: Any,
    application_id: str,
    application_track: str,
    result: ScoreResult,
) -> None:
    """Write the scoring result to ai_screening, replacing any prior row."""
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "application_id": application_id,
        "application_track": application_track,
        "score_problem": result.score_problem,
        # DB column was renamed score_solution → score_completeness by
        # migration 016a. The internal ScoreResult field name kept the old
        # spelling to avoid churn across the worker path + tests; the rename
        # is mapped here at the DB boundary only.
        "score_completeness": result.score_solution,
        "score_tech": result.score_tech,
        "score_founders": result.score_founders,
        "score_commitment": result.score_commitment,
        "score_integrity": None,  # Phase 1 — intentionally NULL
        "score_overall": result.score_overall,
        "confidence": None,       # Phase 2
        "summary": result.summary,
        "flags": [],
        "raw_response": result.raw_response,
        "model": result.model,
        "ran_at": now,
        "error": None,
        "industry_category_id": result.industry_category_id,
        "industry_confidence": result.industry_confidence,
        "project_name": result.project_name,
    }
    client.table("ai_screening").upsert(
        row, on_conflict="application_id,application_track"
    ).execute()
    log.info(
        "Upserted ai_screening for application_id=%s track=%s overall=%.1f industry=%s",
        application_id,
        application_track,
        result.score_overall,
        result.industry_category_id,
    )


def _write_status_log(
    client: Any,
    application_id: str,
    application_track: str,
) -> None:
    """Append an application_status_log row for submitted → under_review."""
    client.table("application_status_log").insert({
        "application_id": application_id,
        "application_track": application_track,
        "from_status": _STATUS_SUBMITTED,
        "to_status": _STATUS_UNDER_REVIEW,
        "changed_by": None,
        "reason": "ai_screening_complete",
    }).execute()


def _advance_status(
    client: Any,
    application_id: str,
    application_track: str,
) -> None:
    """Advance the application from submitted to under_review."""
    table = f"{application_track}_applications"
    client.table(table).update({
        "status": _STATUS_UNDER_REVIEW,
    }).eq("id", application_id).execute()
    log.info("Advanced status → under_review for %s", application_id)


def _process_record(record: dict) -> None:
    """Process a single SQS record end-to-end.

    Raises any exception to the caller so it can add the message ID to
    batchItemFailures.
    """
    body_raw = record.get("body", "{}")
    body: dict = json.loads(body_raw) if isinstance(body_raw, str) else body_raw

    application_id: str = body["application_id"]
    application_track: str = body["application_track"]

    log.info(
        "Processing application_id=%s track=%s",
        application_id,
        application_track,
    )

    client = get_admin_client()

    # ── 1. Read current application row ───────────────────────────────────
    # Track-aware: TIR and SIP have different column sets. Rather than
    # maintain a per-track column list (the SIP table drops solution_stage /
    # evidence_* and adds sip_* columns — see app/models/sip_application.py),
    # select("*"). Downstream scoring reads specific keys defensively via
    # .get(), so selecting all columns is robust at this volume and avoids a
    # column list that silently drifts when a migration adds a field.
    # TODO(SIP rubric final): narrow column list once the SIP prompt is stable
    table = f"{application_track}_applications"
    res = (
        client.table(table)
        .select("*")
        .eq("id", application_id)
        .maybe_single()
        .execute()
    )
    app_row: dict | None = res.data

    if app_row is None:
        raise ValueError(
            f"application_id={application_id} not found in {table}"
        )

    current_status: str = app_row.get("status", "")

    # ── 2. Idempotency: only screen rows that are still in `submitted` ────
    if current_status != _STATUS_SUBMITTED:
        log.info(
            "application_id=%s is in status=%s (not submitted) — skipping",
            application_id,
            current_status,
        )
        return

    # ── 3. Score (load category list first so the LLM can choose) ─────────
    cats = industry_categories.fetch_categories()
    slots_remaining = max(0, industry_categories.CATEGORY_CAP - len(cats))
    result = _score(
        application_id,
        app_row,
        categories=cats,
        slots_remaining=slots_remaining,
    )

    # ── 3a. New category creation if LLM proposed one and we have slots ───
    if (
        result.new_industry_proposal
        and slots_remaining > 0
        and result.industry_confidence is not None
        and result.industry_confidence >= 0.7
    ):
        proposal = result.new_industry_proposal
        created = industry_categories.create_category_if_under_cap(
            category_id=proposal["id"],
            label=proposal["label"],
            created_by_app_id=application_id,
        )
        if created:
            # Frozen dataclass — rebuild via dataclasses.replace to attach
            # the newly-inserted category id so the upsert writes it.
            from dataclasses import replace as _replace

            result = _replace(result, industry_category_id=proposal["id"])
            log.info(
                "Created industry category %s (%s) from application_id=%s",
                proposal["id"],
                proposal["label"],
                application_id,
            )

    # ── 4. Upsert ai_screening ────────────────────────────────────────────
    _upsert_ai_screening(client, application_id, application_track, result)

    # ── 5. Write status log ───────────────────────────────────────────────
    _write_status_log(client, application_id, application_track)

    # ── 6. Advance status ─────────────────────────────────────────────────
    _advance_status(client, application_id, application_track)


# ─── Lambda entrypoint ─────────────────────────────────────────────────────


def lambda_handler(event: dict, context: Any) -> dict:
    """SQS-triggered Lambda handler with partial-batch-response support.

    Returns a dict with ``batchItemFailures`` containing only the message IDs
    of records that failed processing. Successful records are implicitly
    deleted by the Lambda runtime.

    Args:
        event:   SQS event dict provided by the Lambda runtime.
        context: Lambda context object (unused, required by the runtime).

    Returns:
        {"batchItemFailures": [{"itemIdentifier": "<messageId>"}, ...]}
    """
    records: list[dict] = event.get("Records", [])
    failed_ids: list[dict] = []

    log.info("Received SQS batch of %d record(s)", len(records))

    for record in records:
        message_id: str = record.get("messageId", "<unknown>")
        try:
            _process_record(record)
            log.info("Successfully processed messageId=%s", message_id)
        except Exception:
            log.exception(
                "Failed to process messageId=%s — adding to batchItemFailures",
                message_id,
            )
            failed_ids.append({"itemIdentifier": message_id})

    log.info(
        "Batch complete: %d succeeded, %d failed",
        len(records) - len(failed_ids),
        len(failed_ids),
    )
    return {"batchItemFailures": failed_ids}
