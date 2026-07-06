"""Lambda entrypoint for the AI screening worker.

Triggered by SQS. Each record payload is a JSON object:
    {"application_id": "<uuid>", "application_track": "tir" | "sip"}

Per record:
1. Fetch the application row from the {track}_applications table.
2. Idempotency: only screen apps that don't already have an ai_screening row
   (decoupled from status — assignment, not AI screening, drives status now).
3. Run the ai_pipeline (classify -> score -> summarize) and persist
   ai_screening. Status is left untouched (advance_status=False).

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


def _process_record(record: dict) -> None:
    """Process a single SQS record. Raises on failure so the caller can add the
    message ID to batchItemFailures."""
    body_raw = record.get("body", "{}")
    body = json.loads(body_raw) if isinstance(body_raw, str) else body_raw
    application_id = body["application_id"]
    application_track = body["application_track"]
    job = body.get("job", "screen")

    log.info("Processing application_id=%s track=%s job=%s",
             application_id, application_track, job)

    client = get_admin_client()

    # Founder-check-only job (a résumé arrived post-submit, e.g. via the
    # profile-completion link). Runs regardless of status; TIR only. Raises on
    # failure so SQS retries it (redrive -> DLQ), unlike the inline best-effort
    # call in the screening path below.
    if job == "founder_check":
        if application_track == "tir":
            log.info("Founder-check-only job for application_id=%s", application_id)
            founder_check_run.run_and_persist(client, application_id, application_track)
        return
    table = f"{application_track}_applications"
    res = client.table(table).select("*").eq("id", application_id).maybe_single().execute()
    app_row = res.data
    if app_row is None:
        raise ValueError(f"application_id={application_id} not found in {table}")

    # Idempotency now keys on "already screened", decoupled from status — so
    # an app assigned a reviewer (already under_review) still gets scored.
    already = (
        client.table("ai_screening").select("application_id")
        .eq("application_id", application_id)
        .eq("application_track", application_track)
        .limit(1).execute().data
    ) or []
    if already:
        log.info("application_id=%s already screened — skipping", application_id)
        return

    result = pipeline.run_for_application(
        application_id, application_track, client=client, no_cache=True,
    )
    pipeline.persist(
        client, application_id, application_track, result, advance_status=False,
    )
    log.info("Screened application_id=%s overall=%s", application_id,
              getattr(result, "score_overall", None))

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
