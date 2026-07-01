"""Unit tests for the AI screener worker (now delegates to ai_pipeline)."""
from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from workers.ai_screener import handler
from workers.ai_screener.scoring import ScoreResult, compute_overall


def _make_sqs_event(*payloads: dict) -> dict:
    return {"Records": [{"messageId": f"msg-{i}", "body": json.dumps(p)}
                        for i, p in enumerate(payloads)]}


def _fake_client(status: str = "submitted") -> MagicMock:
    client = MagicMock()
    chain = MagicMock()
    chain.select.return_value = chain
    chain.eq.return_value = chain
    chain.maybe_single.return_value = chain
    chain.execute.return_value = SimpleNamespace(data={"id": "a1", "status": status})
    client.table.return_value = chain
    return client


def _fake_result() -> ScoreResult:
    return ScoreResult(
        score_problem=9.0, score_solution=8.5, score_tech=8.0,
        score_founders=8.5, score_commitment=9.0,
        score_overall=compute_overall(9.0, 8.5, 8.0, 8.5, 9.0),
        summary="ok", model="google/gemini-2.5-flash", raw_response="{}",
    )


def test_compute_overall_known_input():
    assert compute_overall(9.0, 8.5, 8.0, 8.5, 9.0) == 8.6


def test_handler_runs_pipeline_and_persists():
    client = _fake_client("submitted")
    with patch.object(handler, "get_admin_client", return_value=client), \
         patch.object(handler.pipeline, "run_for_application", return_value=_fake_result()) as run, \
         patch.object(handler.pipeline, "persist") as persist:
        out = handler.lambda_handler(_make_sqs_event({"application_id": "a1", "application_track": "tir"}), None)
    assert out == {"batchItemFailures": []}
    run.assert_called_once()
    # advance_status True because the row is still `submitted`
    assert persist.call_args.kwargs["advance_status"] is True


def test_handler_skips_when_not_submitted():
    client = _fake_client("under_review")
    with patch.object(handler, "get_admin_client", return_value=client), \
         patch.object(handler.pipeline, "run_for_application") as run:
        out = handler.lambda_handler(_make_sqs_event({"application_id": "a1", "application_track": "tir"}), None)
    assert out == {"batchItemFailures": []}
    run.assert_not_called()


def test_handler_failure_lands_in_batch_item_failures():
    client = _fake_client("submitted")
    with patch.object(handler, "get_admin_client", return_value=client), \
         patch.object(handler.pipeline, "run_for_application", side_effect=RuntimeError("boom")):
        out = handler.lambda_handler(_make_sqs_event({"application_id": "a1", "application_track": "tir"}), None)
    assert out == {"batchItemFailures": [{"itemIdentifier": "msg-0"}]}
