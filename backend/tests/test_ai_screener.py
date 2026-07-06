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


def _fake_client(status: str = "submitted", already_screened: bool = False) -> MagicMock:
    """A per-table-routed MagicMock double.

    Two distinct chains are needed now: the `_process_record` guard queries
    `ai_screening` (already-screened check) in addition to the app table, and
    a single shared chain (as before) would make `.limit(1).execute().data`
    resolve to an auto-created, always-truthy MagicMock — incorrectly
    tripping the "already screened" guard on every call.
    """
    client = MagicMock()

    app_chain = MagicMock()
    app_chain.select.return_value = app_chain
    app_chain.eq.return_value = app_chain
    app_chain.maybe_single.return_value = app_chain
    app_chain.execute.return_value = SimpleNamespace(data={"id": "a1", "status": status})

    screening_chain = MagicMock()
    screening_chain.select.return_value = screening_chain
    screening_chain.eq.return_value = screening_chain
    screening_chain.limit.return_value = screening_chain
    screening_chain.execute.return_value = SimpleNamespace(
        data=[{"application_id": "a1"}] if already_screened else []
    )

    def _table(name: str):
        return screening_chain if name == "ai_screening" else app_chain

    client.table.side_effect = _table
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
    # New contract: the worker never advances status itself — assignment does.
    assert persist.call_args.kwargs["advance_status"] is False


def test_handler_screens_even_when_not_submitted():
    """New contract: status no longer gates screening — only an existing
    ai_screening row does. An app already moved to under_review (e.g. via
    assignment) must still be screened."""
    client = _fake_client("under_review")
    with patch.object(handler, "get_admin_client", return_value=client), \
         patch.object(handler.pipeline, "run_for_application", return_value=_fake_result()) as run, \
         patch.object(handler.pipeline, "persist"):
        out = handler.lambda_handler(_make_sqs_event({"application_id": "a1", "application_track": "tir"}), None)
    assert out == {"batchItemFailures": []}
    run.assert_called_once()


def test_handler_skips_when_already_screened():
    client = _fake_client("submitted", already_screened=True)
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


def test_worker_screens_assigned_app_and_does_not_change_status(monkeypatch):
    """New workflow: AI must screen even when status is already under_review
    (assigned-first), and must NOT change the status."""
    from workers.ai_screener import handler
    from app.services.ai_pipeline import pipeline
    from tests.fixtures.fake_supabase import FakeSupabase

    fake = FakeSupabase({"tir_applications": [{"id": "a1", "status": "under_review"}], "ai_screening": []})
    monkeypatch.setattr(handler, "get_admin_client", lambda: fake)

    persisted = {}
    def _fake_persist(client, app_id, track, result, *, advance_status):
        persisted["advance_status"] = advance_status
        client.table("ai_screening").upsert(
            {"application_id": app_id, "application_track": track, "score_overall": 5.0},
            on_conflict="application_id,application_track").execute()
    monkeypatch.setattr(pipeline, "run_for_application", lambda *a, **k: object())
    monkeypatch.setattr(pipeline, "persist", _fake_persist)

    handler._process_record({"body": {"application_id": "a1", "application_track": "tir"}})

    assert persisted["advance_status"] is False          # no status advance
    assert fake.status_of("tir", "a1") == "under_review"  # unchanged
    assert fake.tables["ai_screening"]                    # screened despite non-submitted status


def test_worker_skips_already_screened(monkeypatch):
    from workers.ai_screener import handler
    from app.services.ai_pipeline import pipeline
    from tests.fixtures.fake_supabase import FakeSupabase
    fake = FakeSupabase({
        "sip_applications": [{"id": "a2", "status": "submitted"}],
        "ai_screening": [{"application_id": "a2", "application_track": "sip", "score_overall": 7.0}],
    })
    monkeypatch.setattr(handler, "get_admin_client", lambda: fake)
    ran = {"n": 0}
    monkeypatch.setattr(pipeline, "run_for_application", lambda *a, **k: ran.__setitem__("n", ran["n"] + 1))
    handler._process_record({"body": {"application_id": "a2", "application_track": "sip"}})
    assert ran["n"] == 0  # skipped: already has an ai_screening row
