# AI 4-Section Analyst Blocks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate four standardized AI analyst sections (Problem / Solution / Moats & Technology Edge / Watch-outs) — each 3–5 bullet "pointers" — per TIR & VIP application via `gemini-2.5-flash`, and show the identical content in the Leadership AppDrawer, Reviewer eval, and Admin detail surfaces.

**Architecture:** A new `SectionAgent` (same OpenRouter/BaseAgent path as the scoring/summary agents) runs as a 4th pipeline stage on every submit/edit/admin-rerun; a backfill script fills all existing apps. Output is stored in one new `ai_screening.sections JSONB` column and surfaced through each portal's existing detail payload. A single shared React `AiSections` component renders it in two variants (leadership sub-headed blocks; reviewer/admin responsive dropdowns).

**Tech Stack:** Python 3.11 / FastAPI / Supabase (PostgREST) / pytest · React + Vite / vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-07-01-ai-4-sections-design.md`

---

## Prerequisites & conventions

- **Worktree:** implement in an isolated worktree off `release/sip-launch-v1` (current tip `f414bdf`). Create it via `superpowers:using-git-worktrees` at execution start. Never edit the stale primary checkout for code; never deploy from a shared checkout (SAM reads disk).
- **Migration 028** (`ALTER TABLE ai_screening ADD COLUMN sections jsonb`) is **already applied to PROD** and the file exists at `backend/migrations/028_ai_sections.sql`. It still needs applying to **staging** before staging deploy (Task 12).
- **Backend tests:** `cd backend && source .venv/bin/activate && pytest <path> --no-cov -v` — `--no-cov` is required for single-file runs (repo has a coverage gate that fails partial runs).
- **Frontend tests:** `cd frontend && npx vitest run <path>`.
- **Commits:** author = user only (no `Co-Authored-By` / AI trailer). Commit after each task's tests pass.
- All paths below are relative to the worktree root.

---

## Phase 1 — Backend generation

### Task 1: Section prompt files

**Files:**
- Create: `backend/app/services/ai_pipeline/section_prompts/problem.txt`
- Create: `backend/app/services/ai_pipeline/section_prompts/solution.txt`
- Create: `backend/app/services/ai_pipeline/section_prompts/moats.txt`
- Create: `backend/app/services/ai_pipeline/section_prompts/watchouts.txt`

- [ ] **Step 1: Create `problem.txt`** with exactly this content:

```
You are a forensic deeptech analyst and investment evaluator. Analyze the provided startup application text and output the Problem Description as 3 to 5 concise bullet points and nothing else. Do not include any introductory sentences, headers, markdown tags, labels, or transitional filler. Each bullet must be on its own line, begin with "- ", and be at most ~30 words. Focus entirely on the physical, biological, or architectural engineering bottleneck being targeted: the exact scientific or industry choke point (thermal limits, latency constraints, material degradation, system yield losses, etc.) and the absolute economic or strategic severity of leaving it unsolved. State the problem directly, with no setup.
```

- [ ] **Step 2: Create `solution.txt`** with exactly this content:

```
You are a forensic deeptech analyst and investment evaluator. Analyze the provided startup application text and output the Solution Description as 3 to 5 concise bullet points and nothing else. Do not include any introductory sentences, headers, markdown tags, labels, or transitional filler. Each bullet must be on its own line, begin with "- ", and be at most ~30 words. Explain precisely how the technology works across hardware, software, custom algorithms, or advanced materials; state the current validated baseline Technology Readiness Level (TRL); and explain how the architecture creates a 10x performance step-change or operational advantage over legacy incumbents. If information is missing or vague, name the missing architectural elements as bullets.
```

- [ ] **Step 3: Create `moats.txt`** with exactly this content:

```
You are a forensic deeptech analyst and investment evaluator. Analyze the provided startup application text and output the Moats and Technology Edge as 3 to 5 concise bullet points and nothing else. Do not include any introductory sentences, headers, markdown tags, labels, or transitional filler. Each bullet must be on its own line, begin with "- ", and be at most ~30 words. Analyze technical depth, talent rarity, and structural defensibility: rare domain expertise (robotics/AI), multi-disciplinary engineering synergy, proprietary simulation-to-real data pipelines, or deep hardware-software co-design that prevents easy replication by well-funded incumbents.
```

- [ ] **Step 4: Create `watchouts.txt`** with exactly this content:

```
You are a forensic deeptech analyst and investment evaluator. Analyze the provided startup application text and output the Watch-outs and Flags as 3 to 5 concise bullet points and nothing else. Do not include any introductory sentences, headers, markdown tags, labels, or transitional filler. Each bullet must be on its own line, begin with "- ", and be at most ~30 words. Call out the most critical structural vulnerabilities, risks, data gaps, or behavioral concerns: founder split-focus or part-time commitment, unclear IP separation from university labs, adoption/substitution friction with legacy infrastructure, or unverified physical scaling bounds.
```

- [ ] **Step 5: Verify all four exist**

Run: `ls backend/app/services/ai_pipeline/section_prompts/`
Expected: `moats.txt  problem.txt  solution.txt  watchouts.txt`

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/ai_pipeline/section_prompts/
git commit -m "feat(ai): add section prompts (problem/solution/moats/watchouts)"
```

---

### Task 2: SectionAgent

**Files:**
- Create: `backend/app/services/ai_pipeline/section_agent.py`
- Test: `backend/tests/test_section_agent.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_section_agent.py
from app.services.ai_pipeline.section_agent import SectionAgent, SECTIONS


def test_parse_strips_bullet_markers():
    agent = SectionAgent()
    raw = "- First point\n* Second point\n3. Third point\n\n• Fourth"
    assert agent.parse(raw) == ["First point", "Second point", "Third point", "Fourth"]


def test_parse_drops_code_fence_and_language_line():
    agent = SectionAgent()
    raw = "```markdown\n- a\n- b\n- c\n```"
    assert agent.parse(raw) == ["a", "b", "c"]


def test_validate_section_rejects_too_few_and_too_many():
    agent = SectionAgent()
    assert agent._validate_section(["one", "two"])            # <3 -> failures
    assert agent._validate_section(["a", "b", "c", "d", "e", "f"])  # >5 -> failures
    assert agent._validate_section(["a", "b", "c"]) == []     # 3 -> ok


def test_validate_section_rejects_overlong_bullet():
    agent = SectionAgent()
    long_bullet = " ".join(["word"] * 50)
    assert agent._validate_section([long_bullet, "b", "c"])


def test_run_returns_four_sections(monkeypatch):
    agent = SectionAgent()
    monkeypatch.setattr(agent, "_call_api", lambda messages: "- alpha\n- beta\n- gamma")
    result, flags = agent.run("app-1", app_text="some text", no_cache=True)
    assert set(result.keys()) == set(SECTIONS)
    assert result["problem"] == ["alpha", "beta", "gamma"]
    assert flags == ""


def test_run_mock_mode():
    agent = SectionAgent()
    result, flags = agent.run("app-1", app_text="x", mock=True)
    assert set(result.keys()) == set(SECTIONS)
    assert all(len(result[s]) >= 3 for s in SECTIONS)
    assert flags == ""
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && source .venv/bin/activate && pytest tests/test_section_agent.py --no-cov -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.ai_pipeline.section_agent'`

- [ ] **Step 3: Write `section_agent.py`**

```python
"""SectionAgent: four analyst sections (problem/solution/moats/watchouts),
each 3-5 bullet "pointers". Runs an independent validate->self-correct loop per
section over the same OpenRouter/gemini-2.5-flash path as the other agents.
Caches the whole 4-section dict per app via BaseAgent's disk cache (name="sections").
"""
from __future__ import annotations

import re
from pathlib import Path

from .base_agent import BaseAgent

_PROMPTS = Path(__file__).parent / "section_prompts"
SECTIONS = ("problem", "solution", "moats", "watchouts")

_MIN_BULLETS = 3
_MAX_BULLETS = 5
_MAX_WORDS_PER_BULLET = 40

_MARKER = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s*")


class SectionAgent(BaseAgent):
    name = "sections"

    def __init__(self, **kw):
        super().__init__(**kw)
        self._prompts: dict[str, str] = {
            sec: (_PROMPTS / f"{sec}.txt").read_text(encoding="utf-8").strip()
            for sec in SECTIONS
        }

    # BaseAgent abstract stubs (run() is fully overridden; these are unused).
    @property
    def system_prompt(self) -> str:
        return self._prompts["problem"]

    def parse(self, raw: str) -> list[str]:
        text = (raw or "").strip()
        if text.startswith("```"):
            text = text.strip("`").strip()
        bullets: list[str] = []
        for line in text.splitlines():
            s = _MARKER.sub("", line.strip()).strip()
            if not s or s.lower() in ("text", "markdown", "md", "json"):
                continue
            bullets.append(s)
        return bullets

    def mock_result(self) -> dict:
        canned = [
            "Mock bullet on the core engineering bottleneck.",
            "Mock bullet on economic severity.",
            "Mock bullet on why it is unsolved.",
        ]
        return {sec: list(canned) for sec in SECTIONS}

    @staticmethod
    def _validate_section(bullets: list[str]) -> list[str]:
        n = len(bullets)
        if n < _MIN_BULLETS:
            return [f"{n} bullets — need at least {_MIN_BULLETS} one-line bullets"]
        if n > _MAX_BULLETS:
            return [f"{n} bullets — at most {_MAX_BULLETS}; merge to {_MIN_BULLETS}-{_MAX_BULLETS}"]
        for b in bullets:
            if len(b.split()) > _MAX_WORDS_PER_BULLET:
                return [f"a bullet exceeds {_MAX_WORDS_PER_BULLET} words; keep each to one line"]
        return []

    def _run_one_section(self, app_text: str, section: str) -> tuple[list[str], list[str]]:
        messages = [
            {"role": "system", "content": self._prompts[section]},
            {"role": "user", "content": f"APPLICATION TEXT:\n{app_text}"},
        ]
        best: list[str] | None = None
        best_fail: list[str] | None = None
        for rnd in range(self.MAX_CORRECT_ROUNDS + 1):
            raw = self._call_api(messages)
            bullets = self.parse(raw)
            failures = self._validate_section(bullets)
            if best_fail is None or len(failures) < len(best_fail):
                best, best_fail = bullets, failures
            if not failures:
                break
            if rnd < self.MAX_CORRECT_ROUNDS:
                messages = messages + [
                    {"role": "assistant", "content": raw},
                    {"role": "user", "content":
                        f"{failures[0]}. Return only {_MIN_BULLETS}-{_MAX_BULLETS} one-line "
                        f"bullets, each starting with '- ', same analytical content."},
                ]
        return best or [], best_fail or []

    def run(self, app_id: str, app_text: str = "", *,
            mock: bool = False, no_cache: bool = False, **_ignored):
        """Return (result_dict, flags_str). result_dict maps each of the four
        SECTIONS to a list of bullet strings."""
        if mock:
            result = self.mock_result()
            fails: list[str] = []
            for sec in SECTIONS:
                fails += self._validate_section(result[sec])
            return result, "; ".join(fails)

        if not no_cache:
            cached = self._cache_read(app_id)
            if cached is not None:
                return cached, ""

        result: dict[str, list[str]] = {}
        all_fail: list[str] = []
        for sec in SECTIONS:
            bullets, failures = self._run_one_section(app_text, sec)
            result[sec] = bullets
            all_fail += [f"{sec}: {f}" for f in failures]

        if not no_cache:
            self._cache_write(app_id, result)
        return result, "; ".join(all_fail)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && source .venv/bin/activate && pytest tests/test_section_agent.py --no-cov -v`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/ai_pipeline/section_agent.py backend/tests/test_section_agent.py
git commit -m "feat(ai): SectionAgent — 4 bullet sections per application"
```

---

### Task 3: Wire sections into the pipeline + persistence

**Files:**
- Modify: `backend/workers/ai_screener/scoring.py` (add `sections` field to `ScoreResult`)
- Modify: `backend/app/services/ai_pipeline/pipeline.py` (`_sections` stage + attach + persist)
- Test: `backend/tests/test_pipeline_sections.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_pipeline_sections.py
from app.services.ai_pipeline import pipeline
from workers.ai_screener.scoring import ScoreResult


class _FakeTable:
    def __init__(self, sink): self._sink = sink; self._op = None; self._row = None
    def upsert(self, row, on_conflict=None): self._op = "upsert"; self._row = row; return self
    def insert(self, row): self._op = "insert"; self._row = row; return self
    def update(self, row): self._op = "update"; self._row = row; return self
    def eq(self, *a, **k): return self
    def execute(self):
        if self._op == "upsert": self._sink["ai_screening"] = self._row
        return type("R", (), {"data": []})()


class _FakeClient:
    def __init__(self): self.sink = {}
    def table(self, name): return _FakeTable(self.sink)


def test_persist_writes_sections_column():
    client = _FakeClient()
    result = ScoreResult(
        score_problem=5.0, score_solution=5.0, score_tech=5.0,
        score_founders=5.0, score_commitment=5.0, score_overall=5.0,
        summary="s", model="m", raw_response="{}",
        sections={"problem": ["a", "b", "c"], "solution": [], "moats": [], "watchouts": []},
    )
    pipeline.persist(client, "app-1", "tir", result, advance_status=False)
    assert client.sink["ai_screening"]["sections"] == {
        "problem": ["a", "b", "c"], "solution": [], "moats": [], "watchouts": []
    }


def test_persist_sections_defaults_to_none():
    client = _FakeClient()
    result = ScoreResult(
        score_problem=5.0, score_solution=5.0, score_tech=5.0,
        score_founders=5.0, score_commitment=5.0, score_overall=5.0,
        summary="s", model="m", raw_response="{}",
    )
    pipeline.persist(client, "app-1", "tir", result, advance_status=False)
    assert client.sink["ai_screening"]["sections"] is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && source .venv/bin/activate && pytest tests/test_pipeline_sections.py --no-cov -v`
Expected: FAIL — `TypeError: __init__() got an unexpected keyword argument 'sections'` (ScoreResult has no `sections` field yet)

- [ ] **Step 3: Add the `sections` field to `ScoreResult`**

In `backend/workers/ai_screener/scoring.py`, add one line after `project_name` (currently line 60):

```python
    project_name: str | None = None
    sections: dict | None = None
```

- [ ] **Step 4: Add the persist write**

In `backend/app/services/ai_pipeline/pipeline.py`, in `persist(...)`, add one key to the `row` dict (after `"project_name": result.project_name,` — currently line 160):

```python
        "project_name": result.project_name,
        "sections": result.sections,
```

- [ ] **Step 5: Run persist tests to verify they pass**

Run: `cd backend && source .venv/bin/activate && pytest tests/test_pipeline_sections.py --no-cov -v`
Expected: PASS (2 passed)

- [ ] **Step 6: Add the `_sections` stage + attach to `run_for_application`**

In `backend/app/services/ai_pipeline/pipeline.py`, add a stage wrapper near the other `_classify`/`_score`/`_summarize` wrappers (after `_summarize`, ~line 58):

```python
def _sections(app_id: str, app_text: str, *, cache_dir, no_cache: bool) -> dict | None:
    """Best-effort: a failure here must NOT block scoring / status advance."""
    try:
        from .section_agent import SectionAgent
        result, _flags = SectionAgent(cache_dir=cache_dir).run(
            app_id, app_text=app_text, no_cache=no_cache,
        )
        return result
    except Exception as exc:  # noqa: BLE001
        log.warning("sections stage failed", extra={"app_id": app_id, "err": str(exc)})
        return None
```

In `run_for_application`, after the `summary, summary_flags = _summarize(...)` call (~line 88), add:

```python
    sections = _sections(app_id, app_text, cache_dir=cache_dir, no_cache=no_cache)
```

And add `sections=sections,` as the final argument of the `return ScoreResult(...)` (after `project_name=classification.get("project_name"),` ~line 112):

```python
        project_name=classification.get("project_name"),
        sections=sections,
    )
```

- [ ] **Step 7: Add a test that `run_for_application` attaches sections**

Append to `backend/tests/test_pipeline_sections.py`:

```python
def test_run_for_application_attaches_sections(monkeypatch):
    from app.services.ai_pipeline import pipeline as pl

    class _AppTable:
        def select(self, *a, **k): return self
        def eq(self, *a, **k): return self
        def maybe_single(self): return self
        def execute(self):
            return type("R", (), {"data": {"id": "app-1", "problem_describe": "x"}})()

    class _Client:
        def table(self, name): return _AppTable()

    monkeypatch.setattr(pl, "_classify", lambda *a, **k: {"project_name": "P"})
    monkeypatch.setattr(pl, "_score", lambda *a, **k: (
        {"problem_impact": {"score": 5.0}, "completeness": {"score": 5.0},
         "technical_depth": {"score": 5.0}, "behavioural": {"score": 5.0},
         "commitment": {"score": 5.0}}, ""))
    monkeypatch.setattr(pl, "_summarize", lambda *a, **k: ("summary", ""))
    monkeypatch.setattr(pl, "_sections", lambda *a, **k: {"problem": ["a", "b", "c"]})

    result = pl.run_for_application("app-1", "tir", client=_Client())
    assert result.sections == {"problem": ["a", "b", "c"]}
```

- [ ] **Step 8: Run all pipeline-section tests**

Run: `cd backend && source .venv/bin/activate && pytest tests/test_pipeline_sections.py --no-cov -v`
Expected: PASS (3 passed)

- [ ] **Step 9: Run the existing AI pipeline tests to confirm no regression**

Run: `cd backend && source .venv/bin/activate && pytest tests/test_ai_pipeline.py --no-cov -v`
Expected: PASS (same count as before this task)

- [ ] **Step 10: Commit**

```bash
git add backend/workers/ai_screener/scoring.py backend/app/services/ai_pipeline/pipeline.py backend/tests/test_pipeline_sections.py
git commit -m "feat(ai): run SectionAgent in the pipeline and persist sections"
```

---

### Task 4: Backfill script (sections only, non-destructive)

**Files:**
- Create: `backend/scripts/backfill_sections.py`
- Test: `backend/tests/test_backfill_sections.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_backfill_sections.py
from scripts.backfill_sections import select_targets, update_sections


def test_select_targets_skips_drafts():
    rows = [{"id": "a", "status": "draft"}, {"id": "b", "status": "submitted"},
            {"id": "c", "status": "under_review"}]
    assert select_targets(rows) == ["b", "c"]


class _Table:
    def __init__(self, sink): self.sink = sink; self._row = None
    def update(self, row): self._row = row; return self
    def eq(self, col, val): self.sink.setdefault("eqs", []).append((col, val)); return self
    def execute(self):
        self.sink["updated"] = self._row
        return type("R", (), {"data": [{"application_id": "b"}]})()


class _Client:
    def __init__(self): self.sink = {}
    def table(self, name): self.sink["table"] = name; return _Table(self.sink)


def test_update_sections_updates_only_sections_column():
    client = _Client()
    n = update_sections(client, "b", "tir", {"problem": ["x"]})
    assert client.sink["table"] == "ai_screening"
    assert client.sink["updated"] == {"sections": {"problem": ["x"]}}
    assert ("application_id", "b") in client.sink["eqs"]
    assert ("application_track", "tir") in client.sink["eqs"]
    assert n == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && source .venv/bin/activate && pytest tests/test_backfill_sections.py --no-cov -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.backfill_sections'`

- [ ] **Step 3: Write `backfill_sections.py`**

```python
#!/usr/bin/env python3
"""Backfill ai_screening.sections (4 AI analyst sections) for ALL non-draft apps.

Runs ONLY the SectionAgent (Gemini Flash via OpenRouter) and UPDATES just the
`sections` column of the existing ai_screening row — it does NOT re-score,
re-summarize, or change status. Idempotent + resumable (per-app disk cache).
Apps with no ai_screening row yet are skipped and logged (run rescore first).

Usage:
    cd backend && source .venv/bin/activate
    python scripts/backfill_sections.py --dry-run
    python scripts/backfill_sections.py --yes
    python scripts/backfill_sections.py --yes --track sip --limit 10
"""
from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

_CACHE_DIR = _BACKEND_ROOT / ".sections_cache"


def select_targets(rows: list[dict]) -> list[str]:
    """Non-draft application ids, preserving order."""
    return [r["id"] for r in rows if r.get("status") != "draft"]


def update_sections(client, app_id: str, track: str, sections: dict) -> int:
    """UPDATE ai_screening.sections for one (app, track). Returns rows affected."""
    res = (client.table("ai_screening")
           .update({"sections": sections})
           .eq("application_id", app_id)
           .eq("application_track", track)
           .execute())
    return len(res.data or [])


def _fetch_full_rows(client, table: str, limit: int | None) -> list[dict]:
    CHUNK = 500
    rows: list[dict] = []
    offset = 0
    while True:
        remaining = (limit - len(rows)) if limit else None
        if remaining is not None and remaining <= 0:
            break
        end = offset + (min(CHUNK, remaining) if remaining else CHUNK) - 1
        page = (client.table(table).select("*")
                .neq("status", "draft").range(offset, end).execute().data) or []
        rows.extend(page)
        if len(page) < CHUNK:
            break
        offset += CHUNK
    return rows


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--track", choices=["tir", "sip"], default=None)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--no-cache", action="store_true")
    args = ap.parse_args()

    if load_dotenv:
        load_dotenv(_BACKEND_ROOT / ".env.prod")
        load_dotenv(_BACKEND_ROOT / ".env", override=False)

    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    assert os.environ.get("OPENROUTER_API_KEY"), "OPENROUTER_API_KEY required"
    print(f"→ DB = {url}")
    if not args.dry_run and not args.yes:
        print("✗ Refusing to run without --yes (or use --dry-run).")
        return 2

    from supabase import create_client
    from app.services.ai_pipeline.section_agent import SectionAgent
    from app.services.ai_pipeline.serialize import build_app_text

    client = create_client(url, key)
    agent = SectionAgent(cache_dir=_CACHE_DIR)
    tracks = [args.track] if args.track else ["tir", "sip"]
    total_ok = total_skip = total_fail = 0

    for track in tracks:
        rows = _fetch_full_rows(client, f"{track}_applications", args.limit)
        by_id = {r["id"]: r for r in rows}
        ids = select_targets(rows)
        print(f"→ {track.upper()}: {len(ids)} applications")
        if args.dry_run:
            print(f"  [dry-run] first 10: {ids[:10]}")
            continue
        for i, app_id in enumerate(ids, 1):
            try:
                app_text = build_app_text(by_id[app_id], track)
                sections, _flags = agent.run(
                    app_id, app_text=app_text, no_cache=args.no_cache)
                n = update_sections(client, app_id, track, sections)
                if n == 0:
                    total_skip += 1
                    print(f"  ⚠ {track} {app_id}: no ai_screening row — skipped")
                else:
                    total_ok += 1
                if i % 10 == 0 or i == len(ids):
                    print(f"  {track} {i}/{len(ids)}")
            except Exception as exc:  # noqa: BLE001
                total_fail += 1
                print(f"  ✗ {track} {app_id}: {str(exc)[:160]}")
            time.sleep(0.3)

    print(f"✓ done — {total_ok} updated, {total_skip} skipped (no row), {total_fail} failed")
    return 0 if total_fail == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && source .venv/bin/activate && pytest tests/test_backfill_sections.py --no-cov -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/backfill_sections.py backend/tests/test_backfill_sections.py
git commit -m "feat(ai): backfill_sections script (sections-only, non-destructive)"
```

---

## Phase 2 — Backend API surfacing

### Task 5: Reviewer `/content` returns `aiSections`

**Files:**
- Modify: `backend/app/routers/reviewer.py` (content endpoint return, ~line 97-111)
- Test: `backend/tests/test_reviewer_content_sections.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_reviewer_content_sections.py
import asyncio
from app.routers import reviewer


def test_content_payload_includes_ai_sections(monkeypatch):
    fake = {
        "application": {"id": "a1", "basic_org": "Org"},
        "assignment": {"assignment_id": "as1", "assigned_at": "t"},
        "my_review": None,
        "ai_screening": {"summary": "s", "sections": {"problem": ["p1"]}},
    }
    monkeypatch.setattr(reviewer.reviewer_query, "fetch_application_for_reviewer",
                        lambda uid, track, app_id: fake)
    monkeypatch.setattr(reviewer.reviewer_query, "_display_id", lambda t, r: "TIR-1")
    monkeypatch.setattr(reviewer.reviewer_query, "_ai_block", lambda ai: {"overall": None})
    monkeypatch.setattr(reviewer.review_presenter, "TIR_FIELD_MAP", {})
    monkeypatch.setattr(reviewer.review_presenter, "collect_attachment_paths",
                        lambda row, track: [])
    monkeypatch.setattr(reviewer.review_presenter, "build_fields", lambda row, fm: [])
    monkeypatch.setattr(reviewer.review_presenter, "build_sections", lambda row, t: [])

    out = asyncio.run(reviewer.get_application_content(
        "tir", "a1", user={"user_id": "u1"}))
    assert out["aiSections"] == {"problem": ["p1"]}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && source .venv/bin/activate && pytest tests/test_reviewer_content_sections.py --no-cov -v`
Expected: FAIL — `KeyError: 'aiSections'`

- [ ] **Step 3: Add `aiSections` to the content payload**

In `backend/app/routers/reviewer.py`, in `get_application_content`'s return dict, add one key after `"aiSummary": ai.get("summary"),` (line 104):

```python
        "aiSummary": ai.get("summary"),
        "aiSections": ai.get("sections"),
```

(`ai` is already `payload.get("ai_screening") or {}` at line 78.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && source .venv/bin/activate && pytest tests/test_reviewer_content_sections.py --no-cov -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/reviewer.py backend/tests/test_reviewer_content_sections.py
git commit -m "feat(reviewer): expose ai sections in the eval content payload"
```

---

### Task 6: Admin `fetch_detail` returns `aiSections`

**Files:**
- Modify: `backend/app/services/admin_query.py` (`fetch_detail` return, ~line 446-468)
- Test: `backend/tests/test_admin_detail_sections.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_admin_detail_sections.py
from app.services import admin_query


def test_fetch_detail_includes_ai_sections(monkeypatch):
    aq = admin_query.applications_query
    monkeypatch.setattr(aq, "find_application_with_track",
                        lambda app_id: ("tir", {"id": app_id, "display_seq": 1}))
    monkeypatch.setattr(aq, "fetch_ai_screening_for",
                        lambda app_id, track: {"sections": {"problem": ["p"]}})
    monkeypatch.setattr(aq, "fetch_reviews_for", lambda a, t: [])
    monkeypatch.setattr(aq, "fetch_reviewer_assignments_for", lambda a, t: [])
    monkeypatch.setattr(aq, "enrich_reviewers", lambda ra, rv: (ra, rv))
    monkeypatch.setattr(aq, "fetch_status_history_for", lambda a, t: [])
    monkeypatch.setattr(admin_query, "_fetch_latest_decisions", lambda keys: {})
    monkeypatch.setattr(admin_query, "_fetch_admin_meta", lambda keys: {})
    monkeypatch.setattr(admin_query, "_fetch_batches", lambda keys: {})

    out = admin_query.fetch_detail("tir", "a1")
    assert out["aiSections"] == {"problem": ["p"]}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && source .venv/bin/activate && pytest tests/test_admin_detail_sections.py --no-cov -v`
Expected: FAIL — `KeyError: 'aiSections'`

- [ ] **Step 3: Add `aiSections` to the `fetch_detail` return**

In `backend/app/services/admin_query.py`, in `fetch_detail`'s return dict, add after `"ai_screening": ai_screening,` (line 460):

```python
        "ai_screening":         ai_screening,
        "aiSections":           (ai_screening or {}).get("sections"),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && source .venv/bin/activate && pytest tests/test_admin_detail_sections.py --no-cov -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/admin_query.py backend/tests/test_admin_detail_sections.py
git commit -m "feat(admin): expose ai sections in application detail"
```

---

### Task 7: Confirm leadership detail carries `sections`

**Files:**
- Verify (likely no change): `backend/app/services/applications_query.py` (`fetch_ai_screening_for`)
- Test: `backend/tests/test_leadership_detail_sections.py`

- [ ] **Step 1: Verify the ai_screening select is `select("*")`**

Run: `grep -n "def fetch_ai_screening_for" -A 12 backend/app/services/applications_query.py`
Expected: the query uses `.select("*")`. If it selects an explicit column list, add `sections` to that list. If it is `select("*")`, no change is needed (the leadership detail returns the full `ai_screening` row, so `sections` flows automatically).

- [ ] **Step 2: Write a guard test**

```python
# backend/tests/test_leadership_detail_sections.py
from app.services import applications_query
import inspect


def test_fetch_ai_screening_selects_all_columns():
    """Leadership AppDrawer reads ai_screening.sections directly, so the
    ai_screening fetch must not drop the new column."""
    src = inspect.getsource(applications_query.fetch_ai_screening_for)
    assert 'select("*")' in src or '"sections"' in src
```

- [ ] **Step 3: Run test to verify it passes**

Run: `cd backend && source .venv/bin/activate && pytest tests/test_leadership_detail_sections.py --no-cov -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_leadership_detail_sections.py
git commit -m "test(leadership): guard ai_screening.sections survives detail fetch"
```

---

## Phase 3 — Frontend

### Task 8: Shared `AiSections` component + styles

**Files:**
- Create: `frontend/src/components/AiSections.jsx`
- Create: `frontend/src/styles/ai-sections.css`
- Test: `frontend/src/components/__tests__/AiSections.test.jsx`

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/components/__tests__/AiSections.test.jsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import AiSections from "../AiSections.jsx";

const SAMPLE = {
  problem: ["Problem bullet one", "Problem bullet two", "Problem bullet three"],
  solution: ["Solution bullet"],
  moats: ["Moat bullet"],
  watchouts: ["Watchout bullet"],
};

describe("AiSections", () => {
  it("dropdown variant shows all four section labels", () => {
    render(<AiSections sections={SAMPLE} variant="dropdown" />);
    expect(screen.getByText("Problem Description")).toBeInTheDocument();
    expect(screen.getByText("Solution Description")).toBeInTheDocument();
    expect(screen.getByText("Moats & Technology Edge")).toBeInTheDocument();
    expect(screen.getByText("Watch-outs or Flags")).toBeInTheDocument();
  });

  it("dropdown variant toggles a section open on click", () => {
    render(<AiSections sections={SAMPLE} variant="dropdown" />);
    // Solution is collapsed initially (only the first section is open).
    expect(screen.queryByText("Solution bullet")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Solution Description"));
    expect(screen.getByText("Solution bullet")).toBeInTheDocument();
  });

  it("leadership variant renders every bullet without accordions", () => {
    render(<AiSections sections={SAMPLE} variant="leadership" />);
    expect(screen.getByText("Solution bullet")).toBeInTheDocument();
    expect(screen.getByText("Moat bullet")).toBeInTheDocument();
  });

  it("renders an empty-state note when there are no sections", () => {
    render(<AiSections sections={null} variant="dropdown" />);
    expect(screen.getByText(/not generated yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/__tests__/AiSections.test.jsx`
Expected: FAIL — cannot resolve `../AiSections.jsx`

- [ ] **Step 3: Write `AiSections.jsx`**

```jsx
import { useState } from "react";
import "../styles/ai-sections.css";

const SECTION_DEFS = [
  ["problem", "Problem Description"],
  ["solution", "Solution Description"],
  ["moats", "Moats & Technology Edge"],
  ["watchouts", "Watch-outs or Flags"],
];

function normalize(sections) {
  const out = [];
  for (const [key, label] of SECTION_DEFS) {
    const bullets = Array.isArray(sections?.[key])
      ? sections[key].filter((b) => typeof b === "string" && b.trim())
      : [];
    if (bullets.length) out.push({ key, label, bullets });
  }
  return out;
}

export default function AiSections({ sections, variant = "dropdown" }) {
  const items = normalize(sections);
  const [open, setOpen] = useState({});

  if (!items.length) {
    return <div className="ai-sec-empty">AI sections not generated yet.</div>;
  }

  if (variant === "leadership") {
    return (
      <div className="ai-sec-lead">
        {items.map((it) => (
          <div className="ai-sec-lead-block" key={it.key}>
            <div className="ai-sec-lead-label">{it.label}</div>
            <ul className="ai-sec-bullets">
              {it.bullets.map((b, i) => (<li key={i}>{b}</li>))}
            </ul>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="ai-sec-list">
      {items.map((it, i) => {
        const isOpen = it.key in open ? open[it.key] : i === 0;
        return (
          <div className={"ai-sec" + (isOpen ? " is-open" : "")} key={it.key}>
            <button
              className="ai-sec-head"
              aria-expanded={isOpen}
              onClick={() => setOpen((p) => ({ ...p, [it.key]: !isOpen }))}
            >
              <span className="ai-sec-chev">{isOpen ? "▾" : "▸"}</span>
              <span className="ai-sec-label">{it.label}</span>
              <span className="ai-sec-hint">{isOpen ? "" : it.bullets.length + " points"}</span>
            </button>
            {isOpen && (
              <ul className="ai-sec-bullets">
                {it.bullets.map((b, j) => (<li key={j}>{b}</li>))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Write `ai-sections.css`**

```css
/* Shared AI-section styling — imported by AiSections.jsx, so it applies in
   the reviewer, admin, and leadership surfaces without portal scoping. */

/* ── dropdown variant (reviewer + admin) ─────────────────────────────── */
.ai-sec-list { margin-top: 8px; display: flex; flex-direction: column; gap: 10px; }
.ai-sec { border: 1px solid var(--line, #e6e6ee); border-radius: 12px; overflow: hidden; }
.ai-sec.is-open { border-color: #d9d0f5; box-shadow: 0 6px 20px rgba(50, 19, 183, 0.06); }
.ai-sec-head {
  width: 100%; display: flex; align-items: center; gap: 12px;
  padding: 15px 18px; min-height: 52px; cursor: pointer;
  background: none; border: 0; text-align: left; font: inherit;
}
.ai-sec.is-open .ai-sec-head { background: #f7f5fd; }
.ai-sec-chev { color: var(--artblue, #3213b7); font-size: 11px; width: 12px; flex-shrink: 0; }
.ai-sec-label { flex: 1; font-weight: 700; font-size: 16px; color: var(--ink, #1a1a22); }
.ai-sec.is-open .ai-sec-label { color: var(--artblue, #3213b7); }
.ai-sec-hint { font-size: 11px; letter-spacing: 0.02em; color: var(--ink-dim, #8a8a92); flex-shrink: 0; }

/* Bullets fill the FULL card width (kills the old max-width:70ch whitespace). */
.ai-sec-bullets {
  margin: 0; padding: 4px 22px 18px 22px; list-style: none;
  display: flex; flex-direction: column; gap: 11px; max-width: none;
}
.ai-sec-bullets li {
  font-size: 14px; line-height: 1.62; color: var(--ink-soft, #4a4a52);
  padding-left: 18px; position: relative;
}
.ai-sec-bullets li::before {
  content: ""; position: absolute; left: 2px; top: 8px;
  width: 5px; height: 5px; border-radius: 50%; background: var(--artblue, #3213b7);
}

/* ── leadership variant (sub-headed blocks) ──────────────────────────── */
.ai-sec-lead { display: flex; flex-direction: column; gap: 16px; }
.ai-sec-lead-label {
  font-weight: 700; font-size: 11px; letter-spacing: 0.08em;
  text-transform: uppercase; color: var(--ink-dim, #8a8a92); margin-bottom: 8px;
}

.ai-sec-empty { font-size: 13px; color: var(--ink-dim, #8a8a92); padding: 6px 2px; }

/* ── responsive: collapse the eval/detail two-column grid on small screens ─ */
@media (max-width: 860px) {
  .os-grid-evaluation { grid-template-columns: 1fr !important; }
  .ai-sec-head { padding: 14px 14px; }
  .ai-sec-bullets { padding: 4px 14px 16px 16px; }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/__tests__/AiSections.test.jsx`
Expected: PASS (4 passed)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/AiSections.jsx frontend/src/styles/ai-sections.css frontend/src/components/__tests__/AiSections.test.jsx
git commit -m "feat(ui): shared AiSections component (dropdown + leadership variants)"
```

---

### Task 9: Reviewer eval — render only the 4 sections

**Files:**
- Modify: `frontend/src/pages/reviewer/v2/ReviewerEval.jsx`

- [ ] **Step 1: Add the import**

At the top of `ReviewerEval.jsx` with the other imports, add:

```jsx
import AiSections from "../../../components/AiSections.jsx";
```

- [ ] **Step 2: Replace the "Application detail" block with `AiSections`**

Replace the entire `<div>` that starts with `<div className="ps-group-label">Application detail</div>` and contains the `factFields` block and the `.ps-sections` `longFields` accordion (currently lines ~470–510) with:

```jsx
              <AiSections variant="dropdown" sections={content.aiSections} />
```

Keep the AI summary block above it (lines ~463–468) and the `<hr>` + "View full application" button below it (lines ~512–516) unchanged.

- [ ] **Step 3: Remove the now-dead derivations + state**

- Delete the two now-unused consts (lines ~378–379):
  ```jsx
  const longFields = (content.fields || []).filter((f) => Array.isArray(f.bullets));
  const factFields = (content.fields || []).filter((f) => !Array.isArray(f.bullets));
  ```
- Delete the `secOpen` / `setSecOpen` `useState` declaration (search for `secOpen` — it is only used by the removed accordion).

- [ ] **Step 4: Verify the build + lint are clean and existing reviewer tests pass**

Run: `cd frontend && npx vitest run src/pages/reviewer/v2/__tests__/`
Expected: PASS (existing reviewer tests still green; no reference to `secOpen`/`longFields`).

Run: `cd frontend && npm run build`
Expected: build succeeds with no "is defined but never used" errors for `secOpen`/`longFields`/`factFields`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/reviewer/v2/ReviewerEval.jsx
git commit -m "feat(reviewer): show the 4 AI sections inline, drop the raw-answer accordions"
```

---

### Task 10: Admin detail — insert the 4 sections (keep Reviewer Notes)

**Files:**
- Modify: `frontend/src/lib/adminDataAdapter.js` (`adaptDetail` — map `aiSections`)
- Modify: `frontend/src/pages/admin/platform/screens/AdminDetail.jsx`

- [ ] **Step 1: Map `aiSections` through the adapter**

In `frontend/src/lib/adminDataAdapter.js`, in `adaptDetail`'s returned object, add one field (after `aiSummary: d.ai_screening?.summary || "",` — line 132):

```js
    aiSummary: d.ai_screening?.summary || "",
    aiSections: d.aiSections || null,
```

- [ ] **Step 2: Add the import to `AdminDetail.jsx`**

With the other imports, add:

```jsx
import AiSections from "../../../../components/AiSections.jsx";
```

(Note the four `../` — `screens/` is under `pages/admin/platform/screens/`.)

- [ ] **Step 3: Insert `AiSections` below the AI summary, above Reviewer Notes**

In `AdminDetail.jsx`, immediately after the AI summary block (which closes at line ~337, `)}` after `ps-ai-text`) and before the `{/* Problem & solution — collapsible bullet sections */}` / Reviewer Notes block (line ~339), insert:

```jsx
              <AiSections variant="dropdown" sections={s.aiSections} />
```

Leave the Reviewer Notes block and the "View full application" button unchanged.

- [ ] **Step 4: Verify build + adapter test**

Add a quick adapter assertion to an existing or new adapter test. Create `frontend/src/lib/__tests__/adaptDetail.sections.test.js`:

```js
import { describe, it, expect } from "vitest";
import { adaptDetail } from "../adminDataAdapter.js";

describe("adaptDetail aiSections", () => {
  it("passes aiSections through", () => {
    const out = adaptDetail({ id: "a1", track: "tir", aiSections: { problem: ["p"] } });
    expect(out.aiSections).toEqual({ problem: ["p"] });
  });
  it("defaults aiSections to null", () => {
    const out = adaptDetail({ id: "a1", track: "tir" });
    expect(out.aiSections).toBeNull();
  });
});
```

Run: `cd frontend && npx vitest run src/lib/__tests__/adaptDetail.sections.test.js`
Expected: PASS (2 passed)

Run: `cd frontend && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/adminDataAdapter.js frontend/src/pages/admin/platform/screens/AdminDetail.jsx frontend/src/lib/__tests__/adaptDetail.sections.test.js
git commit -m "feat(admin): show the 4 AI sections above reviewer notes"
```

---

### Task 11: Leadership AppDrawer — the 4 sections in the "Problem & solution" collapsible

**Files:**
- Modify: `frontend/src/pages/leadership/components/AppDrawer.jsx`

- [ ] **Step 1: Add the import**

With the other imports at the top of `AppDrawer.jsx`, add:

```jsx
import AiSections from "../../../components/AiSections.jsx";
```

- [ ] **Step 2: Replace the `renderProblemSolution` call**

In the `<Collapsible label="Problem & solution">` block (lines ~259–265), replace `renderProblemSolution(application)` on line ~263 with:

```jsx
            <AiSections variant="leadership" sections={aiScreening?.sections} />
```

Resulting block:

```jsx
            <Collapsible label="Problem & solution">
            {loading && !application ? (
              <div className="inline-loading">Loading…</div>
            ) : (
              <AiSections variant="leadership" sections={aiScreening?.sections} />
            )}
            </Collapsible>
```

(`aiScreening` is already in scope — it is the same object the AI-score section reads at lines ~226/231/241.)

- [ ] **Step 3: Delete the now-dead `renderProblemSolution` function**

Delete the whole `function renderProblemSolution(application) { ... }` (lines ~48–85). Then, if `ReadMoreText` and `titleCase` are no longer referenced anywhere else in the file, remove the `ReadMoreText` import (line 21) and the `titleCase` helper (lines ~44–46).

Run: `grep -n "renderProblemSolution\|ReadMoreText\|titleCase" frontend/src/pages/leadership/components/AppDrawer.jsx`
Expected: no matches remain (all removed).

- [ ] **Step 4: Verify build + existing leadership tests**

Run: `cd frontend && npx vitest run src/pages/leadership/__tests__/`
Expected: PASS.

Run: `cd frontend && npm run build`
Expected: build succeeds with no unused-symbol errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/leadership/components/AppDrawer.jsx
git commit -m "feat(leadership): render the 4 AI sections in the AppDrawer problem/solution block"
```

---

## Phase 4 — Rollout (staging → prod; deploy is user-gated)

### Task 12: Deploy + backfill + promote

This task is operational, not code. Execute with the user in the loop; do not deploy to prod without explicit go-ahead.

- [ ] **Step 1: Full backend test sweep**

Run: `cd backend && source .venv/bin/activate && pytest --no-cov -q`
Expected: no NEW failures vs. the pre-change baseline (the repo has ~19 known pre-existing failures — compare counts).

- [ ] **Step 2: Full frontend test + build**

Run: `cd frontend && npx vitest run && npm run build`
Expected: all green, build succeeds.

- [ ] **Step 3: Apply migration 028 to STAGING Supabase**

Paste `backend/migrations/028_ai_sections.sql` into the staging project (`exqmxvdtcsvpgtftwjml`) SQL editor. (Prod is already applied.)

- [ ] **Step 4: Deploy backend to STAGING**

From an isolated worktree: `cd infra/sam && ./deploy-staging.sh`. Confirm the deploy picks up this branch's `backend/`.

- [ ] **Step 5: Backfill STAGING**

Run: `cd backend && source .venv/bin/activate && python scripts/backfill_sections.py --dry-run` then `--yes`. Watch the updated/skipped/failed tallies.

- [ ] **Step 6: QA on staging**

Verify on staging (desktop + mobile widths) that all three surfaces show identical 4-section bullet content: reviewer eval (only the 4 sections between AI summary and View Full App, full-width bullets, no right whitespace), admin detail (4 sections above Reviewer Notes), leadership AppDrawer ("Problem & solution" collapsible). Confirm a freshly-submitted staging app auto-generates sections.

- [ ] **Step 7: PROD backend deploy (USER-GATED)**

On explicit go-ahead: deploy backend to prod from an isolated worktree with both intake-closed flags true in `.env.prod` (`grep tir_submissions_closed backend/.env.prod` first). Migration 028 is already applied to prod.

- [ ] **Step 8: Backfill PROD**

Run: `python scripts/backfill_sections.py --dry-run` (prod env), then `--yes`.

- [ ] **Step 9: Promote frontend to prod**

Vercel Promote-to-Production on the new build. Final visual QA on all three prod surfaces.

---

## Self-review

**Spec coverage:**
- 4 sections via SectionAgent/Gemini Flash → Tasks 1–2. ✓
- Bullets (not paragraphs) → prompts (Task 1) + `_validate_section` bullet-count (Task 2). ✓
- Storage `ai_screening.sections` JSONB → migration 028 (done) + persist (Task 3). ✓
- Auto on submit/edit/admin-rerun → pipeline stage (Task 3, runs in `run_for_application`). ✓
- Backfill all ~480 → Task 4 + Task 12. ✓
- API surfacing (reviewer/admin `aiSections`, leadership `ai_screening.sections`) → Tasks 5–7. ✓
- Shared component, two variants → Task 8. ✓
- Reviewer only-4-sections; admin add+keep Reviewer Notes; leadership AppDrawer only → Tasks 9–11. ✓
- Remove right-side whitespace + responsive → `ai-sections.css` (`max-width:none`, `@media` grid collapse) in Task 8. ✓
- Keep AI summary + View Full App → preserved in Tasks 9–11. ✓

**Placeholder scan:** No TBD/TODO; every code step has full code; every command has expected output. ✓

**Type/name consistency:** `ScoreResult.sections` (Task 3) matches `result.sections` in persist (Task 3) and backfill's `update_sections` payload (Task 4). Backend payload key `aiSections` (Tasks 5–6) matches `content.aiSections` (Task 9) and `s.aiSections` via `adaptDetail` (Task 10). Leadership uses `aiScreening?.sections` (Task 11) — nested, matching the raw `ai_screening` row (Task 7). Component prop `sections`/`variant` consistent across Tasks 8–11. ✓

**One assumption to verify at execution (Task 7 Step 1):** `fetch_ai_screening_for` uses `select("*")`. If not, add `sections` to its column list — the plan already instructs this.
