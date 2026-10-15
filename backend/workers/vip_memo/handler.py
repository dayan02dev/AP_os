"""SQS Lambda for VIP memo generation. Record body: {"memo_id": "<uuid>"}.

Budget and validation failures are terminal memo statuses (generate() returns them),
not retries. Only unexpected exceptions become batchItemFailures.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from app.services.vip_memo_gen.pipeline import generate
from app.supabase_client import get_admin_client

log = logging.getLogger(__name__)


def _process_record(record: dict) -> None:
    body_raw = record.get("body", "{}")
    body = json.loads(body_raw) if isinstance(body_raw, str) else body_raw
    memo_id = body["memo_id"]
    status = generate(get_admin_client(), memo_id)
    log.info("vip memo %s finished status=%s", memo_id, status)


def lambda_handler(event: dict, context: Any) -> dict:
    failed: list[dict] = []
    for record in event.get("Records", []):
        message_id = record.get("messageId", "<unknown>")
        try:
            _process_record(record)
        except Exception:
            log.exception("vip memo record failed messageId=%s", message_id)
            failed.append({"itemIdentifier": message_id})
    return {"batchItemFailures": failed}
