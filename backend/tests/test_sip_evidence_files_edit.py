import io
import pytest
from app.deps import get_current_user
from app.main import app as fastapi_app
from app.routers import sip_evidence_files as sef

USER = "00000000-0000-0000-0000-0000000000aa"
APP_ID = "55555555-5555-5555-5555-555555555555"


@pytest.fixture(autouse=True)
def _auth():
    fastapi_app.dependency_overrides[get_current_user] = lambda: {"user_id": USER, "email": "a@b.com"}
    yield
    fastapi_app.dependency_overrides.clear()


@pytest.fixture
def fakes(monkeypatch):
    state = {"row": {"id": APP_ID, "user_id": USER, "status": "submitted",
                     "sip_pitch_deck": None, "sip_cap_table_file": None,
                     "sip_traction_files": [], "sip_patents_files": []},
             "marked": []}

    class _Store:
        def from_(self, *_): return self
        def upload(self, **k): return None
        def remove(self, paths): return None

    class _Tbl:
        def update(self, patch): state["row"].update(patch); return self
        def eq(self, *_): return self
        def execute(self):
            class R: data = [state["row"]]
            return R()

    class _Client:
        storage = _Store()
        def table(self, *_): return _Tbl()

    monkeypatch.setattr(sef, "get_admin_client", lambda: _Client())
    monkeypatch.setattr(sef.submitted_edit, "load_editable_app", lambda *a, **k: dict(state["row"]))
    monkeypatch.setattr(sef.submitted_edit, "mark_edited", lambda t, i, tr: state["marked"].append((i, tr)))
    return state


def test_upload_pitch_deck_to_submitted_app_marks_edited(client, fakes):
    res = client.post(
        f"/sip-applications/me/evidence-files?kind=pitch-deck&application_id={APP_ID}",
        files={"file": ("d.pdf", io.BytesIO(b"%PDF-1.4 data"), "application/pdf")},
    )
    assert res.status_code == 201
    assert fakes["marked"] == [(APP_ID, "sip")]


def test_upload_window_closed_403(client, fakes, monkeypatch):
    from app.services import submitted_edit as se
    def _raise(*a, **k): raise se.EditWindowError(403, "edit_window_closed", "closed")
    monkeypatch.setattr(sef.submitted_edit, "load_editable_app", _raise)
    res = client.post(
        f"/sip-applications/me/evidence-files?kind=pitch-deck&application_id={APP_ID}",
        files={"file": ("d.pdf", io.BytesIO(b"%PDF-1.4 data"), "application/pdf")},
    )
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "edit_window_closed"
