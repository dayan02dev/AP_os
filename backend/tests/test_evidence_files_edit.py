import io
import pytest
from app.deps import get_current_user
from app.main import app as fastapi_app
from app.routers import evidence_files as ef

USER = "00000000-0000-0000-0000-0000000000aa"
APP_ID = "33333333-3333-3333-3333-333333333333"


@pytest.fixture(autouse=True)
def _auth():
    fastapi_app.dependency_overrides[get_current_user] = lambda: {"user_id": USER, "email": "a@b.com"}
    yield
    fastapi_app.dependency_overrides.clear()


@pytest.fixture
def fakes(monkeypatch):
    state = {"row": {"id": APP_ID, "user_id": USER, "status": "submitted", "evidence_files": []},
             "marked": [], "uploaded": [], "updated": []}

    class _Store:
        def from_(self, *_): return self
        def upload(self, **k): state["uploaded"].append(k); return None
        def remove(self, paths): return None

    class _Tbl:
        def update(self, patch): state["row"].update(patch); state["updated"].append(patch); return self
        def eq(self, *_): return self
        def execute(self):
            class R: data = [state["row"]]
            return R()

    class _Client:
        storage = _Store()
        def table(self, *_): return _Tbl()

    monkeypatch.setattr(ef, "get_admin_client", lambda: _Client())
    monkeypatch.setattr(ef.submitted_edit, "load_editable_app", lambda *a, **k: dict(state["row"]))
    monkeypatch.setattr(ef.submitted_edit, "mark_edited", lambda t, i, tr: state["marked"].append((i, tr)))
    return state


def test_upload_to_submitted_app_marks_edited(client, fakes):
    res = client.post(
        f"/applications/me/evidence-files?application_id={APP_ID}",
        files={"file": ("e.pdf", io.BytesIO(b"%PDF-1.4 data"), "application/pdf")},
    )
    assert res.status_code == 201
    assert fakes["marked"] == [(APP_ID, "tir")]


def test_upload_window_closed_403(client, fakes, monkeypatch):
    from app.services import submitted_edit as se
    def _raise(*a, **k): raise se.EditWindowError(403, "edit_window_closed", "closed")
    monkeypatch.setattr(ef.submitted_edit, "load_editable_app", _raise)
    res = client.post(
        f"/applications/me/evidence-files?application_id={APP_ID}",
        files={"file": ("e.pdf", io.BytesIO(b"%PDF-1.4 data"), "application/pdf")},
    )
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "edit_window_closed"
