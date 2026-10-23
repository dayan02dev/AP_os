"""Orchestrates one queued vip_memos row into a stored, exported memo under a hard cost ceiling.

Logs carry ids and counts only; extracted file text and memo content are never logged.
"""
from __future__ import annotations

import base64
import logging

from app.services import vip_memo_v2_export
from app.services.vip_memo_gen import extract, market, openrouter, research, store, writer
from app.services.vip_memo_gen.budget import (
    Budget,
    BudgetExceeded,
    Deadline,
    estimate_cost,
    paid_call,
)
from app.services.vip_memo_gen.config import GenConfig, load_config
from app.services.vip_memo_gen.inputs import (
    FileRef,
    InputRecord,
    build_application_block,
    collect_files,
)
from app.services.vip_memo_gen.openrouter import ModelRefusal, OpenRouterError
from app.services.vip_memo_gen.prompts import TRANSCRIBE_PROMPT, render_writer_messages
from app.services.vip_memo_gen.schema import MemoValidationError

log = logging.getLogger(__name__)

TERMINAL = ("ready", "failed", "failed_budget")
APPLICATION_FORM = "VIP application form"
_TRANSCRIBE_MAX_TOKENS = 4000
_ERROR_CHARS = 500
_SALVAGE_NOTES = 10
_IMAGE_MIMES = ("image/png", "image/jpeg")


def _transcription_messages(ref: FileRef, data: bytes) -> list[dict]:
    uri = f"data:{ref.mime};base64,{base64.b64encode(data).decode()}"
    if ref.mime in _IMAGE_MIMES:
        part = {"type": "image_url", "image_url": {"url": uri}}
    else:
        part = {"type": "file", "file": {"filename": ref.filename, "file_data": uri}}
    return [{"role": "user", "content": [{"type": "text", "text": TRANSCRIBE_PROMPT}, part]}]


def _export(client, memo_id: str, application_id: str, memo: dict) -> None:
    """Best-effort: a failed export leaves the memo ready (download renders on the fly)."""
    for fmt in ("pdf", "docx"):
        try:
            data, media = vip_memo_v2_export.render(memo, fmt)
            path = f"{application_id}/{memo_id}.{fmt}"
            client.storage.from_(store.BUCKET).upload(
                path=path, file=data, file_options={"content-type": media, "upsert": "true"})
            store.record_export(client, memo_id, fmt, store.BUCKET, path, data)
        except Exception:
            log.warning("vip memo export failed", extra={"memo_id": memo_id, "fmt": fmt}, exc_info=True)


def salvage_error(notes: list[str], prefix: str = "salvaged") -> str | None:
    """The note kept in a ready row's ``error`` column: paths only, never values."""
    if not notes:
        return None
    return f"{prefix}: " + "; ".join(notes[:_SALVAGE_NOTES])[:_ERROR_CHARS]


class _Runs:
    """vip_memo_runs bookkeeping for budget.paid_call (provisional row, then settled)."""

    def __init__(self, client, memo_id: str):
        self.client, self.memo_id = client, memo_id

    def start(self, step, model, estimate_usd):
        return store.start_run(self.client, self.memo_id, step, model, estimate_usd)

    def finish(self, run_id, model, usage, duration_ms, ok, error):
        store.finish_run(self.client, run_id, model, usage, duration_ms, ok, error)


def generate(client, memo_id: str, cfg: GenConfig | None = None, *, final_attempt: bool = False,
             remaining_ms: int | None = None) -> str:
    """``remaining_ms``: Lambda time left (paid calls are not started too close to the end)."""
    cfg = cfg or load_config()
    deadline = Deadline(remaining_ms)
    row = store.get_memo(client, memo_id)
    if row is None:
        raise ValueError(f"vip memo {memo_id} not found")
    if row["status"] in TERMINAL:
        return row["status"]

    models = {"writer": cfg.writer_model, "research": cfg.research_model, "extract": cfg.extract_model}

    records: list[InputRecord] = []
    texts: list[tuple[FileRef, str]] = []
    state: dict = {"inputs_recorded": False, "source_files": None}

    def keep_raw(e: BaseException) -> None:
        """A paid writer output that did not become a memo is stored on the row, never lost."""
        raw = getattr(e, "raw", None)
        if raw is None:
            return
        try:
            store.save_raw_output(client, memo_id, raw, getattr(e, "messages", None) or [str(e)],
                                  raw_write=getattr(e, "raw_write", None),
                                  source_files=state["source_files"])
        except Exception:
            log.warning("vip memo raw output save failed", extra={"memo_id": memo_id}, exc_info=True)

    def finish(status: str, error: str | None = None) -> str:
        if not state["inputs_recorded"]:  # audit whatever was gathered before the failure
            state["inputs_recorded"] = True
            rest = [InputRecord(r.kind, r.bucket, r.path, r.mime, "none", 0, False, "not_used")
                    for r, _ in texts]
            try:
                store.record_inputs(client, memo_id, records + rest)
            except Exception:
                log.warning("vip memo input audit failed", extra={"memo_id": memo_id}, exc_info=True)
        store.set_status(client, memo_id, status, error)
        store.finalize_cost(client, memo_id, models)
        return status

    store.set_status(client, memo_id, "running")
    budget = Budget(cfg.max_cost_usd, store.spent_usd(client, memo_id))
    runs = _Runs(client, memo_id)

    try:
        track = row["native_track"]
        application_id = row["application_id"]
        res = client.table(f"{track}_applications").select("*").eq("id", application_id).limit(1).execute()
        rows = list(res.data or [])
        if not rows:
            return finish("failed", f"application not found in {track}_applications")
        app_row = rows[0]
        block = build_application_block(app_row, track)
        records.append(InputRecord("field", None, None, None, "form", len(block), False, None))

        methods: dict[str, str] = {}
        for ref in collect_files(client, app_row, track):
            try:
                data = client.storage.from_(ref.bucket).download(ref.path)
            except Exception:
                log.warning("vip memo input download failed", extra={"memo_id": memo_id}, exc_info=True)
                records.append(InputRecord(ref.kind, ref.bucket, ref.path, ref.mime, "none", 0, False,
                                           "download_error"))
                continue
            ex = extract.extract_any(data, ref.mime, ref.filename)
            text, method, skipped = ex.text, ex.method, ex.skipped_reason
            if ex.needs_transcription:
                messages = _transcription_messages(ref, data)
                try:
                    result = paid_call(
                        "extract", cfg.extract_model,
                        estimate_cost(cfg.extract_model, len(data), _TRANSCRIBE_MAX_TOKENS),
                        budget, runs, deadline,
                        lambda timeout, m=messages: openrouter.chat(
                            cfg.extract_model, m, max_tokens=_TRANSCRIBE_MAX_TOKENS, timeout=timeout))
                except BudgetExceeded:
                    skipped = "budget"
                except OpenRouterError:  # run row already settled as failed
                    skipped = "transcribe_error"
                else:
                    text, method, skipped = result.text, "transcribe", None
            # Contact details never reach a model (D6). Raw bytes sent for transcription
            # cannot be scrubbed; that is a recorded exception in spec section 5.3.
            text = extract.scrub_contacts(text)
            if text.strip() and not skipped:
                texts.append((ref, text))
                methods[ref.path] = method
            else:
                records.append(InputRecord(ref.kind, ref.bucket, ref.path, ref.mime, method, 0, False,
                                           skipped or "empty"))

        allocated = extract.budget_texts(texts, cfg.file_chars)
        for ref, used, truncated in allocated:
            records.append(InputRecord(ref.kind, ref.bucket, ref.path, ref.mime,
                                       methods[ref.path],
                                       len(used), truncated, None))
        state["inputs_recorded"] = True
        store.record_inputs(client, memo_id, records)
        # File names can carry contact details too (e.g. "MOU_name@mail.com.pdf").
        documents = [(extract.scrub_contacts(ref.filename), used) for ref, used, _ in allocated if used.strip()]

        found = research.run(research.profile_from_application(block, documents), cfg, budget, runs,
                             deadline)
        store.record_sources(client, memo_id, found.sources)

        # Only files whose text reached the writer, each name once.
        state["source_files"] = list(dict.fromkeys([name for name, _ in documents] + [APPLICATION_FORM]))
        notes: list[str] = []
        used: dict = {}
        try:
            memo = writer.write(render_writer_messages(block, documents, found.json_text), cfg, budget,
                                runs, deadline, notes=notes, used=used)
        finally:
            if used.get("writer"):
                models["writer_used"] = used["writer"]
        memo["source_files"] = state["source_files"]
        # Dedicated market research + rewrite under its own ceiling; best-effort, so a
        # failure keeps the writer's market section.
        try:
            refreshed = market.refresh(memo, block, cfg, market.new_budget(), runs, deadline)
        except Exception:
            log.warning("vip memo market refresh failed", extra={"memo_id": memo_id}, exc_info=True)
        else:
            memo = refreshed.memo
            store.record_sources(client, memo_id, refreshed.sources)
            notes += [f"market: {n}" for n in refreshed.notes]
        if notes:
            log.warning("vip memo salvaged", extra={"memo_id": memo_id, "notes": len(notes)})
        store.persist_memo(client, memo_id, memo, error=salvage_error(notes))
    except BudgetExceeded as e:
        keep_raw(e)
        return finish("failed_budget", str(e)[:_ERROR_CHARS])
    except (MemoValidationError, OpenRouterError) as e:  # OpenRouter run rows are settled by paid_call
        keep_raw(e)
        if isinstance(e, ModelRefusal):
            return finish("failed", str(e)[:_ERROR_CHARS])
        return finish("failed", f"{type(e).__name__}: {e}"[:_ERROR_CHARS])
    except Exception as e:  # includes DeadlineExceeded
        keep_raw(e)
        if not final_attempt:
            raise  # SQS retries; the memo stays running until then
        log.error("vip memo failed on final attempt", extra={"memo_id": memo_id}, exc_info=True)
        return finish("failed", f"{type(e).__name__}: {e}"[:_ERROR_CHARS])

    store.finalize_cost(client, memo_id, models)
    _export(client, memo_id, application_id, memo)
    return "ready"
