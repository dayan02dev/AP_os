import json
from workers.ai_screener import handler
from app.services.founder_check import run as fc_run


def _record(app_id, track):
    return {"messageId": "m1",
            "body": json.dumps({"application_id": app_id, "application_track": track})}


def _stub_screening(monkeypatch, status="submitted"):
    """Make the record processable up to the founder_check call."""
    class _Q:
        def select(self, *a, **k): return self
        def eq(self, *a, **k): return self
        def maybe_single(self): return self
        def execute(self): return type("R", (), {"data": {"id": "app-1", "status": status}})()
    class _C:
        def table(self, name): return _Q()
    monkeypatch.setattr(handler, "get_admin_client", lambda: _C())
    monkeypatch.setattr(handler.pipeline, "run_for_application",
                        lambda *a, **k: type("SR", (), {"score_overall": 7.0})())
    monkeypatch.setattr(handler.pipeline, "persist", lambda *a, **k: None)


def test_worker_calls_founder_check_for_tir(monkeypatch):
    _stub_screening(monkeypatch)
    calls = []
    monkeypatch.setattr(fc_run, "run_and_persist",
                        lambda client, app_id, track: calls.append((app_id, track)))
    handler.lambda_handler({"Records": [_record("app-1", "tir")]}, None)
    assert calls == [("app-1", "tir")]


def test_worker_skips_founder_check_for_sip(monkeypatch):
    _stub_screening(monkeypatch)
    calls = []
    monkeypatch.setattr(fc_run, "run_and_persist",
                        lambda client, app_id, track: calls.append((app_id, track)))
    handler.lambda_handler({"Records": [_record("app-2", "sip")]}, None)
    assert calls == []


def test_worker_founder_check_failure_does_not_fail_record(monkeypatch):
    _stub_screening(monkeypatch)

    def _boom(*a, **k):
        raise RuntimeError("founder check exploded")

    monkeypatch.setattr(fc_run, "run_and_persist", _boom)
    out = handler.lambda_handler({"Records": [_record("app-1", "tir")]}, None)
    assert out["batchItemFailures"] == []   # record still succeeds
