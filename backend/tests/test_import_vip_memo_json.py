"""Import script for existing memo JSON, hermetic (fake Supabase, fake storage)."""
import shutil
from pathlib import Path

import pytest

from app.services.vip_memo_gen import pipeline
from scripts import import_vip_memo_json as imp
from tests.fixtures.fake_supabase import FakeSupabase

FAKE = Path(__file__).parent / "fixtures" / "vip_memo_v2_fake.json"
APP = "22222222-2222-2222-2222-222222222222"


class _Bucket:
    def __init__(self, ups):
        self.ups = ups

    def upload(self, path, file, file_options=None):
        self.ups.append(path)


class _Storage:
    def __init__(self):
        self.uploads = []

    def from_(self, _name):
        return _Bucket(self.uploads)


class Client(FakeSupabase):
    def __init__(self, tables=None):
        super().__init__(tables)
        self.storage = _Storage()


@pytest.fixture
def memo_file(tmp_path, monkeypatch):
    monkeypatch.setattr(pipeline.vip_memo_v2_export, "render", lambda memo, fmt: (b"x", "m/" + fmt))
    p = tmp_path / f"{APP}.json"
    shutil.copy(FAKE, p)
    return p


def test_dry_run_writes_nothing(memo_file, capsys):
    c = Client({"sip_applications": [{"id": APP}]})
    line = imp.import_file(c, memo_file, apply=False)
    assert line.startswith(APP)
    assert c.tables.get("vip_memos", []) == []
    assert c.storage.uploads == []


def test_apply_creates_ready_current_memo(memo_file):
    c = Client({"sip_applications": [{"id": APP}]})
    line = imp.import_file(c, memo_file, apply=True)
    assert line == f"{APP} 1 ready"
    (m,) = c.tables["vip_memos"]
    assert (m["status"], m["is_current"], m["triggered_by"], m["native_track"]) == (
        "ready", True, "import", "sip")
    assert c.tables["vip_memo_sections"]
    assert len(c.storage.uploads) == 2


def test_moved_tir_app_resolves_tir_and_unknown_errors(memo_file):
    c = Client({"tir_applications": [{"id": APP, "moved_to_track": "sip"}]})
    assert imp.resolve_native_track(c, APP) == "tir"
    with pytest.raises(ValueError):
        imp.import_file(Client(), memo_file, apply=True)
