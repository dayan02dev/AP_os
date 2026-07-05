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


def _record_job(app_id, track, job):
    import json as _json
    return {"messageId": "mj",
            "body": _json.dumps({"application_id": app_id,
                                 "application_track": track, "job": job})}


def test_worker_founder_check_job_runs_only_founder_check(monkeypatch):
    # get_admin_client is used by the job branch; stub it.
    monkeypatch.setattr(handler, "get_admin_client", lambda: object())
    screened = {"n": 0}
    monkeypatch.setattr(handler.pipeline, "run_for_application",
                        lambda *a, **k: screened.update(n=screened["n"] + 1))
    calls = []
    monkeypatch.setattr(fc_run, "run_and_persist",
                        lambda client, app_id, track: calls.append((app_id, track)))

    out = handler.lambda_handler(
        {"Records": [_record_job("app-9", "tir", "founder_check")]}, None)

    assert calls == [("app-9", "tir")]        # founder-check ran
    assert screened["n"] == 0                  # NO full screening
    assert out["batchItemFailures"] == []


def test_worker_founder_check_job_skips_non_tir(monkeypatch):
    monkeypatch.setattr(handler, "get_admin_client", lambda: object())
    calls = []
    monkeypatch.setattr(fc_run, "run_and_persist",
                        lambda client, app_id, track: calls.append((app_id, track)))
    handler.lambda_handler(
        {"Records": [_record_job("app-10", "sip", "founder_check")]}, None)
    assert calls == []                         # TIR-only
