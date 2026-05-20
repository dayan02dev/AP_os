"""Unit tests for the AI screener worker package.

All tests run offline — no network, no Supabase.  Supabase calls are
intercepted by patching ``app.supabase_client.get_admin_client``.

Tests:
    test_stub_is_deterministic
    test_stub_overall_matches_weighted_sum
    test_stub_scores_in_range
    test_compute_overall_known_input
    test_handler_sip_returns_success_without_writing
    test_handler_writes_ai_screening_and_advances_status
    test_handler_idempotent_when_already_under_review
    test_handler_failed_record_appears_in_batchItemFailures
"""

from __future__ import annotations

import json
import uuid
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from workers.ai_screener import stub as stub_module
from workers.ai_screener.scoring import ScoreResult, compute_overall


# ─── Helpers ──────────────────────────────────────────────────────────────────


def _make_sqs_event(*payloads: dict) -> dict:
    """Wrap one or more payload dicts as a minimal SQS event."""
    return {
        "Records": [
            {
                "messageId": f"msg-{i}",
                "body": json.dumps(payload),
            }
            for i, payload in enumerate(payloads)
        ]
    }


def _make_fake_client(status: str = "submitted") -> MagicMock:
    """Return a mock Supabase admin client with configurable application status.

    The mock tracks calls to .table() and simulates the chained query API.
    """
    client = MagicMock()

    # Build the tir_applications row that gets returned by .maybe_single().execute()
    app_row = {
        "id": "aaaaaaaa-0000-0000-0000-000000000001",
        "status": status,
        "basic_full_name": "Test User",
        "basic_org_name": "Test Org",
        "basic_org": "Test Org",
        "problem_describe": "A real problem.",
        "solution_describe": "An elegant solution.",
        "solution_core_tech": "Python",
    }

    # .select(...).eq(...).maybe_single().execute() → SimpleNamespace(data=app_row)
    select_chain = MagicMock()
    select_chain.eq.return_value = select_chain
    select_chain.maybe_single.return_value = select_chain
    select_chain.execute.return_value = SimpleNamespace(data=app_row)

    # .upsert(...).execute() → SimpleNamespace(data=[])
    upsert_chain = MagicMock()
    upsert_chain.execute.return_value = SimpleNamespace(data=[])

    # .insert(...).execute() → SimpleNamespace(data=[])
    insert_chain = MagicMock()
    insert_chain.execute.return_value = SimpleNamespace(data=[])

    # .update(...).eq(...).execute() → SimpleNamespace(data=[])
    update_chain = MagicMock()
    update_chain.eq.return_value = update_chain
    update_chain.execute.return_value = SimpleNamespace(data=[])

    def _table(name: str) -> MagicMock:
        tbl = MagicMock()
        tbl.select.return_value = select_chain
        tbl.upsert.return_value = upsert_chain
        tbl.insert.return_value = insert_chain
        tbl.update.return_value = update_chain
        return tbl

    client.table.side_effect = _table
    return client


# ─── scoring.py tests ─────────────────────────────────────────────────────────


def test_compute_overall_known_input():
    """Weighted sum with all-equal inputs should equal that input."""
    assert compute_overall(5.0, 5.0, 5.0, 5.0, 5.0) == 5.0
    assert compute_overall(10.0, 10.0, 10.0, 10.0, 10.0) == 10.0
    assert compute_overall(0.0, 0.0, 0.0, 0.0, 0.0) == 0.0


# ─── stub.py tests ────────────────────────────────────────────────────────────


def test_stub_is_deterministic():
    """Same application_id must always produce identical scores."""
    app_id = "f47ac10b-58cc-4372-a567-0e02b2c3d479"
    r1 = stub_module.score(app_id)
    r2 = stub_module.score(app_id)

    assert r1.score_problem == r2.score_problem
    assert r1.score_solution == r2.score_solution
    assert r1.score_tech == r2.score_tech
    assert r1.score_founders == r2.score_founders
    assert r1.score_commitment == r2.score_commitment
    assert r1.score_overall == r2.score_overall


def test_stub_overall_matches_weighted_sum():
    """score_overall must equal compute_overall(...) for the five category scores."""
    app_id = "deadbeef-dead-beef-dead-beefdeadbeef"
    result = stub_module.score(app_id)

    expected = compute_overall(
        result.score_problem,
        result.score_solution,
        result.score_tech,
        result.score_founders,
        result.score_commitment,
    )
    assert result.score_overall == expected


def test_stub_scores_in_range():
    """All scores must be in [0.0, 10.0] for a broad set of application_ids."""
    for _ in range(50):
        app_id = str(uuid.uuid4())
        result = stub_module.score(app_id)
        for attr in (
            "score_problem",
            "score_solution",
            "score_tech",
            "score_founders",
            "score_commitment",
            "score_overall",
        ):
            val = getattr(result, attr)
            assert 0.0 <= val <= 10.0, (
                f"{attr}={val} out of range for application_id={app_id}"
            )


# ─── handler.py tests ─────────────────────────────────────────────────────────


@patch("workers.ai_screener.handler.get_admin_client")
def test_handler_sip_returns_success_without_writing(mock_get_client):
    """SIP messages must be skipped (warning logged) without any DB write."""
    from workers.ai_screener.handler import lambda_handler

    mock_client = MagicMock()
    mock_get_client.return_value = mock_client

    event = _make_sqs_event(
        {"application_id": str(uuid.uuid4()), "application_track": "sip"}
    )
    result = lambda_handler(event, None)

    # Message must NOT be in batchItemFailures (i.e. treated as success).
    assert result["batchItemFailures"] == []

    # Supabase client must never have been called for a write.
    mock_client.table.assert_not_called()


@patch.dict("os.environ", {"AI_STUB": "true"})
@patch("workers.ai_screener.handler.get_admin_client")
def test_handler_writes_ai_screening_and_advances_status(mock_get_client):
    """Happy path: stub scores should be upserted + status advanced."""
    from workers.ai_screener.handler import lambda_handler

    app_id = "aaaaaaaa-0000-0000-0000-000000000001"

    # Track all table() calls and capture upsert/update payloads.
    upsert_rows: list[dict] = []
    upsert_kwargs: list[dict] = []
    update_payloads: list[dict] = []

    app_row = {
        "id": app_id,
        "status": "submitted",
        "basic_full_name": "Test User",
        "basic_org_name": "Test Org",
        "basic_org": "Test Org",
        "problem_describe": "A problem.",
        "solution_describe": "A solution.",
        "solution_core_tech": "Python",
    }

    tables_accessed: list[str] = []

    def _make_table(name: str) -> MagicMock:
        tables_accessed.append(name)
        tbl = MagicMock()

        # select chain (for tir_applications read)
        select_chain = MagicMock()
        select_chain.eq.return_value = select_chain
        select_chain.maybe_single.return_value = select_chain
        select_chain.execute.return_value = SimpleNamespace(data=app_row)
        tbl.select.return_value = select_chain

        # upsert chain (for ai_screening write) — capture args
        def _upsert(row, **kwargs):
            upsert_rows.append(row)
            upsert_kwargs.append(kwargs)
            upsert_chain = MagicMock()
            upsert_chain.execute.return_value = SimpleNamespace(data=[])
            return upsert_chain

        tbl.upsert.side_effect = _upsert

        # insert chain (for application_status_log)
        insert_chain = MagicMock()
        insert_chain.execute.return_value = SimpleNamespace(data=[])
        tbl.insert.return_value = insert_chain

        # update chain (for tir_applications status advance)
        def _update(payload):
            update_payloads.append(payload)
            update_chain = MagicMock()
            update_chain.eq.return_value = update_chain
            update_chain.execute.return_value = SimpleNamespace(data=[])
            return update_chain

        tbl.update.side_effect = _update
        return tbl

    fake_client = MagicMock()
    fake_client.table.side_effect = _make_table
    mock_get_client.return_value = fake_client

    event = _make_sqs_event(
        {"application_id": app_id, "application_track": "tir"}
    )
    result = lambda_handler(event, None)

    assert result["batchItemFailures"] == []

    # ai_screening must have been targeted.
    assert "ai_screening" in tables_accessed, "ai_screening table was never targeted"

    # The upsert row must contain all 5 scores + overall.
    assert upsert_rows, "upsert was never called on ai_screening"
    upserted_row = upsert_rows[0]
    for key in (
        "score_problem", "score_solution", "score_tech",
        "score_founders", "score_commitment", "score_overall",
    ):
        assert key in upserted_row, f"Missing key in upserted row: {key}"
        assert 0.0 <= upserted_row[key] <= 10.0

    assert upserted_row["model"] == "stub"
    assert upsert_kwargs[0].get("on_conflict") == "application_id,application_track"

    # tir_applications must have been updated to under_review.
    assert any(
        "under_review" in str(p) for p in update_payloads
    ), f"No update payload contained under_review; got: {update_payloads}"


@patch.dict("os.environ", {"AI_STUB": "true"})
@patch("workers.ai_screener.handler.get_admin_client")
def test_handler_idempotent_when_already_under_review(mock_get_client):
    """If the application is already under_review, do nothing and return success."""
    from workers.ai_screener.handler import lambda_handler

    app_id = "aaaaaaaa-0000-0000-0000-000000000002"
    fake_client = _make_fake_client(status="under_review")
    mock_get_client.return_value = fake_client

    event = _make_sqs_event(
        {"application_id": app_id, "application_track": "tir"}
    )
    result = lambda_handler(event, None)

    assert result["batchItemFailures"] == []

    # ai_screening table must NOT have been written.
    upsert_targeted = any(
        c.args[0] == "ai_screening"
        for c in fake_client.table.call_args_list
    )
    assert not upsert_targeted, (
        "ai_screening was written despite application already being under_review"
    )

    # No status update either.
    update_targeted = False
    for call in fake_client.table.call_args_list:
        if call.args[0] == "tir_applications":
            # Check if update() was actually chained on the returned mock
            tbl = fake_client.table.return_value
            if tbl.update.called:
                update_targeted = True
    assert not update_targeted, (
        "tir_applications status was updated despite application already being under_review"
    )


@patch.dict("os.environ", {"AI_STUB": "true"})
@patch("workers.ai_screener.handler.get_admin_client")
def test_handler_failed_record_appears_in_batchItemFailures(mock_get_client):
    """A record that raises should appear in batchItemFailures; others should not."""
    from workers.ai_screener.handler import lambda_handler

    # First app will succeed (status=submitted, normal path).
    good_app_id = "aaaaaaaa-0000-0000-0000-000000000003"
    # Second app will cause .maybe_single().execute() to raise.
    bad_app_id = "bbbbbbbb-0000-0000-0000-000000000004"

    # Build a client that succeeds for good_app_id and raises for bad_app_id.
    call_count: list[int] = [0]

    good_row = {
        "id": good_app_id,
        "status": "submitted",
        "basic_full_name": "Good User",
        "basic_org_name": None,
        "basic_org": None,
        "problem_describe": "A problem",
        "solution_describe": "A solution",
        "solution_core_tech": "Python",
    }

    def _make_select_chain(app_id: str) -> MagicMock:
        chain = MagicMock()
        chain.eq.return_value = chain
        chain.maybe_single.return_value = chain
        if app_id == good_app_id:
            chain.execute.return_value = SimpleNamespace(data=good_row)
        else:
            chain.execute.side_effect = RuntimeError("DB exploded")
        return chain

    upsert_chain = MagicMock()
    upsert_chain.execute.return_value = SimpleNamespace(data=[])
    insert_chain = MagicMock()
    insert_chain.execute.return_value = SimpleNamespace(data=[])
    update_chain = MagicMock()
    update_chain.eq.return_value = update_chain
    update_chain.execute.return_value = SimpleNamespace(data=[])

    # Track which app_id is being queried by inspecting the eq() call args.
    _current_app_id: list[str] = [good_app_id]

    def _table(name: str) -> MagicMock:
        tbl = MagicMock()

        def _select(*args, **kwargs) -> MagicMock:
            return _make_select_chain(_current_app_id[0])

        tbl.select.side_effect = _select
        tbl.upsert.return_value = upsert_chain
        tbl.insert.return_value = insert_chain
        tbl.update.return_value = update_chain
        return tbl

    client = MagicMock()
    client.table.side_effect = _table
    mock_get_client.return_value = client

    # Patch _process_record to set _current_app_id before calling the real impl.
    import workers.ai_screener.handler as handler_mod

    original_process = handler_mod._process_record

    def _tracked_process(record: dict) -> None:
        body = json.loads(record["body"])
        _current_app_id[0] = body["application_id"]
        original_process(record)

    with patch.object(handler_mod, "_process_record", side_effect=_tracked_process):
        event = _make_sqs_event(
            {"application_id": good_app_id, "application_track": "tir"},
            {"application_id": bad_app_id, "application_track": "tir"},
        )
        result = lambda_handler(event, None)

    failed_ids = [item["itemIdentifier"] for item in result["batchItemFailures"]]

    # Good record must NOT be in failures.
    assert "msg-0" not in failed_ids, "Good record incorrectly appears in batchItemFailures"
    # Bad record MUST be in failures.
    assert "msg-1" in failed_ids, "Bad record missing from batchItemFailures"


# ─── openrouter_client industry tests ────────────────────────────────────────


def _openrouter_response_text(content_json: str) -> str:
    """Wrap a model-content string in the OpenRouter outer envelope.

    Mirrors what the real API returns so the parser exercises both layers.
    """
    escaped = json.dumps(content_json)
    return f'{{"choices":[{{"message":{{"content":{escaped}}}}}]}}'


def test_score_application_includes_categories_in_prompt(monkeypatch):
    """The category list and slots_remaining must appear in the user
    message so the LLM can pick or propose appropriately."""
    from workers.ai_screener import openrouter_client

    captured: dict = {}

    inner = json.dumps(
        {
            "problem": 7,
            "solution": 8,
            "tech": 7,
            "founders": 6,
            "commitment": 7,
            "summary": "ok",
            "industry": {
                "category_id": "robotics",
                "industry_confidence": 0.9,
            },
        }
    )
    envelope = _openrouter_response_text(inner)

    class _Resp:
        text = envelope

        @staticmethod
        def raise_for_status():
            return None

        def json(self):
            return json.loads(envelope)

    class _Client:
        def __init__(self, *a, **kw):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, headers, json):
            captured["payload"] = json
            return _Resp()

    monkeypatch.setattr(openrouter_client.httpx, "Client", _Client)
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    categories = [
        {"id": "robotics", "label": "Robotics & Automation", "is_seed": True},
        {"id": "ai", "label": "Artificial Intelligence", "is_seed": True},
    ]

    result = openrouter_client.score_application(
        app_row={
            "basic_full_name": "Test",
            "problem_describe": "warehouse picking is slow",
            "solution_describe": "an autonomous robot arm",
            "solution_core_tech": "vision + ROS",
        },
        categories=categories,
        slots_remaining=10,
    )

    assert result.industry_category_id == "robotics"
    assert result.industry_confidence == 0.9
    assert result.new_industry_proposal is None

    user_msg = captured["payload"]["messages"][1]["content"]
    assert "robotics" in user_msg
    assert "Robotics & Automation" in user_msg
    assert "slots_remaining" in user_msg.lower()


def test_score_application_handles_new_category_proposal(monkeypatch):
    """When LLM proposes a new category, ScoreResult.new_industry_proposal
    is populated and industry_category_id stays None — the handler decides
    whether to create the new category row."""
    from workers.ai_screener import openrouter_client

    inner = json.dumps(
        {
            "problem": 7,
            "solution": 8,
            "tech": 7,
            "founders": 6,
            "commitment": 7,
            "summary": "ok",
            "industry": {
                "new_category": {"id": "climate_tech", "label": "Climate Tech"},
                "industry_confidence": 0.85,
            },
        }
    )
    envelope = _openrouter_response_text(inner)

    class _Resp:
        text = envelope

        @staticmethod
        def raise_for_status():
            return None

        def json(self):
            return json.loads(envelope)

    class _Client:
        def __init__(self, *a, **kw):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, *a, **kw):
            return _Resp()

    monkeypatch.setattr(openrouter_client.httpx, "Client", _Client)
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    result = openrouter_client.score_application(
        app_row={"solution_describe": "carbon capture"},
        categories=[{"id": "ai", "label": "AI", "is_seed": True}],
        slots_remaining=11,
    )

    assert result.industry_category_id is None
    assert result.new_industry_proposal == {"id": "climate_tech", "label": "Climate Tech"}
    assert result.industry_confidence == 0.85


def test_score_application_uses_new_model(monkeypatch):
    """The model constant must be google/gemini-2.5-flash."""
    from workers.ai_screener import openrouter_client

    assert openrouter_client._MODEL == "google/gemini-2.5-flash"


def test_score_application_no_categories_omits_industry(monkeypatch):
    """When categories is None/empty, industry fields stay None."""
    from workers.ai_screener import openrouter_client

    inner = json.dumps(
        {
            "problem": 7,
            "solution": 8,
            "tech": 7,
            "founders": 6,
            "commitment": 7,
            "summary": "ok",
        }
    )
    envelope = _openrouter_response_text(inner)

    class _Resp:
        text = envelope

        @staticmethod
        def raise_for_status():
            return None

        def json(self):
            return json.loads(envelope)

    class _Client:
        def __init__(self, *a, **kw):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, *a, **kw):
            return _Resp()

    monkeypatch.setattr(openrouter_client.httpx, "Client", _Client)
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    result = openrouter_client.score_application(app_row={"basic_full_name": "X"})
    assert result.industry_category_id is None
    assert result.industry_confidence is None
    assert result.new_industry_proposal is None
