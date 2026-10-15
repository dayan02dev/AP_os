"""No-cost recovery of a failed memo's stored raw output, hermetic (fake Supabase/storage)."""
import json
from pathlib import Path

import pytest
from app.services.vip_memo_gen import openrouter, pipeline, store
from scripts import revalidate_vip_memo as rv

from tests.fixtures.fake_supabase import FakeSupabase

FAKE = Path(__file__).parent / "fixtures" / "vip_memo_v2_fake.json"
APP = "33333333-3333-3333-3333-333333333333"


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


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("model call made")

    monkeypatch.setattr(openrouter, "chat", boom)
    monkeypatch.setattr(pipeline.vip_memo_v2_export, "render", lambda memo, fmt: (b"x", "m/" + fmt))


def _failed(c, raw, raw_write=None, status="failed"):
    row = store.create_memo_version(c, APP, "sip", None)
    store.set_status(c, row["id"], status, "validation: x")
    store.save_raw_output(c, row["id"], raw, ["x"], raw_write=raw_write, source_files=["deck.pdf", "form"])
    return row["id"]


def _salvageable():
    d = json.loads(FAKE.read_text())
    del d["sections"]["tech"]
    return json.dumps(d)


def test_dry_run_reports_and_writes_nothing():
    c = Client()
    mid = _failed(c, _salvageable())
    before = json.dumps(c.tables, sort_keys=True, default=str)
    line = rv.revalidate(c, mid, apply=False)
    assert line.startswith(f"{mid} ok") and "dry-run" in line
    assert json.dumps(c.tables, sort_keys=True, default=str) == before
    assert c.storage.uploads == []


def test_apply_makes_ready_current_and_exports():
    c = Client()
    mid = _failed(c, _salvageable(), status="failed_budget")
    line = rv.revalidate(c, mid, apply=True)
    assert line.startswith(f"{mid} ready")
    row = store.get_memo(c, mid)
    assert row["status"] == "ready" and row["is_current"] is True
    assert row["error"].startswith("revalidated: ") and "sections.tech" in row["error"]
    assert row["memo_json"]["source_files"] == ["deck.pdf", "form"]
    assert "_raw" not in row["memo_json"]
    assert store.current_ready(c, APP)["id"] == mid
    assert len(c.storage.uploads) == 2 and c.tables["vip_memo_sections"]


def test_falls_back_to_first_write_output():
    c = Client()
    mid = _failed(c, "garbage repair output", raw_write=FAKE.read_text())
    assert rv.revalidate(c, mid, apply=True).startswith(f"{mid} ready")


def test_unrecoverable_raw_stays_failed():
    c = Client()
    mid = _failed(c, '{"name": ""}')
    line = rv.revalidate(c, mid, apply=True)
    assert line.startswith(f"{mid} - still invalid")
    assert store.get_memo(c, mid)["status"] == "failed"


def test_refuses_ready_or_rawless_rows():
    c = Client()
    row = store.create_memo_version(c, APP, "sip", None)
    store.set_status(c, row["id"], "failed")
    assert "no stored raw output" in rv.revalidate(c, row["id"], apply=True)
    store.set_status(c, row["id"], "ready")
    assert "not failed" in rv.revalidate(c, row["id"], apply=True)
    assert "not found" in rv.revalidate(c, "nope", apply=True)
