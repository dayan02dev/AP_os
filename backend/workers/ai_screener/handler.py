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


def _score(application_id: str, app_row: dict) -> ScoreResult:
    """Dispatch to stub or real scorer based on AI_STUB env var."""
    if _is_stub_mode():
        log.info("AI_STUB=true — using deterministic stub scorer")
        return stub_module.score(application_id)
    log.info("AI_STUB=false — calling OpenRouter")
    return openrouter_client.score_application(app_row)


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
        "score_solution": result.score_solution,
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
    }
    client.table("ai_screening").upsert(
        row, on_conflict="application_id,application_track"
    ).execute()
    log.info(
        "Upserted ai_screening for application_id=%s track=%s overall=%.1f",
        application_id,
        application_track,
        result.score_overall,
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

    # SIP support deferred until the SIP router merges into this branch.
    # INTEGRATION NOTE (when SIP merges):
    #   1. Delete this whole `if application_track == "sip"` block.
    #   2. Change the SELECT at the next block from hardcoded `tir_applications`
    #      to f"{application_track}_applications" — the SIP table has a
    #      different column set so adjust the column list accordingly.
    #   3. Add `sqs_publisher.publish(submitted["id"], "sip")` inside the
    #      SIP submit handler in backend/app/routers/sip_applications.py.
    if application_track == "sip":
        log.warning(
            "application_track='sip' is not yet supported on this branch — "
            "skipping application_id=%s without error",
            application_id,
        )
        return

    client = get_admin_client()

    # ── 1. Read current application row ───────────────────────────────────
    res = (
        client.table("tir_applications")
        .select(
            "id, status, basic_full_name, basic_org, "
            "problem_describe, solution_describe, solution_core_tech"
        )
        .eq("id", application_id)
        .maybe_single()
        .execute()
    )
    app_row: dict | None = res.data

    if app_row is None:
        raise ValueError(
            f"application_id={application_id} not found in tir_applications"
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

    # ── 3. Score ──────────────────────────────────────────────────────────
    result = _score(application_id, app_row)

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
