import pytest
from app.services import submitted_edit as se


class _FakeTable:
    def __init__(self, row): self._row = row
    def select(self, *_): return self
    def eq(self, *_): return self
    def limit(self, *_): return self
    def update(self, patch): self._row.update(patch); return self
    def execute(self):
        class R: data = [self._row] if self._row else []
        return R()


class _FakeClient:
    def __init__(self, row): self._t = _FakeTable(row)
    def table(self, *_): return self._t


def _patch_client(monkeypatch, row):
    monkeypatch.setattr(se, "get_admin_client", lambda: _FakeClient(row))


def test_load_editable_app_ok(monkeypatch):
    row = {"id": "a1", "user_id": "u1", "status": "submitted"}
    _patch_client(monkeypatch, row)
    monkeypatch.setattr(se, "is_edit_open", lambda track: True)
    got = se.load_editable_app("tir_applications", "a1", "u1", "id, user_id, status")
    assert got["id"] == "a1"


def test_load_editable_app_wrong_owner_404(monkeypatch):
    _patch_client(monkeypatch, {"id": "a1", "user_id": "other", "status": "submitted"})
    monkeypatch.setattr(se, "is_edit_open", lambda track: True)
    with pytest.raises(se.EditWindowError) as e:
        se.load_editable_app("tir_applications", "a1", "u1", "id, user_id, status")
    assert e.value.status_code == 404


def test_load_editable_app_bad_status_409(monkeypatch):
    _patch_client(monkeypatch, {"id": "a1", "user_id": "u1", "status": "draft"})
    monkeypatch.setattr(se, "is_edit_open", lambda track: True)
    with pytest.raises(se.EditWindowError) as e:
        se.load_editable_app("tir_applications", "a1", "u1", "id, user_id, status")
    assert e.value.status_code == 409


def test_load_editable_app_window_closed_403(monkeypatch):
    _patch_client(monkeypatch, {"id": "a1", "user_id": "u1", "status": "submitted"})
    monkeypatch.setattr(se, "is_edit_open", lambda track: False)
    with pytest.raises(se.EditWindowError) as e:
        se.load_editable_app("sip_applications", "a1", "u1", "id, user_id, status")
    assert e.value.status_code == 403


def test_mark_edited_stamps_and_publishes(monkeypatch):
    row = {"id": "a1"}
    _patch_client(monkeypatch, row)
    published = []
    monkeypatch.setattr(se.sqs_publisher, "publish", lambda i, t: published.append((i, t)))
    se.mark_edited("tir_applications", "a1", "tir")
    assert row["edited_after_submit"] is True
    assert row["last_edited_at"] is not None
    assert published == [("a1", "tir")]
