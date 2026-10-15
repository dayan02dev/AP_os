"""Pipeline orchestrator + SQS worker, hermetic (fake Supabase, fake OpenRouter, fake storage)."""
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.services.vip_memo_gen import openrouter, pipeline, store
from app.services.vip_memo_gen.config import load_config
from app.services.vip_memo_gen.inputs import FileRef
from app.services.vip_memo_gen.openrouter import LlmResult, OpenRouterError, Usage
from tests.fixtures.fake_supabase import FakeSupabase

FAKE = Path(__file__).parent / "fixtures" / "vip_memo_v2_fake.json"
APP = "11111111-1111-1111-1111-111111111111"
CFG = load_config()


class _Bucket:
    def __init__(self, parent, name):
        self.p, self.name = parent, name

    def download(self, path):
        return self.p.blobs[(self.name, path)]

    def upload(self, path, file, file_options=None):
        self.p.uploads[(self.name, path)] = (file, file_options)


class _Storage:
    def __init__(self, blobs):
        self.blobs, self.uploads = blobs, {}

    def from_(self, name):
        return _Bucket(self, name)


class Client(FakeSupabase):
    def __init__(self, tables=None, blobs=None):
        super().__init__(tables)
        self.storage = _Storage(blobs or {})


def _res(text, cost=0.05, model="m"):
    return LlmResult(text, [], Usage(input_tokens=1, output_tokens=1, cost_usd=cost), model)


@pytest.fixture
def chat(monkeypatch):
    log = {"calls": [], "writer_cost": 0.3, "fail_writer": None}

    def fake(model, messages, **kw):
        log["calls"].append({"model": model, "messages": messages, **kw})
        if model == CFG.research_model:
            return _res(json.dumps({"market": [], "competitors": []}), 0.1, model)
        if model == CFG.extract_model:
            return _res("TRANSCRIBED DECK TEXT", 0.01, model)
        if log["fail_writer"]:
            raise log["fail_writer"]
        return _res(FAKE.read_text(), log["writer_cost"], model)

    monkeypatch.setattr(openrouter, "chat", fake)
    return log


def _blank_pdf() -> bytes:
    import io
    from pypdf import PdfWriter
    w = PdfWriter()
    w.add_blank_page(width=200, height=200)
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


def _client(files=None, blobs=None):
    c = Client({"sip_applications": [{"id": APP, "user_id": None, "status": "submitted",
                                      "basic_organisation": "Acme"}]}, blobs)
    memo = store.create_memo_version(c, APP, "sip", None)
    return c, memo["id"]


def _files(monkeypatch, refs):
    monkeypatch.setattr(pipeline, "collect_files", lambda client, row, track: refs)


def test_happy_path_ready_with_exports(chat, monkeypatch):
    c, mid = _client(blobs={("b", "n.txt"): b"founder notes text"})
    _files(monkeypatch, [FileRef("b", "n.txt", "notes.txt", "text/plain", "traction")])
    assert pipeline.generate(c, mid, CFG) == "ready"
    row = store.get_memo(c, mid)
    assert row["status"] == "ready" and row["is_current"] is True
    assert row["memo_json"]["source_files"] == ["notes.txt", "VIP application form"]
    exports = c.tables["vip_memo_exports"]
    assert sorted(e["format"] for e in exports) == ["docx", "pdf"]
    assert {p for (_, p) in c.storage.uploads} == {f"{APP}/{mid}.pdf", f"{APP}/{mid}.docx"}
    assert all(o[1]["upsert"] == "true" for o in c.storage.uploads.values())
    steps = [r["step"] for r in c.tables["vip_memo_runs"]]
    assert "research" in steps and "write" in steps
    assert 0 < row["cost_usd"] <= 1.0
    assert row["models"]["writer"] == CFG.writer_model
    assert c.tables["vip_memo_inputs"][0]["chars_used"] == len("founder notes text")


def test_generates_with_no_files(chat, monkeypatch):
    c, mid = _client()
    _files(monkeypatch, [])
    assert pipeline.generate(c, mid, CFG) == "ready"
    assert store.get_memo(c, mid)["memo_json"]["source_files"] == ["VIP application form"]
    assert not c.tables.get("vip_memo_inputs")


def test_redelivery_respects_prior_spend(chat, monkeypatch):
    c, mid = _client()
    _files(monkeypatch, [])
    store.record_run(c, mid, "write", CFG.writer_model, Usage(cost_usd=0.99), 1, True, None)
    assert pipeline.generate(c, mid, CFG) == "failed_budget"
    assert chat["calls"] == []
    row = store.get_memo(c, mid)
    assert row["status"] == "failed_budget" and row["cost_usd"] == pytest.approx(0.99)


def test_ready_memo_is_noop(chat):
    c, mid = _client()
    store.set_status(c, mid, "ready")
    assert pipeline.generate(c, mid, CFG) == "ready"
    assert chat["calls"] == [] and not c.tables.get("vip_memo_runs")


def test_scanned_deck_transcribed_via_extract_model(chat, monkeypatch):
    c, mid = _client(blobs={("b", "d.png"): b"\x89PNGfake"})
    _files(monkeypatch, [FileRef("b", "d.png", "deck.png", "image/png", "deck")])
    assert pipeline.generate(c, mid, CFG) == "ready"
    ext = [x for x in chat["calls"] if x["model"] == CFG.extract_model]
    assert len(ext) == 1
    part = ext[0]["messages"][0]["content"]
    assert part[1]["type"] == "image_url" and part[1]["image_url"]["url"].startswith("data:image/png;base64,")
    writer_call = [x for x in chat["calls"] if x["model"] == CFG.writer_model][0]
    assert "TRANSCRIBED DECK TEXT" in writer_call["messages"][1]["content"]
    assert "extract" in [r["step"] for r in c.tables["vip_memo_runs"]]
    assert store.get_memo(c, mid)["memo_json"]["source_files"] == ["deck.png", "VIP application form"]


def test_pdf_transcription_uses_file_part_and_budget_skip(chat, monkeypatch):
    c, mid = _client(blobs={("b", "d.pdf"): _blank_pdf()})
    _files(monkeypatch, [FileRef("b", "d.pdf", "deck.pdf", "application/pdf", "deck")])
    store.record_run(c, mid, "x", "m", Usage(cost_usd=0.999999), 1, True, None)
    assert pipeline.generate(c, mid, CFG) == "failed_budget"
    assert not [x for x in chat["calls"] if x["model"] == CFG.extract_model]
    assert c.tables["vip_memo_inputs"][0]["skipped_reason"] == "budget"


def test_pdf_file_part_shape(chat, monkeypatch):
    c, mid = _client(blobs={("b", "d.pdf"): _blank_pdf()})
    _files(monkeypatch, [FileRef("b", "d.pdf", "deck.pdf", "application/pdf", "deck")])
    pipeline.generate(c, mid, CFG)
    part = [x for x in chat["calls"] if x["model"] == CFG.extract_model][0]["messages"][0]["content"][1]
    assert part["type"] == "file" and part["file"]["filename"] == "deck.pdf"
    assert part["file"]["file_data"].startswith("data:application/pdf;base64,")


def test_openrouter_error_fails_and_records_zero_usage_run(chat, monkeypatch):
    c, mid = _client()
    _files(monkeypatch, [])
    chat["fail_writer"] = OpenRouterError("boom " + "x" * 800)
    assert pipeline.generate(c, mid, CFG) == "failed"
    row = store.get_memo(c, mid)
    assert row["status"] == "failed" and len(row["error"]) <= 500
    bad = [r for r in c.tables["vip_memo_runs"] if not r["ok"]]
    assert bad and bad[0]["cost_usd"] == 0 and "boom" in bad[0]["error"]
    assert row["cost_usd"] == pytest.approx(0.1)


def test_export_failure_leaves_memo_ready(chat, monkeypatch):
    c, mid = _client()
    _files(monkeypatch, [])

    def boom(*a, **k):
        raise RuntimeError("render down")

    monkeypatch.setattr(pipeline.vip_memo_v2_export, "render", boom)
    assert pipeline.generate(c, mid, CFG) == "ready"
    assert not c.tables.get("vip_memo_exports")


def test_nothing_written_to_ai_screening(chat, monkeypatch):
    c, mid = _client()
    _files(monkeypatch, [])
    pipeline.generate(c, mid, CFG)
    assert not c.tables.get("ai_screening")
    assert c.tables["sip_applications"][0]["status"] == "submitted"


def test_handler_reports_only_unexpected_failures(monkeypatch):
    from workers.vip_memo import handler

    seen = []

    def fake_generate(client, memo_id, cfg=None):
        seen.append(memo_id)
        if memo_id == "bad":
            raise RuntimeError("db down")
        return "failed_budget" if memo_id == "over" else "ready"

    monkeypatch.setattr(handler, "generate", fake_generate)
    monkeypatch.setattr(handler, "get_admin_client", lambda: object())
    rec = lambda i, mid: {"messageId": i, "body": json.dumps({"memo_id": mid})}
    out = handler.lambda_handler({"Records": [rec("1", "ok"), rec("2", "bad"), rec("3", "over"),
                                              {"messageId": "4", "body": "not json"}]}, None)
    assert out == {"batchItemFailures": [{"itemIdentifier": "2"}, {"itemIdentifier": "4"}]}
    assert seen == ["ok", "bad", "over"]
