# Leadership Applications Table Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the `/leadership` Applications table to render 8 columns (Project · Founder · Industry · Stage · AI Score · Status · Submitted · ID) with LLM-driven industry classification capped at 12 categories, human-readable per-track display IDs (`TIR-26001`), and an updated AppDrawer header.

**Architecture:** New SQL migration 017 introduces an `industry_categories` taxonomy table, two `industry_*` columns on `ai_screening`, and a `display_seq` BIGINT sequence column on each track's applications table. The existing single-call AI screener (`backend/workers/ai_screener/openrouter_client.py`) gets one additional JSON field — `industry` — added to its prompt schema; the worker handler reads the current categories from Supabase, passes them to the LLM, validates the response (cap + confidence), and may insert a new category row before upserting `ai_screening`. A standalone `backfill_industry.py` script populates existing apps with an industry-only LLM prompt. The leadership backend's row-shaping helpers (`derive_project_name`, `derive_stage_label`, `compose_display_id`) are rewritten to match the spec; the list endpoint joins `industry_categories`, exposes `display_seq` + `display_id`, and gains numeric-search-by-`display_seq`. A new lightweight `GET /leadership/industry-categories` endpoint drives the filter pills. Frontend `LeadershipDashboard.jsx` table is rewritten to the 8-column layout with relative-time formatting; `AppDrawer.jsx` header switches to project name + display_id; CSS gains two-line cell rules.

**Tech Stack:** PostgreSQL (Supabase) · FastAPI · Python 3.11 · pytest + ruff · OpenRouter (`google/gemini-2.5-flash`) · React 18 + Vite + vitest.

**Spec:** `docs/superpowers/specs/2026-05-20-leadership-applications-table-redesign-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `backend/migrations/017_leadership_table_redesign.sql` | **CREATE** | Single consolidated migration: `industry_categories` table + 7 seeds, `ai_screening` industry columns, per-track `display_seq` columns + sequences + backfill. |
| `backend/app/services/industry_categories.py` | **CREATE** | Shared service: `fetch_categories()` returns ordered list of `(id, label, count, is_seed)`; `create_category_if_under_cap()` does race-safe INSERT. Single source of truth used by worker, backfill, and the new endpoint. |
| `backend/app/services/stats.py` | **MODIFY** | Rewrite `derive_project_name()` to match spec §2 (filler strip, capitalize, 60-char word boundary). Rewrite `derive_stage_label()` to return `{raw, label}` dict and use spec §4a/§4b mappings. Rewrite `compose_display_id(track, display_seq)` to use sequence integer. Mark `classify_industry()` `# DEPRECATED`. |
| `backend/app/services/applications_query.py` | **MODIFY** | Add `display_seq` and join `ai_screening` + `industry_categories` columns to `_BASE_LIST_COLUMNS`. Modify `fetch_apps_for_track()` to: (a) include `display_seq` projection, (b) extend `.or_()` search clause to match `display_seq.eq.<n>` when search is purely numeric. Add `fetch_industry_for_pairs()` bulk helper. |
| `backend/app/routers/leadership.py` | **MODIFY** | Rewrite list endpoint row-shaping to spec §6a (founder object, industry object, stage object with raw+label, display_id, display_seq). Delete legacy keyword `classify_industry()` call. Add `GET /leadership/industry-categories` endpoint. Either delete or keep-temporarily the `/stats` industry block (decision in task). |
| `backend/workers/ai_screener/openrouter_client.py` | **MODIFY** | Change `_MODEL` to `"google/gemini-2.5-flash"`. Extend `_SYSTEM_PROMPT` to also classify industry. Extend `score_application(app_row, categories)` signature with categories list. Add industry fields to return + JSON schema parsing. |
| `backend/workers/ai_screener/scoring.py` | **MODIFY** | Add `industry_category_id`, `industry_confidence`, `new_industry_proposal` fields to `ScoreResult` dataclass. |
| `backend/workers/ai_screener/handler.py` | **MODIFY** | Before `_score()`, fetch current categories via `industry_categories.fetch_categories()`. Pass to `score_application()`. After scoring, if `new_industry_proposal` is present, call `industry_categories.create_category_if_under_cap()`. Upsert `industry_category_id` and `industry_confidence` to `ai_screening`. |
| `backend/scripts/backfill_industry.py` | **CREATE** | Standalone script. Mirrors `seed_staging.py` patterns. Queries non-draft apps from both tracks (oldest first), runs an industry-only LLM prompt, UPDATEs only `industry_category_id` + `industry_confidence` on `ai_screening`. Idempotent (skips rows already populated). |
| `backend/tests/test_stats_helpers.py` | **CREATE** | Unit tests for `derive_project_name`, `derive_stage_label`, `compose_display_id`. |
| `backend/tests/test_industry_categories.py` | **CREATE** | Unit tests for `fetch_categories()` ordering + `create_category_if_under_cap()` cap enforcement (mocked Supabase). |
| `backend/tests/test_ai_screener.py` | **MODIFY** | Extend existing tests: (a) add a test that the OpenRouter user-message includes the category list, (b) add a test that the handler upserts `industry_category_id`, (c) add a test that the handler calls `create_category_if_under_cap` when `new_industry_proposal` is present. |
| `backend/tests/test_leadership_router.py` | **MODIFY (or CREATE if missing)** | Add tests for the new `/leadership/industry-categories` endpoint shape. Add a test that `/leadership/applications` row has `founder`, `industry`, `stage` objects and `display_id`. |
| `frontend/src/lib/leadershipApi.js` | **MODIFY** | Add `getIndustryCategories()` wrapping `GET /leadership/industry-categories`. |
| `frontend/src/lib/timeFmt.js` | **CREATE** | Export `fmtRelative(iso)` helper used by table's Submitted column. |
| `frontend/src/pages/leadership/LeadershipDashboard.jsx` | **MODIFY** | Rewrite the applications table block (lines 236-255) to the 8-column layout. Replace hardcoded industry pills with data from `getIndustryCategories()`. Strip `TIR-`/`SIP-` prefix from search input before send. |
| `frontend/src/pages/leadership/components/AppDrawer.jsx` | **MODIFY** | Header block rewrite per spec §7f. |
| `frontend/src/styles/leadership.css` | **MODIFY** | Add `.lp-cell-project`, `.lp-cell-founder`, `.lp-cell-sub`, `.lp-cell-primary`, `.lp-id-col` rules + tighten table row height for two-line cells. |
| `frontend/src/__tests__/timeFmt.test.js` | **CREATE** | vitest tests for `fmtRelative()` covering all 5 ranges. |

---

## Sequencing Rationale

The plan executes in 7 phases:
1. **Migration first** — landing the SQL gives us new columns to write against. Staging already has it applied OOB; we still commit the file so prod follows the standard path.
2. **AI screener changes** — switch model, extend prompt + parsing, wire handler. Behavior change is gated by `AI_STUB=false`, so default stub behavior is unaffected.
3. **Backfill script** — depends on (1) and (2); populates existing apps.
4. **Backend helpers + endpoint shape** — `stats.py` helpers + `applications_query.py` projections + new endpoint. Tolerant of `industry_category_id=null` and `display_seq=null`.
5. **Frontend table + AppDrawer + CSS** — depends on (4) endpoint shape.
6. **Frontend tests + manual smoke test on staging**.
7. **Documentation + deploy notes**.

Each phase ends with a green test run + commit.

---

# Phase 1 — Migration 017

### Task 1: Write migration 017

**Files:**
- Create: `backend/migrations/017_leadership_table_redesign.sql`

- [ ] **Step 1: Write the migration file**

Verbatim from spec Appendix A, with one addition (the spec didn't include `display_id` index — adding it because the search-by-display_seq path queries on it):

```sql
-- 017_leadership_table_redesign.sql
-- Adds industry_categories taxonomy + ai_screening industry columns + per-track display_seq.
-- Idempotent where possible (IF NOT EXISTS, WHERE display_seq IS NULL).
-- Run once per environment via Supabase SQL editor.

BEGIN;

-- 1. industry_categories table + 7 seeds
CREATE TABLE IF NOT EXISTS industry_categories (
  id text PRIMARY KEY,
  label text NOT NULL UNIQUE,
  created_at timestamptz DEFAULT now(),
  created_by_app_id uuid,
  is_seed boolean DEFAULT false
);

INSERT INTO industry_categories (id, label, is_seed) VALUES
  ('robotics', 'Robotics & Automation',                    true),
  ('health',   'Healthcare / MedTech',                     true),
  ('industry', 'Advanced Manufacturing / Industry 5.0',    true),
  ('defense',  'Defense & Aerospace',                      true),
  ('ai',       'Artificial Intelligence / Foundational Models', true),
  ('semi',     'Semiconductor / Hardware',                 true),
  ('other',    'Other / Frontier',                         true)
ON CONFLICT (id) DO NOTHING;

-- 2. ai_screening new columns
ALTER TABLE ai_screening
  ADD COLUMN IF NOT EXISTS industry_category_id text
    REFERENCES industry_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS industry_confidence numeric(3,2);

CREATE INDEX IF NOT EXISTS idx_ai_screening_industry_category
  ON ai_screening (industry_category_id);

-- 3. display_seq columns + sequences
ALTER TABLE tir_applications ADD COLUMN IF NOT EXISTS display_seq integer UNIQUE;
ALTER TABLE sip_applications ADD COLUMN IF NOT EXISTS display_seq integer UNIQUE;

CREATE SEQUENCE IF NOT EXISTS tir_display_seq START 26001;
CREATE SEQUENCE IF NOT EXISTS sip_display_seq START 26001;

-- 4. Backfill display_seq for existing rows (oldest first)
WITH ordered AS (
  SELECT id,
         ROW_NUMBER() OVER (ORDER BY submitted_at ASC NULLS LAST, created_at ASC) + 26000 AS seq
    FROM tir_applications
)
UPDATE tir_applications t
   SET display_seq = o.seq
  FROM ordered o
 WHERE t.id = o.id
   AND t.display_seq IS NULL;

WITH ordered AS (
  SELECT id,
         ROW_NUMBER() OVER (ORDER BY submitted_at ASC NULLS LAST, created_at ASC) + 26000 AS seq
    FROM sip_applications
)
UPDATE sip_applications s
   SET display_seq = o.seq
  FROM ordered o
 WHERE s.id = o.id
   AND s.display_seq IS NULL;

-- 5. Bump sequences past the backfilled max so future inserts don't collide
SELECT setval('tir_display_seq', COALESCE((SELECT MAX(display_seq) FROM tir_applications), 26000));
SELECT setval('sip_display_seq', COALESCE((SELECT MAX(display_seq) FROM sip_applications), 26000));

-- 6. Defaults + NOT NULL on display_seq for future inserts
ALTER TABLE tir_applications ALTER COLUMN display_seq SET DEFAULT nextval('tir_display_seq');
ALTER TABLE tir_applications ALTER COLUMN display_seq SET NOT NULL;

ALTER TABLE sip_applications ALTER COLUMN display_seq SET DEFAULT nextval('sip_display_seq');
ALTER TABLE sip_applications ALTER COLUMN display_seq SET NOT NULL;

COMMIT;
```

- [ ] **Step 2: Verify the SQL is syntactically valid**

Run:
```bash
cd /Users/apple/Desktop/Final_AP_os && python3 -c "
import re
with open('backend/migrations/017_leadership_table_redesign.sql') as f:
    sql = f.read()
assert sql.strip().startswith('BEGIN'), 'must start with BEGIN'
assert sql.rstrip().endswith('COMMIT;'), 'must end with COMMIT;'
assert 'industry_categories' in sql
assert 'display_seq' in sql
assert sql.count('BEGIN;') == 1, 'single transaction'
assert sql.count('COMMIT;') == 1, 'single transaction'
print('OK')
"
```
Expected output: `OK`.

- [ ] **Step 3: Note staging status**

Add a comment in the commit message that staging Supabase already has this SQL applied out-of-band on 2026-05-20; this file exists so prod follows the standard path.

- [ ] **Step 4: Commit**

```bash
git add backend/migrations/017_leadership_table_redesign.sql
git commit -m "feat(leadership): add migration 017 (industry_categories + display_seq)

Idempotent SQL: industry_categories taxonomy table + 7 seeds, ai_screening
industry columns, per-track display_seq integer sequences (start 26001) with
oldest-first backfill of existing rows.

Staging Supabase already has this applied OOB on 2026-05-20; file committed
so the prod deploy follows the standard migration path."
```

---

# Phase 2 — AI screener: industry classification

### Task 2: Shared `industry_categories` service module

**Files:**
- Create: `backend/app/services/industry_categories.py`
- Create: `backend/tests/test_industry_categories.py`

- [ ] **Step 1: Write the failing test**

`backend/tests/test_industry_categories.py`:
```python
"""Tests for backend/app/services/industry_categories.py."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.services import industry_categories


def _mock_client_with(categories: list[dict]) -> MagicMock:
    """Build a chain-mock Supabase client that returns `categories` from
    industry_categories.select().order().order().execute()."""
    client = MagicMock()
    chain = client.table.return_value.select.return_value
    chain.order.return_value.order.return_value.execute.return_value = SimpleNamespace(
        data=categories,
    )
    return client


def test_fetch_categories_returns_sorted_list(monkeypatch):
    rows = [
        {"id": "ai", "label": "AI", "is_seed": True, "created_at": "2026-05-20T00:00:00Z"},
        {"id": "robotics", "label": "Robotics", "is_seed": True, "created_at": "2026-05-20T00:00:00Z"},
    ]
    client = _mock_client_with(rows)
    monkeypatch.setattr(industry_categories, "get_admin_client", lambda: client)

    result = industry_categories.fetch_categories()

    assert [c["id"] for c in result] == ["ai", "robotics"]
    assert result[0]["label"] == "AI"


def test_fetch_categories_empty(monkeypatch):
    client = _mock_client_with([])
    monkeypatch.setattr(industry_categories, "get_admin_client", lambda: client)
    assert industry_categories.fetch_categories() == []


def test_create_category_under_cap(monkeypatch):
    # 5 existing → 7 more allowed before cap 12
    existing = [{"id": f"cat{i}", "label": f"Cat{i}", "is_seed": True} for i in range(5)]
    client = _mock_client_with(existing)
    insert_mock = MagicMock()
    insert_mock.execute.return_value = SimpleNamespace(data=[{"id": "newcat"}])
    client.table.return_value.insert.return_value = insert_mock
    monkeypatch.setattr(industry_categories, "get_admin_client", lambda: client)

    ok = industry_categories.create_category_if_under_cap(
        category_id="newcat",
        label="New Category",
        created_by_app_id="00000000-0000-0000-0000-000000000001",
    )

    assert ok is True
    client.table.assert_any_call("industry_categories")
    insert_args = client.table.return_value.insert.call_args[0][0]
    assert insert_args["id"] == "newcat"
    assert insert_args["label"] == "New Category"
    assert insert_args["is_seed"] is False


def test_create_category_at_cap_refused(monkeypatch):
    # 12 existing → at cap
    existing = [{"id": f"cat{i}", "label": f"Cat{i}", "is_seed": True} for i in range(12)]
    client = _mock_client_with(existing)
    monkeypatch.setattr(industry_categories, "get_admin_client", lambda: client)

    ok = industry_categories.create_category_if_under_cap(
        category_id="newcat",
        label="New Category",
        created_by_app_id=None,
    )

    assert ok is False
    # The insert call must NOT have happened.
    insert_chain = client.table.return_value.insert
    insert_chain.assert_not_called()
```

- [ ] **Step 2: Run tests — expect import failure**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend && pytest tests/test_industry_categories.py -v
```
Expected: ImportError for `app.services.industry_categories`.

- [ ] **Step 3: Implement the module**

`backend/app/services/industry_categories.py`:
```python
"""Industry taxonomy service.

Single source of truth for the `industry_categories` table. Used by:
  - the AI screener worker (passes the list to the LLM prompt + inserts
    LLM-proposed new categories under the cap)
  - the `backfill_industry.py` script
  - the `GET /leadership/industry-categories` endpoint

Cap = 12 (spec §3a). Once 12 rows exist, `create_category_if_under_cap`
refuses to insert and returns False; callers must fall back to an existing
category (typically `other`).
"""

from __future__ import annotations

import logging
from typing import Any

from ..supabase_client import get_admin_client

log = logging.getLogger(__name__)

# Hard cap on the number of industry_categories rows (spec §3a).
CATEGORY_CAP = 12


def fetch_categories() -> list[dict[str, Any]]:
    """Return all rows from `industry_categories` ordered by seed-first then
    oldest-first. Returns an empty list on query error so callers can fall
    back without 500-ing the request."""
    try:
        res = (
            get_admin_client()
            .table("industry_categories")
            .select("id,label,is_seed,created_at,created_by_app_id")
            .order("is_seed", desc=True)
            .order("created_at", desc=False)
            .execute()
        )
        return res.data or []
    except Exception as exc:
        log.warning("industry_categories.fetch_categories failed", extra={"err": str(exc)})
        return []


def create_category_if_under_cap(
    *,
    category_id: str,
    label: str,
    created_by_app_id: str | None,
) -> bool:
    """Race-safe insert. Returns True if the new row was inserted (or already
    existed under the same id — ON CONFLICT DO NOTHING is idempotent),
    False if the table is at or over the cap.

    The cap check is best-effort (read-then-write): if two writers see 11
    and both decide to insert, the second will succeed too and the table
    will briefly hit 13. Acceptable for Phase 1 — the LLM is conservative
    about proposing new categories so the race window is small."""
    existing = fetch_categories()
    if len(existing) >= CATEGORY_CAP:
        log.info(
            "create_category_if_under_cap refused (cap=%d already met)",
            CATEGORY_CAP,
        )
        return False

    try:
        (
            get_admin_client()
            .table("industry_categories")
            .insert(
                {
                    "id": category_id,
                    "label": label,
                    "created_by_app_id": created_by_app_id,
                    "is_seed": False,
                },
            )
            .execute()
        )
        return True
    except Exception as exc:
        log.warning(
            "industry_categories.create_category_if_under_cap failed",
            extra={"id": category_id, "err": str(exc)},
        )
        return False


def categories_with_counts() -> dict[str, Any]:
    """Compose the payload used by `GET /leadership/industry-categories`.

    Returns:
      {
        "categories": [{"id", "label", "count"}, ...] sorted by count desc
                      then is_seed desc; empty categories hidden,
        "total":       sum of all counts,
        "cap":         CATEGORY_CAP,
        "remaining_slots": CATEGORY_CAP - len(all_categories)
      }
    """
    cats = fetch_categories()
    # Count assignments — single projection on ai_screening.
    try:
        res = (
            get_admin_client()
            .table("ai_screening")
            .select("industry_category_id")
            .not_.is_("industry_category_id", "null")
            .limit(50_000)
            .execute()
        )
        rows = res.data or []
    except Exception as exc:
        log.warning("industry_categories.categories_with_counts query failed", extra={"err": str(exc)})
        rows = []

    counts: dict[str, int] = {}
    for r in rows:
        cid = r.get("industry_category_id")
        if cid:
            counts[cid] = counts.get(cid, 0) + 1

    by_id = {c["id"]: c for c in cats}
    visible = []
    for cid, n in counts.items():
        cat = by_id.get(cid)
        if not cat:
            continue
        visible.append(
            {
                "id": cid,
                "label": cat["label"],
                "count": n,
                "is_seed": bool(cat.get("is_seed", False)),
            }
        )

    visible.sort(key=lambda c: (-c["count"], not c["is_seed"], c["id"]))
    return {
        "categories": [
            {"id": c["id"], "label": c["label"], "count": c["count"]} for c in visible
        ],
        "total": sum(counts.values()),
        "cap": CATEGORY_CAP,
        "remaining_slots": max(0, CATEGORY_CAP - len(cats)),
    }
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend && pytest tests/test_industry_categories.py -v
```
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/industry_categories.py backend/tests/test_industry_categories.py
git commit -m "feat(leadership): industry_categories service with 12-cap"
```

---

### Task 3: Bump AI screener model + extend prompt for industry classification

**Files:**
- Modify: `backend/workers/ai_screener/openrouter_client.py`
- Modify: `backend/workers/ai_screener/scoring.py`
- Modify: `backend/tests/test_ai_screener.py`

- [ ] **Step 1: Extend `ScoreResult` with industry fields**

In `backend/workers/ai_screener/scoring.py`, add three optional fields to the dataclass:

```python
@dataclass(frozen=True)
class ScoreResult:
    """Result returned by either the stub scorer or the OpenRouter client.

    score_integrity is intentionally absent — it stays NULL in Phase 1 and
    the worker sets it to None when upserting to ai_screening.
    """

    score_problem: float
    score_solution: float
    score_tech: float
    score_founders: float
    score_commitment: float
    score_overall: float
    summary: str
    model: str
    raw_response: str
    industry_category_id: str | None = None
    industry_confidence: float | None = None
    new_industry_proposal: dict | None = None  # {"id": "...", "label": "..."} or None
```

- [ ] **Step 2: Write failing test for the new openrouter signature**

Add to `backend/tests/test_ai_screener.py`:

```python
def test_score_application_includes_categories_in_prompt(monkeypatch):
    """The category list and slots_remaining must appear in the user message
    so the LLM can pick or propose appropriately."""
    from backend.workers.ai_screener import openrouter_client

    captured: dict = {}

    class _Resp:
        status_code = 200

        @staticmethod
        def raise_for_status():
            pass

        text = '{"choices":[{"message":{"content":"{\\"problem\\":7,\\"solution\\":8,\\"tech\\":7,\\"founders\\":6,\\"commitment\\":7,\\"summary\\":\\"ok\\",\\"industry\\":{\\"category_id\\":\\"robotics\\",\\"industry_confidence\\":0.9}}"}}]}'

        def json(self):
            import json as _json

            return _json.loads(self.text)

    class _Client:
        def __init__(self, *a, **kw):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, headers, json):
            captured["payload"] = json
            return _Resp()

    monkeypatch.setattr(openrouter_client.httpx, "Client", _Client)
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    categories = [
        {"id": "robotics", "label": "Robotics & Automation", "is_seed": True},
        {"id": "ai", "label": "Artificial Intelligence", "is_seed": True},
    ]

    result = openrouter_client.score_application(
        app_row={
            "basic_full_name": "Test",
            "problem_describe": "warehouse picking is slow",
            "solution_describe": "an autonomous robot arm",
            "solution_core_tech": "vision + ROS",
        },
        categories=categories,
        slots_remaining=10,
    )

    assert result.industry_category_id == "robotics"
    assert result.industry_confidence == 0.9
    # The category list must be in the user message:
    user_msg = captured["payload"]["messages"][1]["content"]
    assert "robotics" in user_msg
    assert "Robotics & Automation" in user_msg
    assert "slots_remaining" in user_msg.lower() or "10 more" in user_msg.lower()


def test_score_application_handles_new_category_proposal(monkeypatch):
    """When LLM proposes a new category, ScoreResult.new_industry_proposal
    is populated and industry_category_id stays None until the handler
    decides whether the cap allows insertion."""
    from backend.workers.ai_screener import openrouter_client

    class _Resp:
        status_code = 200

        @staticmethod
        def raise_for_status():
            pass

        text = '{"choices":[{"message":{"content":"{\\"problem\\":7,\\"solution\\":8,\\"tech\\":7,\\"founders\\":6,\\"commitment\\":7,\\"summary\\":\\"ok\\",\\"industry\\":{\\"new_category\\":{\\"id\\":\\"climate_tech\\",\\"label\\":\\"Climate Tech\\"},\\"industry_confidence\\":0.85}}"}}]}'

        def json(self):
            import json as _json

            return _json.loads(self.text)

    class _Client:
        def __init__(self, *a, **kw):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, *a, **kw):
            return _Resp()

    monkeypatch.setattr(openrouter_client.httpx, "Client", _Client)
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    result = openrouter_client.score_application(
        app_row={"solution_describe": "carbon capture"},
        categories=[{"id": "ai", "label": "AI", "is_seed": True}],
        slots_remaining=11,
    )

    assert result.industry_category_id is None
    assert result.new_industry_proposal == {"id": "climate_tech", "label": "Climate Tech"}
    assert result.industry_confidence == 0.85
```

- [ ] **Step 3: Run tests — expect failure**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend && pytest tests/test_ai_screener.py::test_score_application_includes_categories_in_prompt tests/test_ai_screener.py::test_score_application_handles_new_category_proposal -v
```
Expected: 2 tests fail — `score_application()` doesn't take `categories` argument yet.

- [ ] **Step 4: Update `openrouter_client.py`**

Apply these changes to `backend/workers/ai_screener/openrouter_client.py`:

```python
"""OpenRouter client for AI application screening.

Calls ``google/gemini-2.5-flash`` via the OpenRouter API and parses the
JSON response into a ScoreResult. Uses synchronous ``httpx.Client`` with a
30-second timeout (Phase 1 acceptable).

The single LLM call returns BOTH the 5-dimension score AND an industry
classification, chosen from the caller-supplied category list (capped at
12 by industry_categories service). See spec §3b.

Public surface:
    score_application(app_row, categories, slots_remaining) -> ScoreResult

Raises:
    OpenRouterParseError: if the model response is not valid JSON or is
        missing required keys. The caller (handler.py) treats this as a
        retryable failure and adds the message to batchItemFailures.
"""

from __future__ import annotations

import json
import logging
import os

import httpx

from .scoring import ScoreResult, compute_overall

log = logging.getLogger(__name__)

_OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
_MODEL = "google/gemini-2.5-flash"
_TIMEOUT = 30.0

_SYSTEM_PROMPT = (
    "You are an evaluator for ARTPARK's startup incubation programme. "
    "Score the applicant on 5 dimensions, each 0.0–10.0, AND classify "
    "the venture into an industry category from a closed list. "
    "Reply ONLY with valid JSON of the shape: "
    '{"problem": float, "solution": float, "tech": float, '
    '"founders": float, "commitment": float, '
    '"summary": string of up to 200 words, '
    '"industry": {'
    '  // either an existing match...'
    '  "category_id": "<existing id from the list>", '
    '  // ...or a new proposal (only if slots_remaining > 0 and confidence ≥ 0.7)'
    '  "new_category": {"id": "<slug>", "label": "<display>"}, '
    '  "industry_confidence": 0.0-1.0'
    "}}. "
    "Use `category_id` for existing matches, `new_category` for proposals. "
    "Prefer reusing existing categories — only propose a new one if NONE "
    "of the existing categories describes the venture's primary domain "
    "AND slots_remaining > 0 AND the new category would clearly fit "
    "≥3 plausible future ventures (no hyper-specific labels). For "
    "multi-domain ventures (e.g. a medical robot), prefer the bucket "
    "matching the primary differentiator described in solution_core_tech."
)


class OpenRouterParseError(Exception):
    """Raised when the model response cannot be parsed into a ScoreResult."""


def _build_user_message(
    app_row: dict,
    categories: list[dict],
    slots_remaining: int,
) -> str:
    """Compose a user message: applicant text + current category list +
    slots_remaining."""
    parts: list[str] = []

    name = app_row.get("basic_full_name") or ""
    org = app_row.get("basic_org_name") or app_row.get("basic_org") or ""
    problem = app_row.get("problem_describe") or ""
    solution = app_row.get("solution_describe") or ""
    tech = app_row.get("solution_core_tech") or ""

    if name:
        parts.append(f"Applicant: {name}")
    if org:
        parts.append(f"Organisation: {org}")
    if problem:
        parts.append(f"Problem: {problem}")
    if solution:
        parts.append(f"Solution: {solution}")
    if tech:
        parts.append(f"Core technology: {tech}")

    # Industry classification context
    cat_lines = "\n".join(
        f"  - {c['id']}: {c['label']}" for c in categories
    )
    parts.append(
        "Existing industry categories:\n"
        f"{cat_lines}\n"
        f"slots_remaining for new categories: {slots_remaining}"
    )

    return "\n\n".join(parts) if parts else "No application details provided."


def _parse_industry(parsed: dict) -> tuple[str | None, float | None, dict | None]:
    """Extract industry fields from the parsed LLM JSON.

    Returns (category_id, confidence, new_proposal).
    Tolerant: missing industry block returns all None.
    """
    ind = parsed.get("industry")
    if not isinstance(ind, dict):
        return None, None, None

    conf_raw = ind.get("industry_confidence")
    try:
        conf = float(conf_raw) if conf_raw is not None else None
    except (TypeError, ValueError):
        conf = None

    new_cat = ind.get("new_category")
    if isinstance(new_cat, dict) and new_cat.get("id") and new_cat.get("label"):
        return None, conf, {"id": str(new_cat["id"]), "label": str(new_cat["label"])}

    cid = ind.get("category_id")
    if isinstance(cid, str) and cid:
        return cid, conf, None

    return None, conf, None


def score_application(
    app_row: dict,
    categories: list[dict] | None = None,
    slots_remaining: int = 0,
) -> ScoreResult:
    """Call OpenRouter and return a ScoreResult including industry fields.

    Args:
        app_row: A dict containing the application's database columns.
        categories: Current rows from `industry_categories`. Each dict must
            have at least `id` and `label`. Passed to the LLM so it can pick
            an existing match. If None or empty, industry classification is
            skipped (kept as None on the result).
        slots_remaining: Number of unused slots before hitting the 12-cap.
            Passed to the LLM so it knows whether to propose new categories.

    Raises:
        OpenRouterParseError: malformed response.
        httpx.HTTPError: network failures (retryable).
    """
    api_key = os.getenv("OPENROUTER_API_KEY", "")
    user_message = _build_user_message(app_row, categories or [], slots_remaining)

    payload = {
        "model": _MODEL,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.2,
    }

    with httpx.Client(timeout=_TIMEOUT) as client:
        response = client.post(
            _OPENROUTER_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        response.raise_for_status()

    raw_text = response.text
    log.debug("OpenRouter raw response: %s", raw_text[:500])

    try:
        outer = response.json()
        content = outer["choices"][0]["message"]["content"]
    except (KeyError, IndexError, json.JSONDecodeError) as exc:
        raise OpenRouterParseError(
            f"Unexpected OpenRouter response structure: {exc}"
        ) from exc

    # Tolerate ```json ... ``` fences (the 5343da6 commit pattern).
    stripped = content.strip()
    if stripped.startswith("```"):
        stripped = stripped.strip("`")
        # Drop the leading 'json\n' tag if present
        if stripped.lower().startswith("json"):
            stripped = stripped[4:].lstrip("\n")

    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError as exc:
        raise OpenRouterParseError(
            f"Model did not return valid JSON: {exc}\nContent: {content[:200]}"
        ) from exc

    required_keys = {"problem", "solution", "tech", "founders", "commitment", "summary"}
    missing = required_keys - parsed.keys()
    if missing:
        raise OpenRouterParseError(
            f"Model response missing keys: {missing}\nContent: {content[:200]}"
        )

    try:
        p = float(parsed["problem"])
        sol = float(parsed["solution"])
        t = float(parsed["tech"])
        f = float(parsed["founders"])
        c = float(parsed["commitment"])
        summary = str(parsed["summary"])
    except (TypeError, ValueError) as exc:
        raise OpenRouterParseError(
            f"Could not convert model scores to float: {exc}"
        ) from exc

    overall = compute_overall(p, sol, t, f, c)
    industry_id, industry_conf, new_proposal = _parse_industry(parsed)

    return ScoreResult(
        score_problem=p,
        score_solution=sol,
        score_tech=t,
        score_founders=f,
        score_commitment=c,
        score_overall=overall,
        summary=summary,
        model=_MODEL,
        raw_response=raw_text,
        industry_category_id=industry_id,
        industry_confidence=industry_conf,
        new_industry_proposal=new_proposal,
    )
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend && pytest tests/test_ai_screener.py -v
```
Expected: all pass (existing tests use `score_application(app_row)` with default `categories=None`, so they still work).

- [ ] **Step 6: Commit**

```bash
git add backend/workers/ai_screener/openrouter_client.py backend/workers/ai_screener/scoring.py backend/tests/test_ai_screener.py
git commit -m "feat(ai-screener): industry classification in single LLM call

Bumps model to google/gemini-2.5-flash. Extends the system prompt to also
classify the venture into an industry category from a caller-supplied list
(capped at 12 in the industry_categories table). Adds industry_category_id,
industry_confidence, new_industry_proposal fields to ScoreResult. Falls back
gracefully when categories list is empty."
```

---

### Task 4: Wire industry classification into the screener handler

**Files:**
- Modify: `backend/workers/ai_screener/handler.py`
- Modify: `backend/tests/test_ai_screener.py`

- [ ] **Step 1: Write failing test**

Add to `backend/tests/test_ai_screener.py`:

```python
def test_handler_upserts_industry_category(monkeypatch):
    """When the real scorer returns industry_category_id, the handler must
    include it in the ai_screening upsert."""
    from backend.workers.ai_screener import handler

    monkeypatch.setenv("AI_STUB", "false")

    # Fake categories load
    monkeypatch.setattr(
        "app.services.industry_categories.fetch_categories",
        lambda: [{"id": "robotics", "label": "Robotics", "is_seed": True}],
    )

    # Capture upserted row
    captured: dict = {}

    class _Table:
        def __init__(self, name):
            self.name = name

        def select(self, *a, **kw):
            self._sel = (a, kw)
            return self

        def eq(self, *a, **kw):
            return self

        def maybe_single(self):
            return self

        def upsert(self, row, on_conflict=None):
            captured["row"] = row
            captured["on_conflict"] = on_conflict
            return self

        def insert(self, row):
            captured.setdefault("inserts", []).append((self.name, row))
            return self

        def update(self, row):
            return self

        def execute(self):
            if self.name == "tir_applications" and "_sel" in self.__dict__:
                # Return a fake app row for the SELECT
                from types import SimpleNamespace

                return SimpleNamespace(
                    data={
                        "id": "11111111-1111-1111-1111-111111111111",
                        "status": "submitted",
                        "basic_full_name": "Test",
                        "basic_org": "Org",
                        "problem_describe": "p",
                        "solution_describe": "robotic arm",
                        "solution_core_tech": "ros",
                    }
                )
            from types import SimpleNamespace

            return SimpleNamespace(data=None)

    class _Client:
        def table(self, name):
            return _Table(name)

    monkeypatch.setattr(handler, "get_admin_client", lambda: _Client())

    # Fake scorer returns industry_category_id="robotics"
    from backend.workers.ai_screener.scoring import ScoreResult

    fake_result = ScoreResult(
        score_problem=7.0,
        score_solution=8.0,
        score_tech=7.0,
        score_founders=6.0,
        score_commitment=7.0,
        score_overall=7.2,
        summary="ok",
        model="google/gemini-2.5-flash",
        raw_response="{}",
        industry_category_id="robotics",
        industry_confidence=0.92,
        new_industry_proposal=None,
    )
    monkeypatch.setattr(
        "backend.workers.ai_screener.openrouter_client.score_application",
        lambda app_row, categories, slots_remaining: fake_result,
    )

    handler._process_record(
        {
            "messageId": "m1",
            "body": '{"application_id": "11111111-1111-1111-1111-111111111111", "application_track": "tir"}',
        }
    )

    assert captured["row"]["industry_category_id"] == "robotics"
    assert captured["row"]["industry_confidence"] == 0.92


def test_handler_creates_new_category_when_under_cap(monkeypatch):
    from backend.workers.ai_screener import handler

    monkeypatch.setenv("AI_STUB", "false")

    monkeypatch.setattr(
        "app.services.industry_categories.fetch_categories",
        lambda: [{"id": "robotics", "label": "Robotics", "is_seed": True}],
    )

    create_calls = []

    def fake_create(*, category_id, label, created_by_app_id):
        create_calls.append({"id": category_id, "label": label, "app_id": created_by_app_id})
        return True

    monkeypatch.setattr(
        "app.services.industry_categories.create_category_if_under_cap",
        fake_create,
    )

    # Minimal client mock as above (reused pattern); upserts captured but
    # we mainly assert on create_calls.
    captured = {}

    class _Table:
        def __init__(self, name):
            self.name = name

        def select(self, *a, **kw):
            return self

        def eq(self, *a, **kw):
            return self

        def maybe_single(self):
            return self

        def upsert(self, row, on_conflict=None):
            captured["row"] = row
            return self

        def insert(self, row):
            return self

        def update(self, row):
            return self

        def execute(self):
            from types import SimpleNamespace

            if self.name == "tir_applications":
                return SimpleNamespace(
                    data={
                        "id": "22222222-2222-2222-2222-222222222222",
                        "status": "submitted",
                        "basic_full_name": "Test",
                        "basic_org": "Org",
                        "problem_describe": "carbon",
                        "solution_describe": "DAC",
                        "solution_core_tech": "absorbent",
                    }
                )
            return SimpleNamespace(data=None)

    class _Client:
        def table(self, name):
            return _Table(name)

    monkeypatch.setattr(handler, "get_admin_client", lambda: _Client())

    from backend.workers.ai_screener.scoring import ScoreResult

    fake_result = ScoreResult(
        score_problem=7.0,
        score_solution=8.0,
        score_tech=7.0,
        score_founders=6.0,
        score_commitment=7.0,
        score_overall=7.2,
        summary="ok",
        model="google/gemini-2.5-flash",
        raw_response="{}",
        industry_category_id=None,
        industry_confidence=0.85,
        new_industry_proposal={"id": "climate_tech", "label": "Climate Tech"},
    )
    monkeypatch.setattr(
        "backend.workers.ai_screener.openrouter_client.score_application",
        lambda app_row, categories, slots_remaining: fake_result,
    )

    handler._process_record(
        {
            "messageId": "m1",
            "body": '{"application_id": "22222222-2222-2222-2222-222222222222", "application_track": "tir"}',
        }
    )

    assert len(create_calls) == 1
    assert create_calls[0]["id"] == "climate_tech"
    assert captured["row"]["industry_category_id"] == "climate_tech"
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend && pytest tests/test_ai_screener.py::test_handler_upserts_industry_category tests/test_ai_screener.py::test_handler_creates_new_category_when_under_cap -v
```
Expected: both fail — handler doesn't load categories or write industry fields.

- [ ] **Step 3: Update `handler.py`**

Apply these changes:

3a. Add import near the top:
```python
from app.services import industry_categories
```

3b. Replace `_score()`:
```python
def _score(
    application_id: str,
    app_row: dict,
    *,
    categories: list[dict],
    slots_remaining: int,
) -> ScoreResult:
    """Dispatch to stub or real scorer based on AI_STUB env var."""
    if _is_stub_mode():
        log.info("AI_STUB=true — using deterministic stub scorer")
        return stub_module.score(application_id)
    log.info("AI_STUB=false — calling OpenRouter")
    return openrouter_client.score_application(
        app_row,
        categories=categories,
        slots_remaining=slots_remaining,
    )
```

3c. Replace `_upsert_ai_screening()` to include industry columns:
```python
def _upsert_ai_screening(
    client: Any,
    application_id: str,
    application_track: str,
    result: ScoreResult,
) -> None:
    """Write the scoring result to ai_screening, replacing any prior row."""
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "application_id": application_id,
        "application_track": application_track,
        "score_problem": result.score_problem,
        "score_solution": result.score_solution,
        "score_tech": result.score_tech,
        "score_founders": result.score_founders,
        "score_commitment": result.score_commitment,
        "score_integrity": None,
        "score_overall": result.score_overall,
        "confidence": None,
        "summary": result.summary,
        "flags": [],
        "raw_response": result.raw_response,
        "model": result.model,
        "ran_at": now,
        "error": None,
        "industry_category_id": result.industry_category_id,
        "industry_confidence": result.industry_confidence,
    }
    client.table("ai_screening").upsert(
        row, on_conflict="application_id,application_track"
    ).execute()
    log.info(
        "Upserted ai_screening for application_id=%s track=%s overall=%.1f industry=%s",
        application_id,
        application_track,
        result.score_overall,
        result.industry_category_id,
    )
```

3d. Insert category creation logic into `_process_record()`, replacing the existing Step 3 (`# ── 3. Score`) section through Step 4:

```python
    # ── 3. Score (load category list first so LLM can choose existing) ────
    cats = industry_categories.fetch_categories()
    slots_remaining = max(0, industry_categories.CATEGORY_CAP - len(cats))
    result = _score(application_id, app_row, categories=cats, slots_remaining=slots_remaining)

    # ── 3a. If LLM proposed a new category and slots remain, create it ────
    if (
        result.new_industry_proposal
        and slots_remaining > 0
        and result.industry_confidence is not None
        and result.industry_confidence >= 0.7
    ):
        proposal = result.new_industry_proposal
        created = industry_categories.create_category_if_under_cap(
            category_id=proposal["id"],
            label=proposal["label"],
            created_by_app_id=application_id,
        )
        if created:
            # Re-attach the new id to the result so the upsert writes it.
            result = ScoreResult(
                **{**result.__dict__, "industry_category_id": proposal["id"]}
            )

    # ── 4. Upsert ai_screening ────────────────────────────────────────────
    _upsert_ai_screening(client, application_id, application_track, result)
```

Note: ScoreResult is a frozen dataclass; rebuild via `**dict_unpack`. (The `__dict__` access works on frozen dataclasses for read.)

3e. Update the `_score()` call in `_process_record()` — already done in 3d above.

- [ ] **Step 4: Run all ai_screener tests**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend && pytest tests/test_ai_screener.py -v
```
Expected: all pass.

- [ ] **Step 5: Run full backend test suite for regressions**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend && pytest -m 'not integration' --tb=short
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/workers/ai_screener/handler.py backend/tests/test_ai_screener.py
git commit -m "feat(ai-screener): handler writes industry + creates new categories under cap

Handler now loads the current industry_categories list before scoring,
passes it (and slots_remaining) to the OpenRouter client, and after
scoring may create a new category row when the LLM proposed one,
confidence ≥ 0.7, and slots remain. industry_category_id and
industry_confidence are upserted to ai_screening alongside the scores."
```

---

# Phase 3 — Backfill script

### Task 5: Standalone backfill script for existing apps

**Files:**
- Create: `backend/scripts/backfill_industry.py`

- [ ] **Step 1: Read the `seed_staging.py` pattern**

```bash
head -100 /Users/apple/Desktop/Final_AP_os/backend/scripts/seed_staging.py
```
(Read for argparse + dotenv + sys.path patterns; don't modify.)

- [ ] **Step 2: Write the script**

`backend/scripts/backfill_industry.py`:

```python
#!/usr/bin/env python3
"""Backfill industry_category_id for existing applications.

Iterates non-draft apps from both tracks (oldest first), runs an
industry-only LLM prompt for each, and UPDATES `ai_screening` with
`industry_category_id` + `industry_confidence`. Idempotent — skips
rows already populated.

Usage:
    OPENROUTER_API_KEY=... \
    SUPABASE_URL=... \
    SUPABASE_SERVICE_ROLE_KEY=... \
    python -m backend.scripts.backfill_industry [--dry-run] [--limit N]

Environment is loaded from backend/.env or backend/.env.staging.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path

# Add backend/ to sys.path so `app.*` imports work.
_BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

try:
    from dotenv import load_dotenv

    # Prefer .env.staging if present, else .env
    for envname in (".env.staging", ".env"):
        envpath = _BACKEND_DIR / envname
        if envpath.exists():
            load_dotenv(envpath)
            break
except ImportError:
    pass

import httpx  # noqa: E402

from app.services import industry_categories  # noqa: E402
from app.supabase_client import get_admin_client  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("backfill_industry")

_OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
_MODEL = "google/gemini-2.5-flash"

_INDUSTRY_ONLY_SYSTEM_PROMPT = (
    "You are classifying a startup application into an industry category. "
    "Reply ONLY with valid JSON of the shape: "
    '{"industry": {"category_id": "<existing id>" OR "new_category": '
    '{"id": "<slug>", "label": "<display>"}, "industry_confidence": 0.0-1.0}}. '
    "Pick the best EXISTING match. Only propose a new category if NONE "
    "of the existing categories describes the venture's primary domain "
    "AND slots_remaining > 0 AND the new category would clearly fit "
    "≥3 plausible future ventures."
)


def _build_user_message(app_row: dict, categories: list[dict], slots_remaining: int) -> str:
    parts = []
    if app_row.get("basic_full_name"):
        parts.append(f"Applicant: {app_row['basic_full_name']}")
    if app_row.get("problem_describe"):
        parts.append(f"Problem: {app_row['problem_describe']}")
    if app_row.get("solution_describe"):
        parts.append(f"Solution: {app_row['solution_describe']}")
    if app_row.get("solution_core_tech"):
        parts.append(f"Core technology: {app_row['solution_core_tech']}")
    cat_lines = "\n".join(f"  - {c['id']}: {c['label']}" for c in categories)
    parts.append(
        "Existing industry categories:\n"
        f"{cat_lines}\n"
        f"slots_remaining for new categories: {slots_remaining}"
    )
    return "\n\n".join(parts)


def _call_openrouter(user_message: str) -> dict:
    api_key = os.environ.get("OPENROUTER_API_KEY", "")
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY is not set")
    payload = {
        "model": _MODEL,
        "messages": [
            {"role": "system", "content": _INDUSTRY_ONLY_SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.2,
    }
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(
            _OPENROUTER_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        resp.raise_for_status()
    content = resp.json()["choices"][0]["message"]["content"]
    stripped = content.strip()
    if stripped.startswith("```"):
        stripped = stripped.strip("`")
        if stripped.lower().startswith("json"):
            stripped = stripped[4:].lstrip("\n")
    return json.loads(stripped)


def _classify(app_row: dict) -> tuple[str | None, float | None, dict | None]:
    cats = industry_categories.fetch_categories()
    slots_remaining = max(0, industry_categories.CATEGORY_CAP - len(cats))
    user_msg = _build_user_message(app_row, cats, slots_remaining)
    parsed = _call_openrouter(user_msg)
    ind = parsed.get("industry") or {}
    conf_raw = ind.get("industry_confidence")
    try:
        conf = float(conf_raw) if conf_raw is not None else None
    except (TypeError, ValueError):
        conf = None
    new_cat = ind.get("new_category")
    if isinstance(new_cat, dict) and new_cat.get("id") and new_cat.get("label"):
        return None, conf, {"id": str(new_cat["id"]), "label": str(new_cat["label"])}
    cid = ind.get("category_id")
    if isinstance(cid, str) and cid:
        return cid, conf, None
    return None, conf, None


def _fetch_apps_to_backfill(track: str, client) -> list[dict]:
    """Return non-draft apps that DON'T yet have industry_category_id set."""
    table = f"{track}_applications"
    # We can't join in supabase-py easily; fetch all non-draft apps, then
    # filter by checking ai_screening separately.
    res = (
        client.table(table)
        .select("id,submitted_at,created_at,basic_full_name,problem_describe,solution_describe,solution_core_tech,basic_org")
        .neq("status", "draft")
        .order("submitted_at", desc=False, nullsfirst=False)
        .order("created_at", desc=False)
        .execute()
    )
    apps = res.data or []
    if not apps:
        return []

    ids = [a["id"] for a in apps]
    screening_res = (
        client.table("ai_screening")
        .select("application_id,industry_category_id")
        .eq("application_track", track)
        .in_("application_id", ids)
        .execute()
    )
    populated_ids = {
        r["application_id"]
        for r in (screening_res.data or [])
        if r.get("industry_category_id") is not None
    }

    return [a for a in apps if a["id"] not in populated_ids]


def _update_industry(
    client,
    application_id: str,
    track: str,
    category_id: str,
    confidence: float | None,
) -> None:
    """UPDATE ai_screening for the row, or INSERT a placeholder if missing.

    Insert path: an app submitted before AI screener landed has no
    ai_screening row at all. We create one with only the industry fields
    populated so subsequent re-scoring slots in cleanly via UPSERT.
    """
    res = (
        client.table("ai_screening")
        .select("application_id")
        .eq("application_id", application_id)
        .eq("application_track", track)
        .limit(1)
        .execute()
    )
    if res.data:
        client.table("ai_screening").update(
            {
                "industry_category_id": category_id,
                "industry_confidence": confidence,
            }
        ).eq("application_id", application_id).eq("application_track", track).execute()
    else:
        client.table("ai_screening").insert(
            {
                "application_id": application_id,
                "application_track": track,
                "industry_category_id": category_id,
                "industry_confidence": confidence,
                "flags": [],
            }
        ).execute()


def run(*, dry_run: bool, limit: int | None) -> None:
    client = get_admin_client()
    tracks = ["tir", "sip"]
    grand_total = 0
    for track in tracks:
        apps = _fetch_apps_to_backfill(track, client)
        log.info("Track %s: %d apps to backfill", track, len(apps))
        if limit:
            apps = apps[:limit]

        for i, app in enumerate(apps, 1):
            log.info(
                "[%s %d/%d] app_id=%s",
                track,
                i,
                len(apps),
                app["id"],
            )
            try:
                cid, conf, new_proposal = _classify(app)
            except Exception as exc:
                log.warning("Classify failed for %s: %s", app["id"], exc)
                continue

            # If LLM proposed a new category under cap + confidence — create it.
            if new_proposal and conf is not None and conf >= 0.7:
                ok = industry_categories.create_category_if_under_cap(
                    category_id=new_proposal["id"],
                    label=new_proposal["label"],
                    created_by_app_id=app["id"],
                )
                if ok:
                    cid = new_proposal["id"]
                    log.info(
                        "Created new category %s (%s) from app %s",
                        new_proposal["id"],
                        new_proposal["label"],
                        app["id"],
                    )

            if not cid:
                log.info("No industry resolved for %s — leaving null", app["id"])
                continue

            if dry_run:
                log.info("[dry-run] would set %s.industry_category_id=%s conf=%s", app["id"], cid, conf)
                continue

            _update_industry(client, app["id"], track, cid, conf)
            grand_total += 1

    log.info("Backfill complete. %d rows updated.", grand_total)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Don't write")
    parser.add_argument("--limit", type=int, default=None, help="Limit per track")
    args = parser.parse_args()
    run(dry_run=args.dry_run, limit=args.limit)


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Syntax + import smoke check**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend && python -c "
import ast
with open('scripts/backfill_industry.py') as f:
    ast.parse(f.read())
print('OK')
"
```
Expected: `OK`.

Then a dry-import (no env vars needed for import-only):
```bash
cd /Users/apple/Desktop/Final_AP_os/backend && AI_STUB=true python -c "
import sys; sys.path.insert(0, '.')
from scripts import backfill_industry
print('imports OK')
"
```
Expected: `imports OK`.

- [ ] **Step 4: Lint**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend && ruff check scripts/backfill_industry.py
```
Expected: no issues.

- [ ] **Step 5: Commit**

```bash
git add backend/scripts/backfill_industry.py
git commit -m "feat(scripts): backfill_industry.py for existing apps

Idempotent: skips apps whose ai_screening already has industry_category_id.
Uses an industry-only LLM prompt (separate from full screening pipeline)
so we don't overwrite score_overall on existing rows. Creates new
categories on the fly under the 12-cap when confidence ≥ 0.7."
```

- [ ] **Step 6: Manual dry-run on staging (paused — user runs)**

Tell the user:
> Backfill script is ready. To dry-run on staging:
> ```bash
> cd /Users/apple/Desktop/Final_AP_os/backend && \
>   OPENROUTER_API_KEY=... \
>   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
>   python -m scripts.backfill_industry --dry-run --limit 3
> ```
> Don't run for real until Phase 4 ships (the list endpoint needs to be tolerant of partial backfill state).

---

# Phase 4 — Backend helpers + list endpoint

### Task 6: Rewrite `stats.derive_project_name` per spec §2

**Files:**
- Modify: `backend/app/services/stats.py`
- Create: `backend/tests/test_stats_helpers.py`

- [ ] **Step 1: Write failing tests**

`backend/tests/test_stats_helpers.py`:
```python
"""Tests for the leadership Applications table row-shaping helpers."""

from __future__ import annotations

import pytest

from app.services import stats


# ─── derive_project_name ────────────────────────────────────────────────


def test_derive_project_name_strips_filler():
    row = {
        "solution_describe": (
            "We're building a human-cobot assembly cell that lets factory "
            "workers train robots by demonstration."
        )
    }
    name = stats.derive_project_name(row)
    assert name is not None
    assert not name.lower().startswith("we're building")
    assert name[0].isupper()


def test_derive_project_name_returns_first_sentence():
    row = {
        "solution_describe": (
            "ESD-safe wearable for shop-floor technicians. Solves static "
            "damage in semicon fabs."
        )
    }
    assert stats.derive_project_name(row) == "ESD-safe wearable for shop-floor technicians."


def test_derive_project_name_handles_short_text():
    row = {"solution_describe": "On-device speech-to-text for 22 Indian languages with sub-200ms latency."}
    assert stats.derive_project_name(row) == "On-device speech-to-text for 22 Indian languages with sub-200ms latency."


def test_derive_project_name_truncates_long_first_sentence_at_word_boundary():
    row = {
        "solution_describe": (
            "A human-cobot assembly cell that lets factory workers train "
            "robots by demonstration on a touchscreen UI"
        )
    }
    name = stats.derive_project_name(row)
    assert name is not None
    assert len(name) <= 61  # 60 + ellipsis
    assert name.endswith("…")
    # Must not split mid-word
    body = name.rstrip("…").rstrip()
    assert not body[-1].isalpha() or body.endswith(("y", "h", "n", "s", "g", "d", "t", "r", "l", "m", "e")) or " " not in body


def test_derive_project_name_falls_back_to_basic_org():
    row = {"solution_describe": "", "basic_org": "Anna University"}
    assert stats.derive_project_name(row) == "Anna University"


def test_derive_project_name_returns_dash_when_blank():
    assert stats.derive_project_name({"solution_describe": "", "basic_org": ""}) is None
    assert stats.derive_project_name(None) is None


def test_derive_project_name_lowercase_first_letter_capitalized():
    row = {"solution_describe": "a cobot for warehouse picking."}
    name = stats.derive_project_name(row)
    assert name is not None
    assert name[0] == "A"


# ─── derive_stage_label ─────────────────────────────────────────────────


def test_derive_stage_label_tir_known():
    row = {"track": "tir", "solution_stage": "Lab demos / proof of concept"}
    result = stats.derive_stage_label(row)
    assert result == {"raw": "Lab demos / proof of concept", "label": "Lab demo"}


def test_derive_stage_label_tir_all_mappings():
    cases = {
        "Still exploring": "Exploring",
        "Literature / research stage": "Research",
        "Simulations completed": "Simulation",
        "Lab demos / proof of concept": "Lab demo",
        "Prototype built": "Prototype",
        "Pilot-ready product": "Pilot-ready",
        "Deployed in real setting with real users": "Deployed",
    }
    for raw, label in cases.items():
        row = {"track": "tir", "solution_stage": raw}
        assert stats.derive_stage_label(row) == {"raw": raw, "label": label}


def test_derive_stage_label_sip_known():
    row = {"track": "sip", "sip_traction": "Active pilots (paid or unpaid) with design partners"}
    result = stats.derive_stage_label(row)
    assert result == {
        "raw": "Active pilots (paid or unpaid) with design partners",
        "label": "Active pilots",
    }


def test_derive_stage_label_returns_none_for_unknown():
    row = {"track": "tir", "solution_stage": None}
    assert stats.derive_stage_label(row) is None


def test_derive_stage_label_unknown_raw_returns_raw_as_label():
    """If the raw text isn't in our map, surface it anyway so leadership
    sees the answer rather than '—'."""
    row = {"track": "tir", "solution_stage": "Something custom"}
    result = stats.derive_stage_label(row)
    assert result == {"raw": "Something custom", "label": "Something custom"}


# ─── compose_display_id ────────────────────────────────────────────────


def test_compose_display_id_with_seq():
    assert stats.compose_display_id("tir", 26013) == "TIR-26013"
    assert stats.compose_display_id("sip", 26001) == "SIP-26001"


def test_compose_display_id_handles_none():
    assert stats.compose_display_id("tir", None) == "TIR-?????"


def test_compose_display_id_handles_unknown_track():
    assert stats.compose_display_id("xyz", 100).startswith("XYZ-")
```

- [ ] **Step 2: Run tests — expect failures**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend && pytest tests/test_stats_helpers.py -v
```
Expected: most tests fail (current implementations don't match spec).

- [ ] **Step 3: Rewrite the three helpers in `stats.py`**

Replace the existing implementations:

```python
# ─── Project name derivation (spec §2) ──────────────────────────────────

_PROJECT_FILLER_PREFIXES = (
    "we are building ",
    "we're building ",
    "we are developing ",
    "we're developing ",
    "we are creating ",
    "we're creating ",
    "our solution is ",
    "our product is ",
    "this is ",
)


def _truncate_at_word(text: str, max_chars: int) -> str:
    """Truncate to at most `max_chars` chars, breaking at the last whitespace
    boundary before max_chars. Returns the text with a trailing ellipsis."""
    if len(text) <= max_chars:
        return text
    cut = text[:max_chars].rsplit(" ", 1)[0]
    cut = cut.rstrip(",.;:- ")
    return f"{cut}…"


def derive_project_name(row: dict | None) -> str | None:
    """Short project name derived from solution_describe (spec §2)."""
    if not row:
        return None
    text = (row.get("solution_describe") or "").strip()
    if not text:
        org = (row.get("basic_org") or "").strip()
        return org or None

    # Step 2: first sentence
    first = text
    for sep in (". ", "? ", "! ", "\n"):
        first = first.split(sep)[0]
    first = first.strip()
    if first.endswith((".", "?", "!")) is False and len(first) < len(text):
        # If we split off a sep, retain a single trailing period for cleanliness
        # (only if the next char in text is a sentence terminator)
        pass

    # Step 5: strip filler (case-insensitive)
    lower = first.lower()
    for filler in _PROJECT_FILLER_PREFIXES:
        if lower.startswith(filler):
            first = first[len(filler):].lstrip()
            break

    # Step 4: if first sentence < 20 chars, take first 80 chars of full text
    if len(first) < 20 and len(text) > len(first):
        # Use the full description, also strip filler from it
        extended = text
        ext_lower = extended.lower()
        for filler in _PROJECT_FILLER_PREFIXES:
            if ext_lower.startswith(filler):
                extended = extended[len(filler):].lstrip()
                break
        first = _truncate_at_word(extended, 80)

    # Step 3: if first sentence > 60 chars, truncate at last word boundary before 60
    elif len(first) > 60:
        first = _truncate_at_word(first, 60)

    if not first:
        return None

    # Step 6: capitalize first character
    return first[0].upper() + first[1:]


# ─── Stage label derivation (spec §4) ────────────────────────────────────

# TIR: solution_stage → short label
_TIR_STAGE_MAP: dict[str, str] = {
    "Still exploring":                              "Exploring",
    "Literature / research stage":                  "Research",
    "Simulations completed":                        "Simulation",
    "Lab demos / proof of concept":                 "Lab demo",
    "Prototype built":                              "Prototype",
    "Pilot-ready product":                          "Pilot-ready",
    "Deployed in real setting with real users":     "Deployed",
}

# SIP: sip_traction → short label
_SIP_STAGE_MAP: dict[str, str] = {
    "Pre-revenue — building toward our first pilot":          "Pre-revenue",
    "Active pilots (paid or unpaid) with design partners":    "Active pilots",
    "Paying pilots — customers have paid for early access":   "Paying pilots",
    "Live paying customers — repeat revenue":                 "Live revenue",
}


def derive_stage_label(row: dict | None) -> dict | None:
    """Return {"raw": <original>, "label": <short>} or None.

    Per-track maps; falls back to using `raw` as `label` when raw text isn't
    in the map (better than dropping the cell entirely). Returns None only
    when no source field is populated.
    """
    if not row:
        return None
    track = (row.get("track") or "").lower()
    if track == "tir":
        raw = row.get("solution_stage")
        if not raw:
            return None
        return {"raw": raw, "label": _TIR_STAGE_MAP.get(raw, raw)}
    if track == "sip":
        raw = row.get("sip_traction")
        if raw:
            return {"raw": raw, "label": _SIP_STAGE_MAP.get(raw, raw)}
        # SIP fallback to TRL if traction missing
        trl = row.get("sip_trl")
        if trl:
            return {"raw": trl, "label": trl[:24]}
        return None
    # Unknown track — try TIR field then SIP field
    raw = row.get("solution_stage") or row.get("sip_traction")
    if not raw:
        return None
    return {"raw": raw, "label": _TIR_STAGE_MAP.get(raw, _SIP_STAGE_MAP.get(raw, raw))}


# ─── Display ID derivation (spec §5) ────────────────────────────────────


def compose_display_id(track: str, display_seq: int | str | None) -> str:
    """Render the human-readable per-track ID, e.g. ``TIR-26013``.

    `display_seq` is the integer from the {track}_display_seq sequence.
    Returns `<TRACK>-?????` if the seq is missing — old rows where the
    migration hasn't been applied yet would show this.
    """
    prefix = (track or "?").upper()
    if display_seq is None or display_seq == "":
        return f"{prefix}-?????"
    try:
        return f"{prefix}-{int(display_seq)}"
    except (TypeError, ValueError):
        return f"{prefix}-?????"
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend && pytest tests/test_stats_helpers.py -v
```
Expected: all 14 tests pass.

- [ ] **Step 5: Run full backend test suite**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend && pytest -m 'not integration' --tb=short
```
Expected: all pass.

If any router-level tests fail because `compose_display_id` now requires an integer seq, that's the next task fixing — keep going.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/stats.py backend/tests/test_stats_helpers.py
git commit -m "feat(leadership): row-shaping helpers match spec §2/§4/§5

derive_project_name: filler-strip + word-boundary truncation per spec §2.
derive_stage_label: returns {raw, label} dict with per-track maps per spec §4.
compose_display_id: switches from UUID-slice to display_seq integer per spec §5."
```

---

### Task 7: Update `applications_query.py` to project display_seq + industry join

**Files:**
- Modify: `backend/app/services/applications_query.py`

- [ ] **Step 1: Update column projections and search**

Apply these changes:

7a. Update column constants to include `display_seq`:
```python
_BASE_LIST_COLUMNS = (
    "id,status,basic_full_name,basic_email,basic_org,"
    "submitted_at,created_at,"
    "solution_describe,solution_core_tech,problem_describe,"
    "display_seq"
)
```

7b. Add a numeric-search clause to `fetch_apps_for_track()`:

Replace the existing `if search:` block:
```python
        if search:
            needle = f"%{search}%"
            or_parts = [
                f"basic_full_name.ilike.{needle}",
                f"basic_email.ilike.{needle}",
                f"basic_org.ilike.{needle}",
            ]
            # If the search input is purely digits, also match display_seq
            digits = search.strip().lstrip("-+")
            if digits.isdigit():
                or_parts.append(f"display_seq.eq.{digits}")
            q = q.or_(",".join(or_parts))
```

7c. Add a new bulk-fetch helper for industry data:
```python
def fetch_industry_for_pairs(
    pairs: list[tuple[str, str]],
) -> dict[tuple[str, str], dict[str, str] | None]:
    """Bulk-load `industry_category_id → label` for the given pairs.

    Returns dict keyed by `(track, application_id)` → `{"id", "label"}` or
    None when the row is unscreened or industry is null.

    One query per track on `ai_screening`, plus one query on
    `industry_categories` to resolve labels.
    """
    out: dict[tuple[str, str], dict[str, str] | None] = {(t, a): None for t, a in pairs}
    if not pairs:
        return out

    by_track: dict[str, list[str]] = {t: [] for t in stats.TRACKS}
    for t, a in pairs:
        if t in by_track:
            by_track[t].append(a)

    raw: dict[tuple[str, str], str | None] = {}
    for track, ids in by_track.items():
        if not ids:
            continue
        try:
            res = (
                get_admin_client()
                .table("ai_screening")
                .select("application_id,industry_category_id")
                .eq("application_track", track)
                .in_("application_id", ids)
                .execute()
            )
            for row in res.data or []:
                aid = row.get("application_id")
                cid = row.get("industry_category_id")
                if aid:
                    raw[(track, aid)] = cid
        except Exception as exc:
            log.warning(
                "applications_query.fetch_industry_for_pairs failed",
                extra={"track": track, "err": str(exc)},
            )

    # Resolve labels in one query.
    needed_ids = {cid for cid in raw.values() if cid}
    labels: dict[str, str] = {}
    if needed_ids:
        try:
            res = (
                get_admin_client()
                .table("industry_categories")
                .select("id,label")
                .in_("id", list(needed_ids))
                .execute()
            )
            for row in res.data or []:
                labels[row["id"]] = row["label"]
        except Exception as exc:
            log.warning(
                "applications_query.fetch_industry_for_pairs labels failed",
                extra={"err": str(exc)},
            )

    for (track, aid), cid in raw.items():
        if cid and cid in labels:
            out[(track, aid)] = {"id": cid, "label": labels[cid]}
    return out
```

- [ ] **Step 2: Smoke-import**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend && python -c "
import sys; sys.path.insert(0, '.')
from app.services import applications_query
print('OK')
"
```
Expected: `OK`.

- [ ] **Step 3: Lint**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend && ruff check app/services/applications_query.py
```
Expected: no issues.

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/applications_query.py
git commit -m "feat(leadership): list query projects display_seq + bulk industry helper

LIST_COLUMNS now includes display_seq. Search clause also matches
display_seq.eq.<n> when the input is purely numeric (so leadership can
paste 'TIR-26013' or '26013' and find the row). New fetch_industry_for_pairs
helper bulk-loads industry_category_id + label across both tracks in two
DB calls (one per track on ai_screening, one on industry_categories)."
```

---

### Task 8: Update list endpoint row shape + add categories endpoint

**Files:**
- Modify: `backend/app/routers/leadership.py`

- [ ] **Step 1: Update the list endpoint row shape**

Apply these changes to `backend/app/routers/leadership.py`:

8a. Add `industry_categories` to imports near the top:
```python
from ..services import applications_query, industry_categories, stats
```

8b. Replace the industry post-filter + row-shaping in `list_applications()`. Replace lines 194-256 (the section starting `# ─ 2. Industry post-filter`) with:

```python
    # ─ 2. Industry source: ai_screening.industry_category_id → label ────
    # Replaces the old keyword classifier. Apps without an ai_screening row
    # (or whose industry_category_id is null) get `industry=None` → frontend
    # renders "—".
    pairs_for_industry = [(r["track"], r["id"]) for r in rows]
    industries = applications_query.fetch_industry_for_pairs(pairs_for_industry)

    if industry:
        rows = [r for r in rows if (industries.get((r["track"], r["id"])) or {}).get("id") == industry]

    # ─ 3. AI score join + filter ───────────────────────────────────────
    pairs = [(r["track"], r["id"]) for r in rows]
    scores = applications_query.fetch_ai_scores_for(pairs)

    filter_ai = ai_score_min is not None or ai_score_max is not None
    if filter_ai:
        kept: list[dict[str, Any]] = []
        for r in rows:
            s = scores.get((r["track"], r["id"]))
            if s is None:
                continue
            if ai_score_min is not None and s < ai_score_min:
                continue
            if ai_score_max is not None and s > ai_score_max:
                continue
            kept.append(r)
        rows = kept

    # ─ 4. Total = post-filter, pre-pagination count ─────────────────────
    total = len(rows)

    # ─ 5. Sort → paginate → shape response ─────────────────────────────
    rows.sort(key=_submitted_at_sort_key, reverse=True)
    page = rows[offset : offset + limit]

    applications = []
    for r in page:
        track = r["track"]
        ind = industries.get((track, r["id"]))
        applications.append({
            "id":               r["id"],
            "display_seq":      r.get("display_seq"),
            "display_id":       stats.compose_display_id(track, r.get("display_seq")),
            "track":            track,
            "status":           r.get("status"),
            "project_name":     stats.derive_project_name(r),
            "founder": {
                "name":         r.get("basic_full_name"),
                "affiliation":  r.get("basic_org"),
            },
            "industry":         ind,
            "stage":            stats.derive_stage_label(r),
            "ai_score_overall": scores.get((track, r["id"])),
            "submitted_at":     r.get("submitted_at"),
            "created_at":       r.get("created_at"),
            # Legacy fields the AppDrawer + tests still reference:
            "basic_full_name":  r.get("basic_full_name"),
            "basic_email":      r.get("basic_email"),
            "basic_org":        r.get("basic_org"),
        })

    return {
        "applications": applications,
        "total":        total,
        "limit":        limit,
        "offset":       offset,
    }
```

8c. Delete (or comment out for one release) the old `industry` block in `/leadership/stats` if you want the dashboard tab's industry bar chart to source from the new endpoint immediately. Per spec §7e the recommendation is to delete now.

Remove these lines from `get_stats()`:
```python
    # ─── Industry breakdown ───────────────────────────────────────────
    industry_totals: dict[str, int] = {}
    ...
    industry = {
        "industries": industries,
        "total":      industry_total_apps,
    }
```
And from the return dict:
```python
    return {
        "totals":        totals,
        "funnel":        funnel,
        "status_counts": status_counts,
        # "industry":      industry,  # → moved to /leadership/industry-categories
    }
```

8d. Add the new endpoint at the end of the file:

```python
# ─── Industry categories endpoint ──────────────────────────────────────


@router.get(
    "/industry-categories",
    dependencies=[Depends(require_capability("view_stats"))],
)
async def get_industry_categories() -> dict[str, Any]:
    """Filter-pill data source for the leadership Applications tab.

    Returns categories with counts, sorted desc by count then is_seed.
    Empty categories (count = 0) are hidden. Includes cap + remaining_slots
    metadata so the UI can render the 12-cap status.
    """
    return industry_categories.categories_with_counts()
```

- [ ] **Step 2: Smoke-import + ruff**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend && python -c "
import sys; sys.path.insert(0, '.')
from app.routers import leadership
print('OK')
" && ruff check app/routers/leadership.py
```
Expected: `OK` then no ruff issues.

- [ ] **Step 3: Run leadership router tests if they exist**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend && pytest tests/test_leadership_router.py -v 2>&1 | head -40
```
Expected: all pass — OR if file doesn't exist, that's fine, we add tests in the next task.

If existing tests fail because they assert on the old row shape (`industry: {id, label}` keyword classified, `stage_label: str`, UUID-slice display_id), update those test assertions in this same commit so we don't leave a broken suite.

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/leadership.py
git commit -m "feat(leadership): list endpoint matches spec §6 row shape

Row keys: display_id (TIR-26013), display_seq (int), founder {name, affiliation},
industry sourced from ai_screening.industry_category_id join (replaces keyword
classifier), stage {raw, label}. New GET /leadership/industry-categories endpoint
drives the filter pills with counts + cap status. /leadership/stats industry block
removed (replaced by the new endpoint)."
```

---

### Task 9: Add router-level test for the new endpoint + row shape

**Files:**
- Modify or Create: `backend/tests/test_leadership_router.py`

- [ ] **Step 1: Check if the file exists**

```bash
ls /Users/apple/Desktop/Final_AP_os/backend/tests/test_leadership_router.py 2>&1 || echo "missing"
```

- [ ] **Step 2: Add tests**

If file is missing, create with the standard FastAPI TestClient pattern (mirror existing test files like `test_ai_screener.py` for mocking conventions). If file exists, append the two test cases:

```python
def test_industry_categories_endpoint_shape(monkeypatch, leadership_test_client):
    """GET /leadership/industry-categories returns categories + cap status."""
    from app.services import industry_categories

    monkeypatch.setattr(
        industry_categories,
        "categories_with_counts",
        lambda: {
            "categories": [
                {"id": "robotics", "label": "Robotics", "count": 3},
                {"id": "ai", "label": "AI", "count": 2},
            ],
            "total": 5,
            "cap": 12,
            "remaining_slots": 5,
        },
    )

    resp = leadership_test_client.get("/leadership/industry-categories")
    assert resp.status_code == 200
    data = resp.json()
    assert data["cap"] == 12
    assert data["total"] == 5
    assert data["categories"][0]["id"] == "robotics"


def test_list_applications_row_has_new_shape(monkeypatch, leadership_test_client):
    """List endpoint returns founder, industry, stage objects and display_id."""
    from app.services import applications_query

    monkeypatch.setattr(
        applications_query,
        "fetch_apps_for_track",
        lambda track, **kw: (
            [
                {
                    "id": "aaaa-bbbb",
                    "track": track,
                    "status": "submitted",
                    "basic_full_name": "Devika",
                    "basic_org": "Anna Univ",
                    "basic_email": "d@x.com",
                    "submitted_at": "2026-05-12T08:14:00Z",
                    "created_at": "2026-05-10T11:00:00Z",
                    "solution_describe": "ESD-safe wearable for shop-floor technicians. Long tail.",
                    "solution_stage": "Lab demos / proof of concept",
                    "display_seq": 26013,
                }
            ]
            if track == "tir"
            else []
        ),
    )
    monkeypatch.setattr(
        applications_query,
        "fetch_ai_scores_for",
        lambda pairs: {p: 7.8 for p in pairs},
    )
    monkeypatch.setattr(
        applications_query,
        "fetch_industry_for_pairs",
        lambda pairs: {p: {"id": "industry", "label": "Advanced Manufacturing"} for p in pairs},
    )

    resp = leadership_test_client.get("/leadership/applications?track=tir")
    assert resp.status_code == 200
    apps = resp.json()["applications"]
    assert len(apps) == 1
    a = apps[0]
    assert a["display_id"] == "TIR-26013"
    assert a["display_seq"] == 26013
    assert a["founder"] == {"name": "Devika", "affiliation": "Anna Univ"}
    assert a["industry"] == {"id": "industry", "label": "Advanced Manufacturing"}
    assert a["stage"]["label"] == "Lab demo"
    assert a["ai_score_overall"] == 7.8
    assert a["project_name"].startswith("ESD-safe")
```

If you need to create the file from scratch, copy the auth-bypass fixture pattern from an existing router test. (Most likely there's already a conftest.py with a `leadership_test_client` fixture in `backend/tests/`.) If not, the simplest path is:

```python
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.rbac import require_capability


@pytest.fixture
def leadership_test_client(monkeypatch):
    # Bypass auth: replace require_capability with a no-op
    app.dependency_overrides[require_capability("view_stats")] = lambda: None
    app.dependency_overrides[require_capability("view_all_apps")] = lambda: None
    app.dependency_overrides[require_capability("view_app_detail")] = lambda: None
    yield TestClient(app)
    app.dependency_overrides.clear()
```

(If `require_capability` returns a closure each call, this naive override won't match — check conftest.py or existing router tests for the real pattern. The two new tests must work with whatever pattern is canonical in the repo.)

- [ ] **Step 3: Run tests**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend && pytest tests/test_leadership_router.py -v
```
Expected: 2 new tests pass.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/test_leadership_router.py
git commit -m "test(leadership): cover new endpoint + list row shape"
```

---

# Phase 5 — Frontend

### Task 10: Add `fmtRelative` helper + vitest tests

**Files:**
- Create: `frontend/src/lib/timeFmt.js`
- Create: `frontend/src/__tests__/timeFmt.test.js`

- [ ] **Step 1: Check existing test directory structure**

```bash
ls /Users/apple/Desktop/Final_AP_os/frontend/src/__tests__/ 2>/dev/null || ls /Users/apple/Desktop/Final_AP_os/frontend/src/lib/ | head
```

- [ ] **Step 2: Write the failing test**

`frontend/src/__tests__/timeFmt.test.js`:
```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fmtRelative } from "../lib/timeFmt";

describe("fmtRelative", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'just now' for under 60s", () => {
    expect(fmtRelative("2026-05-20T11:59:30Z")).toBe("just now");
  });

  it("returns minutes for under 60m", () => {
    expect(fmtRelative("2026-05-20T11:45:00Z")).toBe("15m ago");
  });

  it("returns hours for under 24h", () => {
    expect(fmtRelative("2026-05-20T07:00:00Z")).toBe("5h ago");
  });

  it("returns days for under 30d", () => {
    expect(fmtRelative("2026-05-15T12:00:00Z")).toBe("5d ago");
  });

  it("returns DD MMM YYYY for >= 30d", () => {
    expect(fmtRelative("2026-03-01T12:00:00Z")).toMatch(/01 Mar 2026|1 Mar 2026/);
  });

  it("returns '—' for null/undefined/invalid", () => {
    expect(fmtRelative(null)).toBe("—");
    expect(fmtRelative(undefined)).toBe("—");
    expect(fmtRelative("not-a-date")).toBe("—");
  });
});
```

- [ ] **Step 3: Run test — expect failure**

```bash
cd /Users/apple/Desktop/Final_AP_os/frontend && npx vitest run src/__tests__/timeFmt.test.js
```
Expected: import error / module not found.

- [ ] **Step 4: Implement `timeFmt.js`**

`frontend/src/lib/timeFmt.js`:
```javascript
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/**
 * Render an ISO timestamp as a relative-time string.
 *
 *   < 60s     → "just now"
 *   < 60m     → "{n}m ago"
 *   < 24h     → "{n}h ago"
 *   < 30d     → "{n}d ago"
 *   ≥ 30d     → "DD MMM YYYY"  (en-IN)
 *
 * Returns "—" for null / undefined / unparseable.
 */
export function fmtRelative(iso) {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const now = Date.now();
  const diff = now - t;
  if (diff < MIN) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / MIN)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 30 * DAY) return `${Math.floor(diff / DAY)}d ago`;
  const d = new Date(t);
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd /Users/apple/Desktop/Final_AP_os/frontend && npx vitest run src/__tests__/timeFmt.test.js
```
Expected: 6 passed.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/timeFmt.js frontend/src/__tests__/timeFmt.test.js
git commit -m "feat(leadership): fmtRelative helper for Submitted column"
```

---

### Task 11: Add `getIndustryCategories` API wrapper

**Files:**
- Modify: `frontend/src/lib/leadershipApi.js`

- [ ] **Step 1: Read current pattern**

```bash
head -60 /Users/apple/Desktop/Final_AP_os/frontend/src/lib/leadershipApi.js
```

- [ ] **Step 2: Add the wrapper**

Insert near the other `get*` exports, mirroring the existing call pattern (axios-style or fetch — whichever is canonical in the file):

```javascript
export async function getIndustryCategories() {
  return apiFetch("/leadership/industry-categories");
}
```

(Replace `apiFetch` with whatever helper the file already uses — e.g. `request`, `api.get`, etc. Match the canonical pattern.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/leadershipApi.js
git commit -m "feat(leadership): API wrapper for industry-categories endpoint"
```

---

### Task 12: Rewrite the Applications table (8 columns) in LeadershipDashboard.jsx

**Files:**
- Modify: `frontend/src/pages/leadership/LeadershipDashboard.jsx`
- Modify: `frontend/src/styles/leadership.css`

- [ ] **Step 1: Read the full file to identify edit ranges**

```bash
wc -l /Users/apple/Desktop/Final_AP_os/frontend/src/pages/leadership/LeadershipDashboard.jsx
```
Then read the relevant ranges with the Read tool — focus on:
- imports section (top ~30 lines)
- industry pills block (search for `industries.map`)
- table render block (lines ~236-255 per Explore report — verify with full read)
- search input handler (where `setSearch` is wired)

- [ ] **Step 2: Add imports**

At the top of the file:
```javascript
import { fmtRelative } from "../../lib/timeFmt";
import { getIndustryCategories } from "../../lib/leadershipApi";
```

- [ ] **Step 3: Add state + effect for industry categories**

In the component body, near the other useState declarations:
```javascript
const [industryCategories, setIndustryCategories] = useState([]);
const [industryCap, setIndustryCap] = useState({ cap: 12, remaining_slots: 12 });

useEffect(() => {
  let cancelled = false;
  getIndustryCategories()
    .then((data) => {
      if (cancelled) return;
      setIndustryCategories(data.categories || []);
      setIndustryCap({ cap: data.cap, remaining_slots: data.remaining_slots });
    })
    .catch(() => {});
  return () => {
    cancelled = true;
  };
}, []);
```

- [ ] **Step 4: Replace the industry pills block**

Find the existing pills block (rendering `industries.map(...)` from `stats.industry.industries`) and replace with:

```jsx
<div className="lp-pills">
  <button
    type="button"
    className={`lp-pill ${!industry ? "is-active" : ""}`}
    onClick={() => setIndustry(null)}
  >
    All
  </button>
  {industryCategories.map((c) => (
    <button
      type="button"
      key={c.id}
      className={`lp-pill ${industry === c.id ? "is-active" : ""}`}
      onClick={() => setIndustry(industry === c.id ? null : c.id)}
    >
      {c.label} <span className="lp-pill-count">{c.count}</span>
    </button>
  ))}
</div>
```

- [ ] **Step 5: Replace the table block**

Find the `<tbody>` block that maps `applications` and replace with the 8-column markup. Also update the table header row:

```jsx
<thead>
  <tr>
    <th>Project</th>
    <th>Founder</th>
    <th>Industry</th>
    <th>Stage</th>
    <th className="num">AI Score</th>
    <th>Status</th>
    <th>Submitted</th>
    <th className="lp-id-col">ID</th>
  </tr>
</thead>
<tbody>
  {applications.map((a) => (
    <tr key={a.id} onClick={() => setOpenRow(a)}>
      <td className="lp-cell-project">
        <div className="lp-cell-primary">{a.project_name || "—"}</div>
        <div className="lp-cell-sub">
          {a.display_id} · {(a.track || "").toUpperCase()}
        </div>
      </td>
      <td className="lp-cell-founder">
        <div className="lp-cell-primary">{a.founder?.name || "—"}</div>
        <div className="lp-cell-sub">{a.founder?.affiliation || "—"}</div>
      </td>
      <td>{a.industry?.label || "—"}</td>
      <td title={a.stage?.raw || ""}>{a.stage?.label || "—"}</td>
      <td className="num">
        {a.ai_score_overall == null ? "—" : Number(a.ai_score_overall).toFixed(1)}
      </td>
      <td>
        <span className={`lp-status lp-status-${a.status}`}>
          {statusLabelById[a.status] || a.status}
        </span>
      </td>
      <td>{fmtRelative(a.submitted_at)}</td>
      <td className="lp-id-col">{a.display_id}</td>
    </tr>
  ))}
</tbody>
```

- [ ] **Step 6: Strip TIR-/SIP- prefix from search input on submit**

Find the search input's onChange or onSubmit handler. Update:
```javascript
function handleSearch(value) {
  // Strip leading "TIR-" or "SIP-" so a paste like "TIR-26013" matches.
  const stripped = value.replace(/^(TIR|SIP)-/i, "");
  setSearch(stripped);
  setOffset(0);
}
```

Wire `handleSearch` to the input's onChange (or onSubmit if it's a form).

- [ ] **Step 7: Add CSS rules**

Append to `frontend/src/styles/leadership.css`:

```css
/* Applications table — two-line cells */
.lp-cell-project,
.lp-cell-founder {
  vertical-align: top;
  padding-top: 10px;
  padding-bottom: 10px;
  line-height: 1.35;
}

.lp-cell-primary {
  font-weight: 500;
  color: var(--ink);
}

.lp-cell-sub {
  font-size: 0.8rem;
  color: var(--ink-dim);
  margin-top: 2px;
  font-variant-numeric: tabular-nums;
}

.lp-id-col {
  font-family: var(--font-mono, ui-monospace, "SF Mono", monospace);
  font-variant-numeric: tabular-nums;
  text-align: right;
  color: var(--ink-dim);
  font-size: 0.85rem;
}

th.lp-id-col {
  text-align: right;
}

.lp-pill-count {
  display: inline-block;
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--bg-soft);
  font-size: 0.75rem;
  color: var(--ink-dim);
  font-variant-numeric: tabular-nums;
}

.lp-pill.is-active .lp-pill-count {
  background: rgba(255, 255, 255, 0.25);
  color: inherit;
}
```

- [ ] **Step 8: Run frontend tests**

```bash
cd /Users/apple/Desktop/Final_AP_os/frontend && npx vitest run
```
Expected: all pass (timeFmt + any existing tests).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/leadership/LeadershipDashboard.jsx frontend/src/styles/leadership.css
git commit -m "feat(leadership): rebuild Applications table to 8-column layout

Project / Founder / Industry / Stage / AI Score / Status / Submitted / ID.
Two-line cells for Project (project_name + display_id · track) and Founder
(name + affiliation). Submitted uses relative-time formatter. Industry pills
now sourced from /leadership/industry-categories with live counts. Search
input strips TIR-/SIP- prefix before send so pasted IDs match display_seq."
```

---

### Task 13: Update AppDrawer header

**Files:**
- Modify: `frontend/src/pages/leadership/components/AppDrawer.jsx`

- [ ] **Step 1: Read the header block**

```bash
head -80 /Users/apple/Desktop/Final_AP_os/frontend/src/pages/leadership/components/AppDrawer.jsx
```

- [ ] **Step 2: Rewrite the header to spec §7f**

Replace the existing header markup with:

```jsx
<header className="drawer-header">
  <div className="drawer-id">{app.display_id} · {(app.track || "").toUpperCase()}</div>
  <h2 className="drawer-title">{app.project_name || "—"}</h2>
  <div className="drawer-meta">
    <span>{app.founder?.name || "—"}</span>
    {app.founder?.affiliation && <> · <span>{app.founder.affiliation}</span></>}
    {app.submitted_at && <> · <span>submitted {fmtRelative(app.submitted_at)}</span></>}
  </div>
</header>
```

Add the import at the top if missing:
```javascript
import { fmtRelative } from "../../../lib/timeFmt";
```

Add matching CSS to `leadership.css`:
```css
.drawer-header { padding: 16px 20px; border-bottom: 1px solid var(--line); }
.drawer-id    { font-size: 0.8rem; color: var(--ink-dim); letter-spacing: 0.04em; }
.drawer-title { margin: 4px 0 6px; font-family: var(--font-serif); font-size: 1.15rem; }
.drawer-meta  { font-size: 0.85rem; color: var(--ink-dim); }
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/leadership/components/AppDrawer.jsx frontend/src/styles/leadership.css
git commit -m "feat(leadership): AppDrawer header shows display_id + project_name"
```

---

# Phase 6 — Smoke test on staging

### Task 14: Manual smoke test

**Files:** none (verification step)

- [ ] **Step 1: Start the backend locally pointed at staging**

Tell the user:
> Run the backend locally against staging:
> ```bash
> cd backend && uvicorn app.main:app --reload --port 8000
> ```
> Ensure `.env` is set to staging Supabase + `AI_STUB=true` so we don't burn budget during smoke testing.

- [ ] **Step 2: Hit the new endpoint**

```bash
curl -s http://localhost:8000/leadership/industry-categories | python -m json.tool
```
Expected: `{"categories": [...], "total": N, "cap": 12, "remaining_slots": M}`.

- [ ] **Step 3: Hit the list endpoint**

```bash
curl -s 'http://localhost:8000/leadership/applications?limit=3' | python -m json.tool | head -40
```
Expected: rows have `display_id` like `TIR-26001`, `founder: {name, affiliation}`, `industry: null` (until backfill runs) or `{id, label}`, `stage: {raw, label}` or null.

- [ ] **Step 4: Start the frontend**

```bash
cd frontend && npm run dev
```
Navigate to `/leadership`, switch to Applications tab. Verify:
- 8 columns render in correct order
- Project column shows derived name + `TIR-26xxx · TIR` subline
- Founder shows name + org
- Industry shows `—` for unbackfilled rows
- Stage shows short label, hovering shows raw via tooltip
- AI Score, Status, Submitted (relative time) render
- ID column shows `TIR-26xxx` right-aligned
- Search "26013" or "TIR-26013" finds the row
- Clicking opens AppDrawer with new header format

- [ ] **Step 5: Run backfill on staging**

```bash
cd backend && OPENROUTER_API_KEY=... python -m scripts.backfill_industry --dry-run --limit 3
```
Review dry-run log output for sanity. If LLM picks sensible categories, drop `--dry-run` and let it run on all rows.

- [ ] **Step 6: Re-verify the list endpoint shows industries**

```bash
curl -s 'http://localhost:8000/leadership/applications?limit=5' | python -m json.tool | grep industry
```
Expected: most rows have an industry object now.

If anything looks off, capture the broken row's `id` and inspect via `/leadership/applications/{id}` for raw fields.

---

# Phase 7 — Deploy notes

### Task 15: Document the deploy sequence

**Files:**
- Modify: `docs/superpowers/plans/2026-05-20-leadership-applications-table-redesign-plan.md` (this file — add a final "Production Deploy Checklist" section)

- [ ] **Step 1: Append the deploy checklist**

Add at the bottom of this plan file:

```markdown
## Production Deploy Checklist (prod environment)

When ready to ship to prod:

1. **Backend Lambda deploy** — push current branch's Lambda stack
   (`artpark-eir-api`, ap-south-1). Confirm `OPENROUTER_API_KEY` is set in
   the Lambda env.
2. **Run migration 017** in prod Supabase SQL editor. Copy contents of
   `backend/migrations/017_leadership_table_redesign.sql` and execute.
   Verify with:
       SELECT COUNT(*) FROM industry_categories;     -- expect 7
       SELECT MAX(display_seq) FROM tir_applications;-- expect 26000 + N
3. **Run backfill** pointed at prod:
       cd backend && OPENROUTER_API_KEY=$PROD_KEY \
         SUPABASE_URL=$PROD_URL SUPABASE_SERVICE_ROLE_KEY=$PROD_KEY \
         python -m scripts.backfill_industry --dry-run --limit 5
   Review log → drop --dry-run and run for real (~$0.05 cost).
4. **Frontend deploy** via Vercel (push to main).
5. **Smoke test** /leadership on apply.artpark.info: verify table renders
   8 columns, industries populated, display_ids show as TIR-26xxx, drawer
   header reads new format.

If something breaks:
- Roll forward — migration is hard to reverse cleanly.
- Frontend rollback is via Vercel redeploy of the previous build.
- Industry classifications are stored; if the LLM is broken, old data stays.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-05-20-leadership-applications-table-redesign-plan.md
git commit -m "docs(leadership): production deploy checklist for table redesign"
```

---

## Self-Review

**Spec coverage:**
- Section 1 (column layout): Task 12 (frontend) + Task 8 (backend row shape). ✅
- Section 2 (project name): Task 6 with 7 tests. ✅
- Section 3a (industry_categories table + 7 seeds): Task 1. ✅
- Section 3b (classification flow): Tasks 3-4. ✅
- Section 3c (prompt rules): Task 3 system prompt. ✅
- Section 3d (storage on ai_screening): Task 1 SQL + Task 4 upsert. ✅
- Section 3e (deprecated keyword classifier): Task 8 8c removes the call; the function stays with `# DEPRECATED` — TODO add the comment in Task 8 explicitly. **Adding to Task 8.**
- Section 3f (backfill): Task 5. ✅
- Section 4 (stage column logic): Task 6. ✅
- Section 5 (ID column + display_seq): Task 1 SQL + Task 6 helper + Task 7/8 endpoint. ✅
- Section 6a (per-row shape): Task 8. ✅
- Section 6b (industry-categories endpoint): Task 2 service + Task 8 route. ✅
- Section 6c (filter params): Task 8 (industry filter switches to category_id) + Task 7 (search). ✅
- Section 6d (detail endpoint): **GAP — not explicitly updated.** The detail endpoint at `get_application_detail` should also expose `project_name`, `founder`, `industry`, `stage` keys. **Adding a sub-task to Task 8.**
- Section 7a-d (frontend files): Task 12. ✅
- Section 7e (dashboard tab industry bar chart): Task 12 reuses the new endpoint for the dashboard tab's industry block too — verify when wiring. **Adding a note to Task 12 step 3.**
- Section 7f (AppDrawer header): Task 13. ✅
- Section 8 (deployment): Tasks 14-15. ✅

**Adjustments made above based on self-review:**
1. Task 8 must also add `# DEPRECATED` comment to `classify_industry()` in `stats.py`.
2. Task 8 must also update the detail endpoint (`get_application_detail`) to expose the new derived fields.
3. Task 12 step 3 must also wire the dashboard tab's industry bar chart to read from `industryCategories` state (not `stats.industry.industries`).

These are inline fixes added to the relevant tasks:

**Task 8 addendum** — add to step 8b after the list endpoint changes:

> 8e. Update the detail endpoint return:
> ```python
>     return {
>         "id":                   application_id,
>         "track":                track,
>         "display_seq":          app_row.get("display_seq"),
>         "display_id":           stats.compose_display_id(track, app_row.get("display_seq")),
>         "project_name":         stats.derive_project_name(app_row),
>         "founder": {
>             "name":             app_row.get("basic_full_name"),
>             "affiliation":      app_row.get("basic_org"),
>         },
>         "stage":                stats.derive_stage_label({**app_row, "track": track}),
>         "application":          app_row,
>         "ai_screening":         ai_screening,
>         "reviews":              reviews,
>         "reviewer_assignments": reviewer_assignments,
>         "status_history":       status_history,
>     }
> ```
>
> 8f. Mark the legacy classifier deprecated. In `backend/app/services/stats.py`, add a comment above `def classify_industry(...)`:
> ```python
> # DEPRECATED — kept for one release. The leadership list endpoint now reads
> # industry from ai_screening.industry_category_id (joined to industry_categories).
> # Delete after all rows have industry_category_id populated.
> def classify_industry(source: str | dict | None) -> tuple[str, str]:
> ```

**Task 12 step 3 addendum**: when wiring `industryCategories` state, also use it for the dashboard tab's industry bar chart (search for the existing `stats?.industry?.industries` reference around line 205 and replace with `industryCategories`).

**Placeholder scan:**
- No "TBD", "implement later", or "similar to Task N" remain.
- Every step has either code, a command, or a concrete verification.
- Type consistency: `ScoreResult`, `industry_category_id`, `display_seq`, `derive_stage_label` shape `{raw, label}`, `compose_display_id(track, display_seq)` consistent throughout. ✅

**Type/signature consistency check:**
- `stats.derive_stage_label(row)` returns `dict | None` everywhere. ✅
- `stats.compose_display_id(track, display_seq)` — called from Task 8 (router) and Task 8e (detail endpoint) with same signature. ✅
- `score_application(app_row, categories, slots_remaining)` — signature in Task 3 implementation matches the call in Task 4 handler. ✅
- `industry_categories.create_category_if_under_cap(category_id, label, created_by_app_id)` — kwargs in Task 2 match call sites in Task 4 and Task 5. ✅

---
