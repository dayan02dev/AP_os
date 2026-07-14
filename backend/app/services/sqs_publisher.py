"""Publish AI-screening jobs onto the FIFO SQS queue.

The submit endpoint calls :func:`publish` after flipping an application's
status to ``submitted``. The worker Lambda (see ``backend/workers/ai_screener``)
consumes these messages and writes the resulting scores into ``ai_screening``.

Design choices
--------------
* **Best-effort.** Submit responds in <500ms; if SQS is unreachable we log
  and return rather than fail the submit. The applicant has already been
  told their application went through; missing an AI score is recoverable
  (admin can re-trigger), but a 500 here would be visible and confusing.
* **No-op when the queue URL is unset.** Local dev and tests don't have a
  live queue, so an empty ``AI_SCREENING_QUEUE_URL`` short-circuits to a
  debug log. Production deploys must set the env var via the SAM template.
* **FIFO + per-app group.** ``MessageGroupId = application_id`` keeps
  retries for one app ordered relative to each other; different apps stay
  parallel up to the worker's reserved concurrency.
* **Idempotency.** The downstream ``ai_screening`` row has a
  ``UNIQUE(application_id, application_track)`` constraint and the worker
  upserts with ``ON CONFLICT``, so a duplicate enqueue is harmless. We rely
  on the queue's content-based dedup window plus that uniqueness — no
  explicit MessageDeduplicationId needed.
"""

from __future__ import annotations

import json
import logging
import os
from functools import lru_cache
from typing import Any

log = logging.getLogger(__name__)

_QUEUE_URL_ENV = "AI_SCREENING_QUEUE_URL"


@lru_cache(maxsize=1)
def _sqs_client() -> Any:
    """Return a cached boto3 SQS client (one per Lambda container)."""
    import boto3  # local import — keeps cold-start of unrelated callers fast

    return boto3.client("sqs")


def publish(application_id: str, application_track: str) -> None:
    """Enqueue an AI-screening job for the given application.

    Never raises. Failures are logged but do not propagate to the caller —
    the submit response is more important than scoring latency.
    """
    queue_url = os.getenv(_QUEUE_URL_ENV, "").strip()
    if not queue_url:
        log.debug(
            "%s unset — skipping AI-screening enqueue for application_id=%s",
            _QUEUE_URL_ENV,
            application_id,
        )
        return

    payload = json.dumps({
        "application_id": application_id,
        "application_track": application_track,
    })

    try:
        _sqs_client().send_message(
            QueueUrl=queue_url,
            MessageBody=payload,
            MessageGroupId=application_id,
        )
        log.info(
            "Enqueued AI screening for application_id=%s track=%s",
            application_id,
            application_track,
        )
    except Exception:
        log.exception(
            "Failed to enqueue AI screening for application_id=%s — submit "
            "succeeds, admin can re-trigger from the dashboard",
            application_id,
        )


def publish_founder_check(application_id: str, application_track: str) -> None:
    """Enqueue a founder-check-only job (a résumé arrived for an already-submitted
    app, e.g. via the profile-completion link). The worker runs ONLY the
    founder-check, not a full re-screen. Never raises; no-op if the queue is unset.
    """
    queue_url = os.getenv(_QUEUE_URL_ENV, "").strip()
    if not queue_url:
        log.debug(
            "%s unset — skipping founder-check enqueue for application_id=%s",
            _QUEUE_URL_ENV, application_id,
        )
        return

    payload = json.dumps({
        "application_id": application_id,
        "application_track": application_track,
        "job": "founder_check",
    })

    try:
        _sqs_client().send_message(
            QueueUrl=queue_url,
            MessageBody=payload,
            MessageGroupId=application_id,
        )
        log.info(
            "Enqueued founder-check for application_id=%s track=%s",
            application_id, application_track,
        )
    except Exception:
        log.exception(
            "Failed to enqueue founder-check for application_id=%s — recoverable "
            "(admin can re-run the backfill)",
            application_id,
        )


def publish_jury_job(job: str, juror_user_id: str) -> bool:
    """Fire-and-forget jury job ('jury_enrich' | 'jury_match'). Never raises;
    no-op if the queue is unset. Returns True if the message was enqueued.
    """
    queue_url = os.getenv(_QUEUE_URL_ENV, "").strip()
    if not queue_url:
        log.debug(
            "%s unset — skipping jury job enqueue job=%s juror_user_id=%s",
            _QUEUE_URL_ENV, job, juror_user_id,
        )
        return False

    payload = json.dumps({
        "job": job,
        "juror_user_id": juror_user_id,
    })

    try:
        _sqs_client().send_message(
            QueueUrl=queue_url,
            MessageBody=payload,
            MessageGroupId=juror_user_id,
        )
        log.info(
            "Enqueued jury job=%s for juror_user_id=%s",
            job, juror_user_id,
        )
        return True
    except Exception:
        log.warning(
            "Failed to enqueue jury job=%s for juror_user_id=%s",
            job, juror_user_id, exc_info=True,
        )
        return False
