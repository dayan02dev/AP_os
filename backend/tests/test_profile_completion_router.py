import asyncio

import pytest

from app.routers import profile_completion as pc


def test_get_state_valid(monkeypatch):
    row = {"token": "t", "application_id": "app-1", "needs_resume": True, "needs_linkedin": False,
           "is_preview": False, "used_at": None, "expires_at": "2999-01-01T00:00:00+00:00"}
    monkeypatch.setattr(pc, "get_admin_client", lambda: object())
    monkeypatch.setattr(pc.svc, "fetch_token", lambda c, t: row)
    monkeypatch.setattr(pc, "_applicant_display", lambda c, app_id: ("Asha", "TIR-26010"))
    out = asyncio.run(pc.get_token_state("t"))
    assert out["valid"] is True and out["needs_resume"] is True and out["applicant_name"] == "Asha"


def test_get_state_expired(monkeypatch):
    row = {"token": "t", "expires_at": "2000-01-01T00:00:00+00:00", "used_at": None,
           "application_id": "app-1", "needs_resume": True, "needs_linkedin": True, "is_preview": False}
    monkeypatch.setattr(pc, "get_admin_client", lambda: object())
    monkeypatch.setattr(pc.svc, "fetch_token", lambda c, t: row)
    out = asyncio.run(pc.get_token_state("t"))
    assert out == {"valid": False, "reason": "expired"}


def test_get_state_invalid(monkeypatch):
    monkeypatch.setattr(pc, "get_admin_client", lambda: object())
    monkeypatch.setattr(pc.svc, "fetch_token", lambda c, t: None)
    out = asyncio.run(pc.get_token_state("nope"))
    assert out == {"valid": False, "reason": "invalid"}


def test_send_sample(monkeypatch):
    calls = {}
    monkeypatch.setattr(pc, "get_admin_client", lambda: object())
    monkeypatch.setattr(pc.svc, "create_token", lambda c, **kw: calls.update(tok=kw) or "sample-tok")
    sent = {}

    class _ES:
        def send_profile_completion_request(self, **kw): sent.update(kw)
    monkeypatch.setattr(pc, "get_email_service", lambda: _ES())
    monkeypatch.setattr(pc, "frontend_url", lambda p: "https://x" + p)

    body = pc.SendBody(mode="sample", sample_email="me@x.com")
    out = asyncio.run(pc.send_requests(body, user={"user_id": "admin-1"}))
    assert out["mode"] == "sample" and out["sent"] == 1
    assert calls["tok"]["is_preview"] is True and calls["tok"]["application_id"] is None
    assert sent["to"] == "me@x.com" and "sample-tok" in sent["link_url"]


class _FakeUpload:
    def __init__(self, filename, content_type, data):
        self.filename = filename
        self.content_type = content_type
        self._data = data

    async def read(self):
        return self._data


class _FakeAppTable:
    def __init__(self, row):
        self._row = row

    def select(self, *a, **k):
        return self

    def eq(self, *a, **k):
        return self

    def limit(self, *a, **k):
        return self

    def execute(self):
        return type("R", (), {"data": [self._row] if self._row else []})()


class _FakeAdminClient:
    def __init__(self, app_row):
        self._app_row = app_row

    def table(self, name):
        assert name == "tir_applications"
        return _FakeAppTable(self._app_row)


def test_public_submit_evidence_stores_files(monkeypatch):
    row = {
        "token": "t", "application_id": "app-1", "needs_resume": False, "needs_linkedin": False,
        "needs_evidence": True, "is_preview": False, "used_at": None,
        "expires_at": "2999-01-01T00:00:00+00:00",
    }
    monkeypatch.setattr(pc, "get_admin_client", lambda: _FakeAdminClient({"id": "app-1", "user_id": "u-1"}))
    monkeypatch.setattr(pc.svc, "fetch_token", lambda c, t: row)

    calls = {}

    def _store(client, *, application_id, owner_user_id, files):
        calls["application_id"] = application_id
        calls["owner_user_id"] = owner_user_id
        calls["files"] = files
        return {"added": len(files), "pruned": 1, "kept": 0}

    monkeypatch.setattr(pc.svc, "store_evidence_submission", _store)
    marked = {}
    monkeypatch.setattr(pc.svc, "mark_used", lambda c, t: marked.update(token=t))

    ups = [
        _FakeUpload("a.pdf", "application/pdf", b"AAA"),
        _FakeUpload("b.jpg", "image/jpeg", b"BBBB"),
    ]
    out = asyncio.run(pc.submit_form("t", files=ups))

    assert out == {"ok": True, "saved": {"added": 2, "pruned": 1, "kept": 0}}
    assert calls["application_id"] == "app-1"
    assert calls["owner_user_id"] == "u-1"
    assert [f["filename"] for f in calls["files"]] == ["a.pdf", "b.jpg"]
    assert calls["files"][0]["mime"] == "application/pdf" and calls["files"][0]["bytes"] == b"AAA"
    assert marked["token"] == "t"


def test_admin_evidence_send_sample(monkeypatch):
    calls = {}
    monkeypatch.setattr(pc, "get_admin_client", lambda: object())
    monkeypatch.setattr(pc.svc, "create_token", lambda c, **kw: calls.update(tok=kw) or "sample-tok")
    sent = {}

    class _ES:
        def send_evidence_recollection(self, **kw): sent.update(kw)
    monkeypatch.setattr(pc, "get_email_service", lambda: _ES())
    monkeypatch.setattr(pc, "frontend_url", lambda p: "https://x" + p)

    body = pc.EvidenceSendBody(mode="sample", sample_email="udayanpawar03@gmail.com")
    out = asyncio.run(pc.send_evidence_requests(body, user={"user_id": "admin-1"}))
    assert out["mode"] == "sample" and out["sent"] == 1
    assert calls["tok"]["is_preview"] is True and calls["tok"]["application_id"] is None
    assert calls["tok"]["needs_evidence"] is True
    assert sent["to"] == "udayanpawar03@gmail.com" and "sample-tok" in sent["link_url"]
    assert sent["display_id"] == "TIR — sample"


def test_admin_evidence_send_list_dry_run(monkeypatch):
    monkeypatch.setattr(pc, "get_admin_client", lambda: object())
    monkeypatch.setattr(pc, "get_email_service", lambda: object())

    body = pc.EvidenceSendBody(mode="list", application_ids=["app-1", "app-2"], dry_run=True)
    out = asyncio.run(pc.send_evidence_requests(body, user={"user_id": "admin-1"}))
    assert out == {"mode": "list", "matched": 2, "dry_run": True, "sent": 0}


_EVIDENCE_ROW = {
    "token": "t", "application_id": "app-1", "needs_resume": False, "needs_linkedin": False,
    "needs_evidence": True, "is_preview": False, "used_at": None, "expires_at": "2999-01-01T00:00:00+00:00",
}


def test_evidence_upload_url_returns_signed_url(monkeypatch):
    monkeypatch.setattr(pc, "get_admin_client", lambda: _FakeAdminClient({"id": "app-1", "user_id": "u-1"}))
    monkeypatch.setattr(pc.svc, "fetch_token", lambda c, t: dict(_EVIDENCE_ROW))
    seen = {}

    def _mint(client, *, owner_user_id, filename, mime):
        seen.update(owner=owner_user_id, filename=filename, mime=mime)
        return {"path": f"{owner_user_id}/evidence/x.png", "signed_url": "https://sign", "token": "tk", "name": filename, "mime": mime}

    monkeypatch.setattr(pc.svc, "create_evidence_upload_url", _mint)
    out = asyncio.run(pc.evidence_upload_url("t", pc.EvidenceUploadUrlBody(filename="pic.png", mime="image/png")))
    assert out["signed_url"] == "https://sign" and out["path"] == "u-1/evidence/x.png"
    assert seen == {"owner": "u-1", "filename": "pic.png", "mime": "image/png"}


def test_evidence_finalize_registers_and_marks_used(monkeypatch):
    monkeypatch.setattr(pc, "get_admin_client", lambda: _FakeAdminClient({"id": "app-1", "user_id": "u-1"}))
    monkeypatch.setattr(pc.svc, "fetch_token", lambda c, t: dict(_EVIDENCE_ROW))
    seen = {}

    def _fin(client, *, application_id, owner_user_id, uploaded):
        seen.update(application_id=application_id, owner_user_id=owner_user_id, uploaded=uploaded)
        return {"added": len(uploaded), "pruned": 1, "kept": 0}

    monkeypatch.setattr(pc.svc, "finalize_evidence_submission", _fin)
    marked = {}
    monkeypatch.setattr(pc.svc, "mark_used", lambda c, t: marked.update(token=t))
    body = pc.EvidenceFinalizeBody(files=[pc.UploadedEvidenceFile(path="u-1/evidence/a.png", name="a.png", size=1000, mime="image/png")])
    out = asyncio.run(pc.evidence_finalize("t", body))
    assert out == {"ok": True, "saved": {"added": 1, "pruned": 1, "kept": 0}}
    assert seen["application_id"] == "app-1" and seen["owner_user_id"] == "u-1"
    assert seen["uploaded"][0]["path"] == "u-1/evidence/a.png"
    assert marked["token"] == "t"


def test_evidence_upload_url_rejects_preview(monkeypatch):
    preview = {"token": "t", "application_id": None, "needs_evidence": True, "is_preview": True,
               "used_at": None, "expires_at": "2999-01-01T00:00:00+00:00"}
    monkeypatch.setattr(pc, "get_admin_client", lambda: object())
    monkeypatch.setattr(pc.svc, "fetch_token", lambda c, t: preview)
    with pytest.raises(pc.HTTPException) as ei:
        asyncio.run(pc.evidence_upload_url("t", pc.EvidenceUploadUrlBody(filename="x.png", mime="image/png")))
    assert ei.value.status_code == 400
