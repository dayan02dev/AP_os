"""Lambda entrypoint for the AI screening worker.

Triggered by SQS. Each record payload is a JSON object:
    {"application_id": "<uuid>", "application_track": "tir" | "sip"}

Per record:
1. Fetch the application row from the {track}_applications table.
2. Idempotency: only screen rows still in `submitted`.
3. Run the ai_pipeline (classify -> score -> summarize) and persist ai_screening,
   advancing submitted -> under_review.

Partial-batch-response (ReportBatchItemFailures) is implemented: only failed
message IDs are returned so the Lambda runtime replays only those records.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.services.ai_pipeline import pipeline
from app.services.founder_check import run as founder_check_run
from app.supabase_client import get_admin_client

log = logging.getLogger(__name__)

_STATUS_SUBMITTED = "submitted"


def _process_record(record: dict) -> None:
    """Process a single SQS record. Raises on failure so the caller can add the
    message ID to batchItemFailures."""
    body_raw = record.get("body", "{}")
    body = json.loads(body_raw) if isinstance(body_raw, str) else body_raw
    application_id = body["application_id"]
    application_track = body["application_track"]

    log.info("Processing application_id=%s track=%s", application_id, application_track)

    client = get_admin_client()
    table = f"{application_track}_applications"
    res = client.table(table).select("*").eq("id", application_id).maybe_single().execute()
    app_row = res.data
    if app_row is None:
        raise ValueError(f"application_id={application_id} not found in {table}")

    current_status = app_row.get("status", "")
    if current_status != _STATUS_SUBMITTED:
        log.info("application_id=%s status=%s (not submitted) — skipping",
                 application_id, current_status)
        return

    result = pipeline.run_for_application(
        application_id, application_track, client=client, no_cache=True,
    )
    pipeline.persist(
        client, application_id, application_track, result, advance_status=True,
    )
    log.info("Screened application_id=%s overall=%.1f", application_id, result.score_overall)

    # Founder check (TIR only, best-effort): reads the résumé and writes
    # ai_screening.founder_check. Never fails the SQS record.
    if application_track == "tir":
        try:
            founder_check_run.run_and_persist(client, application_id, application_track)
        except Exception:
            log.warning("founder_check failed (best-effort) for application_id=%s",
                        application_id, exc_info=True)


def lambda_handler(event: dict, context: Any) -> dict:
    """SQS-triggered Lambda handler with partial-batch-response support.

    Returns {"batchItemFailures": [{"itemIdentifier": "<messageId>"}, ...]}
    containing only the message IDs of records that failed processing.
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
