"""Pipeline orchestrator + SQS worker, hermetic (fake Supabase, fake OpenRouter, fake storage)."""
import json
from pathlib import Path

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
    log = {"calls": [], "writer_cost": 0.3, "fail_writer": None, "writer_texts": []}

    def fake(model, messages, **kw):
        log["calls"].append({"model": model, "messages": messages, **kw})
        if model == CFG.research_model:
            return _res(json.dumps({"market": [], "competitors": []}), 0.1, model)
        if model == CFG.extract_model:
            return _res("TRANSCRIBED DECK TEXT", 0.01, model)
        if log["fail_writer"]:
            raise log["fail_writer"]
        if log["writer_texts"]:
            return _res(log["writer_texts"].pop(0), log["writer_cost"], model)
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
    form, notes = c.tables["vip_memo_inputs"]
    assert (form["kind"], form["method"], form["path"]) == ("field", "form", None)
    assert form["chars_used"] > 0
    assert notes["chars_used"] == len("founder notes text")
    assert all(r["ok"] is True for r in c.tables["vip_memo_runs"])  # no run left pending


def test_generates_with_no_files(chat, monkeypatch):
    c, mid = _client()
    _files(monkeypatch, [])
    assert pipeline.generate(c, mid, CFG) == "ready"
    assert store.get_memo(c, mid)["memo_json"]["source_files"] == ["VIP application form"]
    assert [r["kind"] for r in c.tables["vip_memo_inputs"]] == ["field"]


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
    assert c.tables["vip_memo_inputs"][1]["skipped_reason"] == "budget"


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

    def fake_generate(client, memo_id, cfg=None, *, final_attempt=False, remaining_ms=None):
        seen.append(memo_id)
        if memo_id == "bad":
            raise RuntimeError("db down")
        return "failed_budget" if memo_id == "over" else "ready"

    monkeypatch.setattr(handler, "generate", fake_generate)
    monkeypatch.setattr(handler, "get_admin_client", lambda: object())
    def rec(i, mid):
        return {"messageId": i, "body": json.dumps({"memo_id": mid})}

    out = handler.lambda_handler({"Records": [rec("1", "ok"), rec("2", "bad"), rec("3", "over"),
                                              {"messageId": "4", "body": "not json"}]}, None)
    assert out == {"batchItemFailures": [{"itemIdentifier": "2"}, {"itemIdentifier": "4"}]}
    assert seen == ["ok", "bad", "over"]


def _boom_writer(monkeypatch):
    from app.services.vip_memo_gen import writer

    def boom(*a, **k):
        raise KeyError("unexpected")

    monkeypatch.setattr(writer, "write", boom)


def test_unexpected_error_non_final_stays_running_and_reraises(chat, monkeypatch):
    c, mid = _client()
    _files(monkeypatch, [])
    _boom_writer(monkeypatch)
    with pytest.raises(KeyError):
        pipeline.generate(c, mid, CFG)
    assert store.get_memo(c, mid)["status"] == "running"


def test_unexpected_error_final_attempt_fails_and_finalizes(chat, monkeypatch):
    c, mid = _client()
    _files(monkeypatch, [])
    _boom_writer(monkeypatch)
    assert pipeline.generate(c, mid, CFG, final_attempt=True) == "failed"
    row = store.get_memo(c, mid)
    assert row["status"] == "failed" and row["error"].startswith("KeyError")
    assert row["cost_usd"] == pytest.approx(0.1)


def test_handler_final_attempt_by_receive_count(chat, monkeypatch):
    from workers.vip_memo import handler

    c, mid = _client()
    _files(monkeypatch, [])
    _boom_writer(monkeypatch)
    monkeypatch.setattr(handler, "get_admin_client", lambda: c)
    def rec(n):
        return {"messageId": "m", "body": json.dumps({"memo_id": mid}),
                "attributes": {"ApproximateReceiveCount": str(n)}}

    assert handler.lambda_handler({"Records": [rec(1)]}, None) == {"batchItemFailures": [{"itemIdentifier": "m"}]}
    assert store.get_memo(c, mid)["status"] == "running"
    assert handler.lambda_handler({"Records": [rec(2)]}, None) == {"batchItemFailures": []}
    assert store.get_memo(c, mid)["status"] == "failed"


def test_app_not_found_is_terminal_failed(chat):
    c = Client({})
    mid = store.create_memo_version(c, APP, "sip", None)["id"]
    assert pipeline.generate(c, mid, CFG) == "failed"
    row = store.get_memo(c, mid)
    assert row["status"] == "failed" and "not found" in row["error"] and row["cost_usd"] == 0


def test_transcription_error_skips_file_and_continues(chat, monkeypatch):
    c, mid = _client(blobs={("b", "d.png"): b"x"})
    _files(monkeypatch, [FileRef("b", "d.png", "deck.png", "image/png", "deck")])
    orig = openrouter.chat

    def flaky(model, messages, **kw):
        if model == CFG.extract_model:
            raise OpenRouterError("timeout")
        return orig(model, messages, **kw)

    monkeypatch.setattr(openrouter, "chat", flaky)
    assert pipeline.generate(c, mid, CFG) == "ready"
    assert c.tables["vip_memo_inputs"][1]["skipped_reason"] == "transcribe_error"
    bad = [r for r in c.tables["vip_memo_runs"] if not r["ok"]]
    assert bad and bad[0]["step"] == "extract"


def test_inputs_recorded_on_failed_budget(chat, monkeypatch):
    c, mid = _client(blobs={("b", "n.txt"): b"notes"})
    _files(monkeypatch, [FileRef("b", "n.txt", "notes.txt", "text/plain", "traction")])
    store.record_run(c, mid, "write", CFG.writer_model, Usage(cost_usd=0.99), 1, True, None)
    assert pipeline.generate(c, mid, CFG) == "failed_budget"
    assert [r["kind"] for r in c.tables["vip_memo_inputs"]] == ["field", "traction"]


def test_killed_call_counts_at_estimate_on_redelivery(chat, monkeypatch):
    """Invocation dies inside the writer call: the pending row keeps its estimate."""
    from app.services.vip_memo_gen import budget as budget_mod

    c, mid = _client()
    _files(monkeypatch, [])
    orig = openrouter.chat

    class Killed(BaseException):  # stands in for the Lambda being frozen mid-request
        pass

    def dies(model, messages, **kw):
        if model == CFG.writer_model:
            raise Killed()
        return orig(model, messages, **kw)

    monkeypatch.setattr(openrouter, "chat", dies)
    with pytest.raises(Killed):
        pipeline.generate(c, mid, CFG)
    pending = [r for r in c.tables["vip_memo_runs"] if r["ok"] is None]
    assert len(pending) == 1 and pending[0]["step"] == "write" and pending[0]["cost_usd"] > 0
    estimate = pending[0]["cost_usd"]
    assert store.spent_usd(c, mid) == pytest.approx(0.1 + estimate)

    # Redelivery: the budget starts from research + the writer estimate.
    seen = {}
    real_budget = budget_mod.Budget

    def spy(ceiling, spent=0.0):
        seen["spent"] = spent
        return real_budget(ceiling, spent)

    monkeypatch.setattr(pipeline, "Budget", spy)
    monkeypatch.setattr(openrouter, "chat", orig)
    status = pipeline.generate(c, mid, CFG)
    assert seen["spent"] == pytest.approx(0.1 + estimate)
    assert status in ("ready", "failed_budget")
    assert store.get_memo(c, mid)["cost_usd"] >= 0.1 + estimate


def test_deadline_guard_skips_paid_calls_and_retries(chat, monkeypatch):
    c, mid = _client()
    _files(monkeypatch, [])
    from app.services.vip_memo_gen.budget import DeadlineExceeded

    with pytest.raises(DeadlineExceeded):
        pipeline.generate(c, mid, CFG, remaining_ms=100_000)
    assert chat["calls"] == [] and not c.tables.get("vip_memo_runs")
    assert store.get_memo(c, mid)["status"] == "running"
    assert pipeline.generate(c, mid, CFG, final_attempt=True, remaining_ms=100_000) == "failed"
    assert store.get_memo(c, mid)["error"].startswith("DeadlineExceeded")


def test_call_timeout_follows_remaining_time(chat, monkeypatch):
    c, mid = _client()
    _files(monkeypatch, [])
    assert pipeline.generate(c, mid, CFG, remaining_ms=400_000) == "ready"
    timeouts = [x["timeout"] for x in chat["calls"]]
    assert timeouts and all(t <= 400 - 45 for t in timeouts)
    c2, mid2 = _client()
    chat["calls"].clear()
    assert pipeline.generate(c2, mid2, CFG) == "ready"
    assert all(x["timeout"] == 600 for x in chat["calls"])


def test_handler_passes_remaining_time(monkeypatch):
    from workers.vip_memo import handler

    seen = {}

    def fake_generate(client, memo_id, cfg=None, *, final_attempt=False, remaining_ms=None):
        seen["remaining_ms"] = remaining_ms
        return "ready"

    class Ctx:
        def get_remaining_time_in_millis(self):
            return 890_000

    monkeypatch.setattr(handler, "generate", fake_generate)
    monkeypatch.setattr(handler, "get_admin_client", lambda: object())
    handler.lambda_handler({"Records": [{"messageId": "1", "body": json.dumps({"memo_id": "x"})}]}, Ctx())
    assert seen["remaining_ms"] == 890_000


def test_document_contacts_scrubbed_before_writer(chat, monkeypatch):
    c, mid = _client(blobs={("b", "n.txt"): b"Reach me at ceo@acme.in or +91 98765 43210. TRL 6, 2024."})
    _files(monkeypatch, [FileRef("b", "n.txt", "notes.txt", "text/plain", "traction")])
    assert pipeline.generate(c, mid, CFG) == "ready"
    sent = json.dumps([x["messages"] for x in chat["calls"]])
    assert "ceo@acme.in" not in sent and "98765" not in sent
    assert "[email removed]" in sent and "[phone removed]" in sent and "TRL 6, 2024." in sent


def test_transcribed_text_scrubbed(chat, monkeypatch):
    c, mid = _client(blobs={("b", "d.png"): b"x"})
    _files(monkeypatch, [FileRef("b", "d.png", "deck.png", "image/png", "deck")])
    orig = openrouter.chat

    def ocr(model, messages, **kw):
        if model == CFG.extract_model:
            orig(model, messages, **kw)
            return _res("Contact: founder@x.io, 9876543210", 0.01, model)
        return orig(model, messages, **kw)

    monkeypatch.setattr(openrouter, "chat", ocr)
    assert pipeline.generate(c, mid, CFG) == "ready"
    writer_msgs = json.dumps([x["messages"] for x in chat["calls"] if x["model"] == CFG.writer_model])
    assert "founder@x.io" not in writer_msgs and "9876543210" not in writer_msgs


def _salvageable() -> str:
    d = json.loads(FAKE.read_text())
    del d["sections"]["tech"]
    d["headline"] = 7
    return json.dumps(d)


def test_salvaged_memo_is_ready_with_note(chat, monkeypatch):
    c, mid = _client()
    _files(monkeypatch, [])
    chat["writer_texts"] = [_salvageable()]
    assert pipeline.generate(c, mid, CFG) == "ready"
    row = store.get_memo(c, mid)
    assert row["status"] == "ready" and row["is_current"] is True
    assert row["error"].startswith("salvaged: ") and "sections.tech" in row["error"]
    assert "7" not in row["error"].replace("salvaged", "")
    assert [r["step"] for r in c.tables["vip_memo_runs"]].count("write") == 1
    assert "repair" not in [r["step"] for r in c.tables["vip_memo_runs"]]


def test_clean_memo_has_no_error(chat, monkeypatch):
    c, mid = _client()
    _files(monkeypatch, [])
    assert pipeline.generate(c, mid, CFG) == "ready"
    assert store.get_memo(c, mid)["error"] is None


def test_failed_memo_keeps_raw_output_and_is_not_served(chat, monkeypatch):
    c, mid = _client(blobs={("b", "n.txt"): b"notes"})
    _files(monkeypatch, [FileRef("b", "n.txt", "notes.txt", "text/plain", "traction")])
    chat["writer_texts"] = ['{"name": "", "headline": "W"}', '{"name": "", "headline": "R"}']
    chat["writer_cost"] = 0.05
    assert pipeline.generate(c, mid, CFG) == "failed"
    row = store.get_memo(c, mid)
    assert row["status"] == "failed" and row["is_current"] is False
    mj = row["memo_json"]
    assert '"R"' in mj["_raw"] and '"W"' in mj["_raw_write"] and mj["_errors"]
    assert mj["_source_files"] == ["notes.txt", "VIP application form"]
    assert store.current_ready(c, APP) is None


def test_repair_over_budget_keeps_raw_output(chat, monkeypatch):
    c, mid = _client()
    _files(monkeypatch, [])
    chat["writer_texts"] = ['{"name": "", "headline": "W"}']
    chat["writer_cost"] = 0.6  # leaves too little for the repair estimate
    assert pipeline.generate(c, mid, CFG) == "failed_budget"
    row = store.get_memo(c, mid)
    assert row["status"] == "failed_budget" and '"W"' in row["memo_json"]["_raw"]
    assert store.current_ready(c, APP) is None


def test_source_files_only_used_files_deduped_and_scrubbed(chat, monkeypatch):
    c, mid = _client(blobs={
        ("b", "bad.pdf"): b"not a pdf at all",
        ("b", "n1.txt"): b"first notes",
        ("b", "n2.txt"): b"second notes",
        ("b", "m.txt"): b"mou text",
    })
    _files(monkeypatch, [
        FileRef("b", "bad.pdf", "broken_deck.pdf", "application/pdf", "deck"),
        FileRef("b", "n1.txt", "notes.txt", "text/plain", "traction"),
        FileRef("b", "n2.txt", "notes.txt", "text/plain", "traction"),
        FileRef("b", "m.txt", "MOU_ceo@acme.in_signed.txt", "text/plain", "other"),
    ])
    assert pipeline.generate(c, mid, CFG) == "ready"
    files = store.get_memo(c, mid)["memo_json"]["source_files"]
    assert len(files) == 3 and files[0] == "notes.txt" and files[2] == "VIP application form"
    assert "[email removed]" in files[1] and "@" not in files[1]
    sent = json.dumps([x["messages"] for x in chat["calls"]])
    assert "ceo@acme.in" not in sent
    bad = next(r for r in c.tables["vip_memo_inputs"] if r["path"] == "bad.pdf")
    assert bad["skipped_reason"] == "extract_error"
