from app.services import profile_completion_service as pcs


class _Tbl:
    def insert(self, *a, **k):
        class _R:  # returns an id for the résumé insert
            data = [{"id": "resume-xyz"}]
        return type("E", (), {"execute": lambda self=None: _R()})()
    def update(self, *a, **k):
        return self
    def eq(self, *a, **k):
        return self
    def execute(self):
        return type("R", (), {"data": []})()


class _Storage:
    def from_(self, *a, **k): return self
    def upload(self, *a, **k): return {}


class _Client:
    storage = _Storage()
    def table(self, *a, **k): return _Tbl()


def test_store_submission_enqueues_founder_check_when_resume_saved(monkeypatch):
    calls = []
    monkeypatch.setattr(pcs.sqs_publisher, "publish_founder_check",
                        lambda app_id, track: calls.append((app_id, track)))
    saved = pcs.store_submission(
        _Client(), application_id="app-1", owner_user_id="u1",
        file_bytes=b"%PDF-1.4", filename="cv.pdf", mime="application/pdf",
        linkedin_url=None,
    )
    assert saved["resume"] is True
    assert calls == [("app-1", "tir")]


def test_store_submission_no_enqueue_when_no_resume(monkeypatch):
    calls = []
    monkeypatch.setattr(pcs.sqs_publisher, "publish_founder_check",
                        lambda app_id, track: calls.append((app_id, track)))
    saved = pcs.store_submission(
        _Client(), application_id="app-1", owner_user_id="u1",
        file_bytes=None, filename=None, mime=None,
        linkedin_url="linkedin.com/in/x",
    )
    assert saved["resume"] is False
    assert calls == []   # linkedin-only upload must NOT trigger a founder-check
