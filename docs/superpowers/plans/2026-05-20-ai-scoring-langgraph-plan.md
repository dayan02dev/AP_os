# AI Scoring + Summary Pipeline (LangGraph) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace stub-mode AI screening with a real LangGraph+LangChain pipeline that scores every TIR application on 5 signals, applies 7 cap rules, and produces a 5-section jury-ready summary.

**Architecture:** Single LangGraph state machine with 4 LLM passes (Evidence Extractor → 5 parallel Signal Scorers → Caps+Confidence Python node → Round 1 Synthesizer) and a deterministic 10-check quality gate with 3-retry-then-flag policy. LangChain provider abstraction (Gemini Flash default; swappable to GPT-4 / Claude via env). Calibration loop (Path A) hand-scores 10-20 real applications before deployment to anchor LLM scoring against worked examples.

**Tech Stack:** Python 3.11 (matches existing backend), `langgraph` + `langchain` + `langchain-google-genai`, `pydantic==2.9.*` (already pinned), `supabase==2.9.*` (already pinned), `pytest` with `langchain.chat_models.fake.FakeMessagesListChatModel` for LLM stubbing. No new infrastructure.

**Spec:** `docs/superpowers/specs/2026-05-20-ai-scoring-langgraph-design.md`

---

## File Structure

```
backend/app/services/ai_scoring/
├── __init__.py                  ← public API exports
├── state.py                     ← ScoringState TypedDict + Pydantic models
├── caps.py                      ← 7 pure cap-rule functions
├── compute.py                   ← composite, strength bands, confidence aggregation
├── graph.py                     ← LangGraph state machine assembly
├── persistence.py               ← writes ScoringState to ai_screening row
├── runner.py                    ← top-level score_application(app_id) entry point
├── artpark_assets.md            ← static reference doc loaded into Pass 4
├── nodes/
│   ├── __init__.py
│   ├── extract_evidence.py      ← Pass 1
│   ├── score_signals.py         ← Pass 2 factory (5 instances)
│   ├── apply_caps.py            ← Pass 3a thin LangGraph node wrapping caps.py
│   ├── compute_confidence.py    ← Pass 3b thin LangGraph node wrapping compute.py
│   ├── synthesize.py            ← Pass 4
│   └── quality_gate.py          ← conditional edge + 10 checks
└── prompts/
    ├── extract_evidence.txt
    ├── synthesize_round_1.txt
    └── signals/
        ├── problem_impact.txt
        ├── completeness.txt
        ├── technical_depth.txt
        ├── behavioural.txt
        └── commitment.txt

backend/app/routers/
└── ai_screening.py              ← MODIFY: add POST /admin/ai-screening/run

backend/migrations/
└── 016_rename_score_solution_to_completeness.sql   ← CREATE

backend/tests/ai_scoring/
├── __init__.py
├── conftest.py                  ← Fake LLM + FakeSupabase fixtures
├── test_state.py
├── test_caps.py
├── test_compute.py
├── test_quality_gate.py
├── test_extract_evidence_node.py
├── test_score_signals_node.py
├── test_synthesize_node.py
├── test_graph_e2e.py
├── test_persistence.py
└── test_runner.py

backend/scripts/ai-scoring/
├── README.md                    ← runbook
├── calibration/
│   ├── hand_score_template.json
│   └── README.md
└── runs/                        ← gitignored, per-run transcripts

frontend/src/pages/leadership/review/
├── AIScreeningPanel.jsx         ← MODIFY: score_solution → score_completeness
└── ReviewsTab.jsx               ← MODIFY: same column rename

backend/requirements.txt         ← MODIFY: add langgraph, langchain, langchain-google-genai
backend/.env.example             ← MODIFY: add AI_SCORING_* vars
.gitignore                       ← MODIFY: add backend/scripts/ai-scoring/runs/
```

---

## Conventions

- All paths absolute from repo root (`/Users/apple/Desktop/Final_AP_os/...`) when reading; relative `backend/...` paths for code references.
- Tests run with `pytest backend/tests/ai_scoring/ -v --no-cov`. The `--no-cov` flag avoids tripping the global 70% coverage gate on a new module; coverage of the new code can be reviewed via `pytest backend/tests/ai_scoring/ --cov=app.services.ai_scoring --cov-report=term-missing` once we have enough tests to clear the gate organically.
- Each task ends with one commit. Commit messages follow `<scope>(<area>): <subject>` style with a paragraph body.
- Branch is `staging-role_based_dashboard` throughout. Every subagent dispatch should verify `git branch --show-current` returns this before any git ops.
- Backend Python uses `from __future__ import annotations` consistently (matches existing code).
- LangChain model construction is centralized in `state.py` so swapping providers is one line.

---

### Task 1: Add LangGraph + LangChain deps

**Files:**
- Modify: `backend/requirements.txt` (append two lines)

- [ ] **Step 1: Verify current state**

```bash
cd /Users/apple/Desktop/Final_AP_os
git branch --show-current   # must show: staging-role_based_dashboard
grep -E "^(langgraph|langchain)" backend/requirements.txt   # expect empty
```

- [ ] **Step 2: Append the three deps**

Edit `backend/requirements.txt` and append these lines (preserving everything already there):

```
# LangGraph + LangChain for the AI scoring pipeline (spec §2).
# Pinned to major to allow patch updates; revisit when major bumps.
langgraph==0.2.*
langchain==0.3.*
langchain-google-genai==2.0.*
```

- [ ] **Step 3: Install into backend venv**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend
.venv/bin/pip install -r requirements.txt 2>&1 | tail -5
```

Expected: "Successfully installed langgraph-..." etc.

- [ ] **Step 4: Smoke-test the imports**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend
.venv/bin/python -c "
import langgraph
import langchain
from langchain.chat_models import init_chat_model
from langgraph.graph import StateGraph
print('ok')
"
```

Expected output: `ok`

- [ ] **Step 5: Commit**

```bash
cd /Users/apple/Desktop/Final_AP_os
git add backend/requirements.txt
git commit -m "deps(ai-scoring): add langgraph, langchain, langchain-google-genai

Three additions for the AI scoring + summary pipeline per spec §2:
  - langgraph 0.2.* (state machine)
  - langchain 0.3.* (prompt + provider abstraction)
  - langchain-google-genai 2.0.* (Gemini Flash default provider)

Major versions pinned; patch updates allowed. Revisit when any
hits a major version bump."
```

---

### Task 2: Scaffolding — directory tree + empty __init__.py files

**Files:**
- Create: `backend/app/services/ai_scoring/__init__.py`
- Create: `backend/app/services/ai_scoring/nodes/__init__.py`
- Create: `backend/app/services/ai_scoring/prompts/signals/.gitkeep`
- Create: `backend/tests/ai_scoring/__init__.py`
- Create: `backend/scripts/ai-scoring/calibration/.gitkeep`
- Create: `backend/scripts/ai-scoring/runs/.gitkeep`
- Modify: `.gitignore` (append one line)

- [ ] **Step 1: Branch check**

```bash
cd /Users/apple/Desktop/Final_AP_os
git branch --show-current
```

Must show `staging-role_based_dashboard`.

- [ ] **Step 2: Create the directory tree**

```bash
cd /Users/apple/Desktop/Final_AP_os
mkdir -p backend/app/services/ai_scoring/nodes
mkdir -p backend/app/services/ai_scoring/prompts/signals
mkdir -p backend/tests/ai_scoring
mkdir -p backend/scripts/ai-scoring/calibration
mkdir -p backend/scripts/ai-scoring/runs
```

- [ ] **Step 3: Create empty package markers**

```bash
touch backend/app/services/ai_scoring/__init__.py
touch backend/app/services/ai_scoring/nodes/__init__.py
touch backend/app/services/ai_scoring/prompts/signals/.gitkeep
touch backend/tests/ai_scoring/__init__.py
touch backend/scripts/ai-scoring/calibration/.gitkeep
touch backend/scripts/ai-scoring/runs/.gitkeep
```

- [ ] **Step 4: Update `.gitignore`**

Append this exact line to `/Users/apple/Desktop/Final_AP_os/.gitignore`:

```
backend/scripts/ai-scoring/runs/*.json
```

(The `.gitkeep` in the directory still lets the empty dir be tracked.)

- [ ] **Step 5: Commit**

```bash
cd /Users/apple/Desktop/Final_AP_os
git add backend/app/services/ai_scoring/ backend/tests/ai_scoring/ backend/scripts/ai-scoring/ .gitignore
git commit -m "scaffold(ai-scoring): directory tree under backend/app/services/ai_scoring

Scaffolds the empty module + tests + scripts tree per spec §11.

  backend/app/services/ai_scoring/
    __init__.py
    nodes/__init__.py
    prompts/signals/.gitkeep
  backend/tests/ai_scoring/__init__.py
  backend/scripts/ai-scoring/
    calibration/.gitkeep
    runs/.gitkeep   (gitignored content)

No real code yet — every module + prompt + test lands in subsequent
tasks following the design at docs/superpowers/specs/2026-05-20-
ai-scoring-langgraph-design.md."
```

---

### Task 3: Migration 016 — rename score_solution → score_completeness

**Files:**
- Create: `backend/migrations/016_rename_score_solution_to_completeness.sql`

- [ ] **Step 1: Branch check + verify current column name**

```bash
cd /Users/apple/Desktop/Final_AP_os
git branch --show-current
grep "score_solution\|score_completeness" backend/migrations/014_admin_platform_phase1.sql | head -5
```

Expect to see `score_solution` listed (the original name from migration 014).

- [ ] **Step 2: Create the migration file**

Write to `backend/migrations/016_rename_score_solution_to_completeness.sql`:

```sql
-- 016_rename_score_solution_to_completeness.sql
--
-- Rename ai_screening.score_solution → ai_screening.score_completeness so
-- the column name matches what it actually stores per the AI scoring spec
-- at docs/superpowers/specs/2026-05-20-ai-scoring-langgraph-design.md §10.
--
-- The frontend leadership review surface already labels this bar
-- "Completeness & depth" (see AIScreeningPanel.jsx) — only the column
-- name was lying.
--
-- Idempotent: only renames if the old column still exists.

begin;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ai_screening'
      and column_name = 'score_solution'
  ) then
    alter table public.ai_screening
      rename column score_solution to score_completeness;
  end if;
end $$;

comment on column public.ai_screening.score_completeness is
  'Completeness & depth signal (0-10). Renamed from score_solution on 2026-05-20 '
  'to align with the AI scoring spec.';

comment on column public.ai_screening.score_integrity is
  'RESERVED / unused in AI scoring v1. The current scoring spec has no '
  'Integrity signal. Column retained to avoid disruptive migrations; '
  'do not write.';

commit;
```

- [ ] **Step 3: Apply the migration to staging via Supabase SQL Editor**

The migration is text-only at this point — it gets applied to staging via the Supabase SQL Editor (per the existing workflow for migrations 014 and 015). The implementer should:

```bash
cat /Users/apple/Desktop/Final_AP_os/backend/migrations/016_rename_score_solution_to_completeness.sql
```

Then paste into Supabase Dashboard → Project `exqmxvdtcsvpgtftwjml` → SQL Editor → Run. Verify the run shows "Success" and check the column exists:

```sql
select column_name from information_schema.columns
where table_name = 'ai_screening' and column_name = 'score_completeness';
```

Should return one row.

- [ ] **Step 4: Verify with a smoke query against staging**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend
.venv/bin/python -c "
import os
from supabase import create_client
url = os.environ.get('STAGING_SUPABASE_URL', 'https://exqmxvdtcsvpgtftwjml.supabase.co')
# Use the service-role key from backend/.env.staging
import re
with open('.env.staging') as f:
    text = f.read()
key = re.search(r'SUPABASE_SERVICE_ROLE_KEY=(\S+)', text).group(1)
client = create_client(url, key)
res = client.table('ai_screening').select('score_completeness').limit(1).execute()
print('score_completeness column accessible:', res.data is not None)
"
```

Expected: `score_completeness column accessible: True`

- [ ] **Step 5: Commit**

```bash
cd /Users/apple/Desktop/Final_AP_os
git add backend/migrations/016_rename_score_solution_to_completeness.sql
git commit -m "feat(db): migration 016 — rename score_solution → score_completeness

Renames ai_screening.score_solution → score_completeness so the
column name matches what it stores. The frontend leadership review
page already labels this bar 'Completeness & depth' (it reads from
score_solution today) — only the schema name was lying.

Per spec §10. score_integrity stays in the schema but is now
documented as legacy/reserved (the AI scoring v1 has no Integrity
signal).

Applied to staging Supabase (exqmxvdtcsvpgtftwjml) via SQL Editor.
Frontend column-name swap follows in the next task; both can land
without breaking the dashboard because the dashboard reads from
ai_screening rows which currently all have NULL scores."
```

---

### Task 4: Frontend column rename — AIScreeningPanel + ReviewsTab

**Files:**
- Modify: `frontend/src/pages/leadership/review/AIScreeningPanel.jsx`
- Modify: `frontend/src/pages/leadership/review/ReviewsTab.jsx`

- [ ] **Step 1: Branch check + show the current code**

```bash
cd /Users/apple/Desktop/Final_AP_os
git branch --show-current
grep -n "score_solution" frontend/src/pages/leadership/review/AIScreeningPanel.jsx frontend/src/pages/leadership/review/ReviewsTab.jsx
```

Expect both files to have a line with `{ key: "score_solution", label: "Completeness & depth" }`.

- [ ] **Step 2: Edit `AIScreeningPanel.jsx`**

In `frontend/src/pages/leadership/review/AIScreeningPanel.jsx`, find this exact line in the `CATEGORY_BARS` constant:

```javascript
  { key: "score_solution",   label: "Completeness & depth" },
```

Replace with:

```javascript
  { key: "score_completeness", label: "Completeness & depth" },
```

(Just the key name changes; the label stays the same.)

- [ ] **Step 3: Edit `ReviewsTab.jsx`**

In `frontend/src/pages/leadership/review/ReviewsTab.jsx`, find the same line in the `CATEGORY_BARS` constant:

```javascript
  { key: "score_solution",   label: "Completeness & depth" },
```

Replace with the same:

```javascript
  { key: "score_completeness", label: "Completeness & depth" },
```

- [ ] **Step 4: Build frontend to confirm no syntax errors**

```bash
cd /Users/apple/Desktop/Final_AP_os/frontend
npx vite build 2>&1 | tail -5
```

Expected: `✓ built in <N>s` (no errors).

- [ ] **Step 5: Commit**

```bash
cd /Users/apple/Desktop/Final_AP_os
git add frontend/src/pages/leadership/review/AIScreeningPanel.jsx frontend/src/pages/leadership/review/ReviewsTab.jsx
git commit -m "fix(leadership): read score_completeness, not score_solution

Migration 016 renamed ai_screening.score_solution → score_completeness
so the column name finally matches what it stores. Updates the two
CATEGORY_BARS arrays that drive the AI score bars on the leadership
review page + reviews tab to read from the new column. Label stays
'Completeness & depth' — only the key changes.

Imported applications still have NULL scores so the bar renders as
'—' on every row; that's correct (no AI scoring has run yet) and will
flip to real values once the AI scoring pipeline ships."
```

---

### Task 5: Pydantic models — state.py (TDD)

**Files:**
- Create: `backend/tests/ai_scoring/test_state.py`
- Create: `backend/app/services/ai_scoring/state.py`

- [ ] **Step 1: Write the failing tests**

Write to `backend/tests/ai_scoring/test_state.py`:

```python
"""Unit tests for ai_scoring/state.py — Pydantic models + ScoringState shape."""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.services.ai_scoring.state import (
    Citation,
    ConfidenceFactors,
    SignalScore,
    CapEvent,
    Round1Summary,
)


def test_citation_minimal():
    c = Citation(source="Q9", quote="Tier-1 aerospace suppliers spend 8 hours per blade.")
    assert c.source == "Q9"
    assert c.quote.startswith("Tier-1")


def test_confidence_factors_clamped_0_to_1():
    cf = ConfidenceFactors(
        data_completeness=0.9, evidence_specificity=0.7,
        internal_consistency=0.8, verifiability=0.6, answer_granularity=0.5,
    )
    assert cf.data_completeness == 0.9
    with pytest.raises(ValidationError):
        ConfidenceFactors(
            data_completeness=1.5, evidence_specificity=0.7,
            internal_consistency=0.8, verifiability=0.6, answer_granularity=0.5,
        )


def test_signal_score_score_in_1_10():
    s = SignalScore(
        signal="problem_impact", score=8,
        rationale="Specific population + quantified pain + clear urgency.",
        evidence_citations=[Citation(source="Q9", quote="Defect miss rate ~3%.")],
        confidence_factors=ConfidenceFactors(
            data_completeness=1.0, evidence_specificity=0.9,
            internal_consistency=0.9, verifiability=0.7, answer_granularity=0.8,
        ),
        flags=[],
    )
    assert s.score == 8
    with pytest.raises(ValidationError):
        SignalScore(
            signal="problem_impact", score=11,
            rationale="x", evidence_citations=[],
            confidence_factors=ConfidenceFactors(
                data_completeness=0, evidence_specificity=0,
                internal_consistency=0, verifiability=0, answer_granularity=0,
            ),
            flags=[],
        )


def test_signal_score_signal_enum():
    with pytest.raises(ValidationError):
        SignalScore(
            signal="something_else", score=5,
            rationale="x", evidence_citations=[],
            confidence_factors=ConfidenceFactors(
                data_completeness=0, evidence_specificity=0,
                internal_consistency=0, verifiability=0, answer_granularity=0,
            ),
            flags=[],
        )


def test_cap_event_shape():
    from datetime import datetime, timezone
    e = CapEvent(
        rule_id="C2", triggered_at=datetime.now(timezone.utc),
        signal_capped=["technical_depth"], cap_value=4,
        evidence_snippet="Deployed in real setting with real users",
        flag="c2_deployed_no_evidence",
    )
    assert e.rule_id == "C2"
    assert "technical_depth" in e.signal_capped


def test_round1_summary_has_5_fields():
    s = Round1Summary(
        verdict="This is a STRONG application for the TIR Track.",
        top_strength="Tech specificity backed by Patent Granted IP.",
        top_concern="Q15 hurdles framed as research questions, not engineering.",
        program_fit="Q17 ask for 6-DOF rig matches ARTPARK motion-capture arena.",
        recommendation="ACCEPT within 14 days pending Patent Office confirmation.",
    )
    assert s.verdict.startswith("This is a")
    assert "ACCEPT" in s.recommendation or "WAITLIST" in s.recommendation or "REJECT" in s.recommendation or "HOLD" in s.recommendation
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend
.venv/bin/pytest tests/ai_scoring/test_state.py -v --no-cov 2>&1 | tail -10
```

Expected: ImportError on `app.services.ai_scoring.state`.

- [ ] **Step 3: Write the implementation**

Write to `backend/app/services/ai_scoring/state.py`:

```python
"""Pydantic models + ScoringState TypedDict for the AI scoring graph.

The ScoringState is what LangGraph passes between nodes. The Pydantic
models are what LangChain enforces as structured outputs from each LLM
call so the graph never has to defensively parse loose JSON.
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal, TypedDict, Union

from pydantic import BaseModel, Field


# ─── Sub-objects shared across nodes ────────────────────────────────


class Citation(BaseModel):
    """A verbatim quote from a specific wizard question."""
    source: str       # e.g. "Q9", "Q12", "Q18"
    quote: str        # the verbatim text snippet


class ConfidenceFactors(BaseModel):
    """Five 0.0–1.0 factors. Aggregated to overall confidence via mean."""
    data_completeness: float    = Field(ge=0, le=1)
    evidence_specificity: float = Field(ge=0, le=1)
    internal_consistency: float = Field(ge=0, le=1)
    verifiability: float        = Field(ge=0, le=1)
    answer_granularity: float   = Field(ge=0, le=1)


SignalName = Literal[
    "problem_impact", "completeness", "technical_depth",
    "behavioural", "commitment",
]


class SignalScore(BaseModel):
    """One Pass 2 scorer's output."""
    signal: SignalName
    score: int = Field(ge=1, le=10)
    rationale: str
    evidence_citations: list[Citation]
    confidence_factors: ConfidenceFactors
    flags: list[str] = Field(default_factory=list)


# ─── Pass 3 audit trail ─────────────────────────────────────────────


CapRuleId = Literal["C1", "C2", "C3", "C5", "C6", "C7", "C9"]


class CapEvent(BaseModel):
    rule_id: CapRuleId
    triggered_at: datetime
    signal_capped: list[str]   # signal names that got capped
    cap_value: int             # the new ceiling
    evidence_snippet: str
    flag: str                  # short flag code stored in ai_screening.flags


# ─── Pass 4 outputs (round 1 + reserved round 2) ────────────────────


class Round1Summary(BaseModel):
    """The 5-section round-1 jury summary."""
    verdict: str        # 1 sentence
    top_strength: str   # 2-3 sentences
    top_concern: str    # 2-3 sentences
    program_fit: str    # 2-3 sentences
    recommendation: str # 1 sentence, ALL CAPS verb


class Round2SignalIntegration(BaseModel):
    """Round 2 only — the 6th section. RESERVED, not used in v1."""
    state: Literal[
        "agree", "rescues_grit", "rescues_trd",
        "catches", "catches_coachability", "neutral",
    ]
    archetype: Literal[
        "Architect", "Builder", "Catalyst", "Visionary",
        "Specialist", "Pioneer", "Explorer",
    ]
    prose: str
    interviewer_probe: str | None = None
    construct_rescued: Literal["grit", "tr_and_d"] | None = None


class Round2Summary(BaseModel):
    """RESERVED for round 2 (TSP integration). Not emitted in v1."""
    verdict: str
    top_strength: str
    top_concern: str
    signal_integration: Round2SignalIntegration
    program_fit: str
    recommendation: str


SummaryUnion = Union[Round1Summary, Round2Summary]


# ─── The LangGraph state ────────────────────────────────────────────


class ScoringState(TypedDict, total=False):
    """State passed between LangGraph nodes. Total=False because nodes
    populate fields incrementally; not every field exists at every node."""

    # Inputs
    application_id: str
    track: Literal["tir", "sip"]
    application_row: dict          # raw tir_applications row
    resume_meta: dict | None       # tir_resume_uploads.parsed_data if available

    # Pass 1 output
    evidence: dict                 # structured evidence (free-form; LLM-shaped)

    # Pass 2 outputs (one per signal)
    score_problem_impact: SignalScore | None
    score_completeness: SignalScore | None
    score_technical_depth: SignalScore | None
    score_behavioural: SignalScore | None
    score_commitment: SignalScore | None

    # Pass 3 outputs
    caps_applied: list[CapEvent]
    composite_percentage: float
    strength_label: str
    confidence_overall: float

    # Pass 4 output
    summary_round_1: Round1Summary | None
    # Reserved for round 2 (always None in v1)
    summary_round_2: Round2Summary | None
    tsp_context: dict | None       # always None in v1

    # Quality gate bookkeeping
    qg_retries: int
    qg_last_failures: list[str]
    qg_needs_human_review: bool

    # Metadata
    model: str
    started_at: datetime
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend
.venv/bin/pytest tests/ai_scoring/test_state.py -v --no-cov 2>&1 | tail -10
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/apple/Desktop/Final_AP_os
git add backend/app/services/ai_scoring/state.py backend/tests/ai_scoring/test_state.py
git commit -m "feat(ai-scoring): Pydantic models + ScoringState TypedDict

state.py exports the shared models the graph uses:

  Citation, ConfidenceFactors        — sub-objects
  SignalScore                        — Pass 2 output
  CapEvent                           — Pass 3 audit row
  Round1Summary                      — Pass 4 round-1 output
  Round2Summary + SignalIntegration  — RESERVED for round 2 (TSP)
  ScoringState (TypedDict)           — LangGraph state shape

Six TDD unit tests cover field clamping (0-1 confidence, 1-10 score),
enum validation (signal name must be one of 5), and round-1 shape.

The Round2* models exist from day one but only the Round1Summary
codepath is exercised in v1. ScoringState.tsp_context exists but
is always None per spec §13."
```

---

### Task 6: Cap rules — caps.py (TDD)

**Files:**
- Create: `backend/tests/ai_scoring/test_caps.py`
- Create: `backend/app/services/ai_scoring/caps.py`

- [ ] **Step 1: Write the failing tests**

Write to `backend/tests/ai_scoring/test_caps.py`:

```python
"""Unit tests for the 7 cap rules in ai_scoring/caps.py.

Each rule has its own trigger test + non-trigger test so we know the
cap fires only when the spec says it should.
"""
from __future__ import annotations

from datetime import datetime, timezone

from app.services.ai_scoring.caps import apply_all_caps


def _row(**overrides):
    """Build a minimal-but-valid tir_applications row, then override."""
    base = {
        "id": "app-1",
        "basic_full_name": "X",
        "basic_email": "x@example.com",
        "basic_incubator_association": "No",
        "basic_incubator_details": None,
        "problem_describe": "Tier-1 aerospace suppliers spend 8 hours of manual inspection per blade. Defect miss rate ~3% causing in-service failures. Tariff pressure means inspection cost must drop 50% by 2027." * 1,
        "problem_defined": "Yes",
        "solution_describe": "Compliant 6-DOF arm with structured-light + deep-learning defect classifier. 10x faster inspection.",
        "solution_core_tech": "Patent-pending compliant-joint design + adaptive calibration.",
        "solution_stage": "Pilot-ready product",
        "execution_will_break": "Sensor drift in dusty environments; latency between embedded controller and cloud inference; physical wear.",
        "execution_milestone": "Q1 bench-validated prototype; Q2 closed-loop pilot 3 sites; Q3 100-unit field deployment.",
        "execution_failure": "First sensor architecture failed monsoon humidity; we pivoted to sealed module.",
        "evidence_files": [{"storage_path": "x/y.pdf", "name": "publication.pdf"}],
        "evidence_video_url": "https://www.loom.com/share/abc",
    }
    base.update(overrides)
    return base


def _scores(**overrides):
    """Default scores all 10/10 so we can see which cap fires."""
    from app.services.ai_scoring.state import (
        SignalScore, Citation, ConfidenceFactors,
    )
    cf = ConfidenceFactors(
        data_completeness=1, evidence_specificity=1,
        internal_consistency=1, verifiability=1, answer_granularity=1,
    )

    def s(signal):
        return SignalScore(
            signal=signal, score=10, rationale="x",
            evidence_citations=[Citation(source="Q1", quote="x")],
            confidence_factors=cf, flags=[],
        )

    base = {
        "problem_impact": s("problem_impact"),
        "completeness": s("completeness"),
        "technical_depth": s("technical_depth"),
        "behavioural": s("behavioural"),
        "commitment": s("commitment"),
    }
    base.update(overrides)
    return base


# ─── C1: active incubator unresolved ────────────────────────────────

def test_c1_active_incubator_unresolved_caps_commitment_to_3():
    row = _row(basic_incubator_association="Yes",
               basic_incubator_details="We are currently incubated at XYZ.")
    capped, events = apply_all_caps(row, _scores(), resume_meta=None)
    assert capped["commitment"].score == 3
    assert any(e.rule_id == "C1" for e in events)


def test_c1_resolved_incubator_does_not_trigger():
    row = _row(basic_incubator_association="Yes",
               basic_incubator_details="We completed XYZ programme in 2023 — no ongoing commitments.")
    capped, events = apply_all_caps(row, _scores(), resume_meta=None)
    assert capped["commitment"].score == 10
    assert not any(e.rule_id == "C1" for e in events)


# ─── C2: deployed claim with no evidence ────────────────────────────

def test_c2_deployed_no_evidence_caps_tech_to_4():
    row = _row(
        solution_stage="Deployed in real setting with real users",
        evidence_files=[], evidence_video_url=None,
    )
    capped, events = apply_all_caps(row, _scores(), resume_meta=None)
    assert capped["technical_depth"].score == 4
    assert any(e.rule_id == "C2" for e in events)


def test_c2_deployed_with_evidence_does_not_trigger():
    row = _row(solution_stage="Deployed in real setting with real users")
    capped, events = apply_all_caps(row, _scores(), resume_meta=None)
    assert not any(e.rule_id == "C2" for e in events)


# ─── C3: patent claim, no evidence file ─────────────────────────────

def test_c3_patent_claim_no_file_caps_tech_to_6():
    row = _row(
        solution_core_tech="We have a patent on the compliant joint.",
        evidence_files=[],
    )
    capped, events = apply_all_caps(row, _scores(), resume_meta=None)
    assert capped["technical_depth"].score == 6
    assert any(e.rule_id == "C3" for e in events)


def test_c3_patent_claim_with_file_does_not_trigger():
    row = _row(solution_core_tech="We have a patent on the compliant joint.")
    capped, events = apply_all_caps(row, _scores(), resume_meta=None)
    assert not any(e.rule_id == "C3" for e in events)


# ─── C5: all-texts <200 chars ───────────────────────────────────────

def test_c5_minimal_texts_caps_completeness_to_2():
    row = _row(
        problem_describe="a",
        solution_describe="b",
        solution_core_tech="c",
        execution_will_break="d",
        execution_milestone="e",
    )
    capped, events = apply_all_caps(row, _scores(), resume_meta=None)
    assert capped["completeness"].score == 2
    assert any(e.rule_id == "C5" for e in events)


# ─── C6: prototype-or-beyond, no artefact ───────────────────────────

def test_c6_prototype_no_artefact_caps_tech_and_behavioural_to_4():
    row = _row(
        solution_stage="Prototype built",
        evidence_files=[], evidence_video_url=None,
    )
    capped, events = apply_all_caps(row, _scores(), resume_meta=None)
    assert capped["technical_depth"].score == 4
    assert capped["behavioural"].score == 4
    assert any(e.rule_id == "C6" for e in events)


def test_c6_prototype_with_resume_does_not_trigger():
    row = _row(
        solution_stage="Prototype built",
        evidence_files=[], evidence_video_url=None,
    )
    capped, events = apply_all_caps(
        row, _scores(),
        resume_meta={"parsed_data": {"name": "X", "completed_projects": 3}},
    )
    assert not any(e.rule_id == "C6" for e in events)


# ─── C7: 10× claim with no baseline ─────────────────────────────────

def test_c7_10x_no_baseline_caps_tech_to_7():
    row = _row(solution_describe="We deliver a 10× improvement.")
    capped, events = apply_all_caps(row, _scores(), resume_meta=None)
    assert capped["technical_depth"].score == 7
    assert any(e.rule_id == "C7" for e in events)


def test_c7_10x_with_baseline_does_not_trigger():
    row = _row(
        solution_describe="We deliver a 10× improvement vs the current 5-second per-blade inspection.",
    )
    capped, events = apply_all_caps(row, _scores(), resume_meta=None)
    assert not any(e.rule_id == "C7" for e in events)


# ─── C9: claimed clarity but short problem ──────────────────────────

def test_c9_yes_but_short_problem_caps_behavioural_to_5():
    row = _row(
        problem_defined="Yes",
        problem_describe="Inspection is hard.",  # well under 80 words
    )
    capped, events = apply_all_caps(row, _scores(), resume_meta=None)
    assert capped["behavioural"].score == 5
    assert any(e.rule_id == "C9" for e in events)


# ─── Caps stack (lower wins) ────────────────────────────────────────

def test_caps_stack_lower_value_wins():
    """When two rules cap the same signal, min() wins."""
    row = _row(
        solution_stage="Deployed in real setting with real users",  # C2 → 4
        evidence_files=[], evidence_video_url=None,
        solution_describe="10× faster.",                            # C7 → 7
    )
    capped, events = apply_all_caps(row, _scores(), resume_meta=None)
    assert capped["technical_depth"].score == 4   # min(4, 7)
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend
.venv/bin/pytest tests/ai_scoring/test_caps.py -v --no-cov 2>&1 | tail -10
```

Expected: ImportError on `app.services.ai_scoring.caps`.

- [ ] **Step 3: Write the implementation**

Write to `backend/app/services/ai_scoring/caps.py`:

```python
"""The 7 deterministic cap rules from spec §5.

Each rule is a pure function (application_row, scores, resume_meta) →
(maybe-CapEvent, signal-name-and-cap-value-tuple-or-None). The dispatcher
runs all 7 and applies the minimum of all caps that fire per signal.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from .state import CapEvent, SignalScore

_PROD_STAGES = {"Prototype built", "Pilot-ready product",
                "Deployed in real setting with real users"}

# C7 regex: "10x", "10×", "10 x", "10 X" — captures the position.
_10X_RE = re.compile(r"\b10\s*[xX×]\b")
# Numeric baseline near the 10× claim (within ~150 chars).
_NUMERIC_RE = re.compile(r"\d+(?:\.\d+)?\s*[a-z%]+", re.IGNORECASE)


# ─── Individual rules (each returns None or (signals, new_cap_value, snippet, flag)) ───


def _has_resolution_language(text: str | None) -> bool:
    if not text:
        return False
    needles = ("no ongoing", "completed", "no longer", "concluded", "ended",
              "exited", "no current", "no active", "resolved")
    lower = text.lower()
    return any(n in lower for n in needles)


def rule_c1(row, scores, resume_meta):
    if row.get("basic_incubator_association") != "Yes":
        return None
    if _has_resolution_language(row.get("basic_incubator_details")):
        return None
    return (["commitment"], 3,
            row.get("basic_incubator_details") or "(no details given)",
            "c1_unresolved_incubator", "C1")


def rule_c2(row, scores, resume_meta):
    if row.get("solution_stage") != "Deployed in real setting with real users":
        return None
    has_files = bool(row.get("evidence_files"))
    has_video = bool(row.get("evidence_video_url"))
    if has_files or has_video:
        return None
    return (["technical_depth"], 4,
            "Deployed claimed, no evidence_files or evidence_video_url",
            "c2_deployed_no_evidence", "C2")


def rule_c3(row, scores, resume_meta):
    core = row.get("solution_core_tech") or ""
    if not re.search(r"\bpatent", core, re.IGNORECASE):
        return None
    if row.get("evidence_files"):
        return None
    return (["technical_depth"], 6,
            core[:200],
            "c3_patent_no_file", "C3")


def rule_c5(row, scores, resume_meta):
    long_text_fields = (
        "problem_describe", "solution_describe", "solution_core_tech",
        "solution_contrarian_insight", "execution_will_break",
        "execution_milestone", "execution_infrastructure",
        "execution_failure", "execution_hwsw_integration",
    )
    total_chars = sum(len(row.get(f) or "") for f in long_text_fields)
    if total_chars >= 200:
        return None
    return (["completeness"], 2,
            f"Total long-text chars: {total_chars}",
            "c5_minimal_application", "C5")


def rule_c6(row, scores, resume_meta):
    if row.get("solution_stage") not in _PROD_STAGES:
        return None
    has_files = bool(row.get("evidence_files"))
    has_video = bool(row.get("evidence_video_url"))
    has_resume = resume_meta is not None and resume_meta.get("parsed_data")
    if has_files or has_video or has_resume:
        return None
    return (["technical_depth", "behavioural"], 4,
            f"Stage={row.get('solution_stage')} but no artefact or CV",
            "c6_prototype_no_artefact", "C6")


def rule_c7(row, scores, resume_meta):
    """Cap technical_depth at 7 if a 10× claim has no nearby numeric baseline."""
    for field in ("solution_describe", "solution_core_tech"):
        text = row.get(field) or ""
        for m in _10X_RE.finditer(text):
            start, end = max(0, m.start() - 150), min(len(text), m.end() + 150)
            window = text[start:end]
            # Remove the 10× token itself before searching for baseline
            window_minus_token = window.replace(m.group(), "")
            if _NUMERIC_RE.search(window_minus_token):
                return None      # baseline found near this 10×; OK
            # No baseline near this 10× — cap
            return (["technical_depth"], 7,
                    text[max(0, m.start() - 30):m.end() + 30],
                    "c7_10x_no_baseline", "C7")
    return None


def rule_c9(row, scores, resume_meta):
    if row.get("problem_defined") != "Yes":
        return None
    problem = row.get("problem_describe") or ""
    word_count = len(problem.split())
    if word_count >= 80:
        return None
    return (["behavioural"], 5,
            f"problem_defined=Yes but problem_describe has only {word_count} words",
            "c9_claimed_clarity_short_problem", "C9")


ALL_RULES = (rule_c1, rule_c2, rule_c3, rule_c5, rule_c6, rule_c7, rule_c9)


def apply_all_caps(
    application_row: dict,
    scores: dict[str, SignalScore],
    resume_meta: dict | None,
) -> tuple[dict[str, SignalScore], list[CapEvent]]:
    """Run all 7 rules; return (capped_scores, fired_events).

    Caps stack via min(): if two rules cap the same signal, the lower
    cap wins. This matches spec §5.
    """
    events: list[CapEvent] = []
    # signal_name → tightest cap that fired
    tightest: dict[str, int] = {}

    for rule in ALL_RULES:
        result = rule(application_row, scores, resume_meta)
        if result is None:
            continue
        signals, cap_value, snippet, flag, rule_id = result
        events.append(CapEvent(
            rule_id=rule_id,
            triggered_at=datetime.now(timezone.utc),
            signal_capped=signals,
            cap_value=cap_value,
            evidence_snippet=snippet,
            flag=flag,
        ))
        for s in signals:
            tightest[s] = min(tightest.get(s, 10), cap_value)

    capped = {}
    for name, score_obj in scores.items():
        ceiling = tightest.get(name, 10)
        if score_obj.score > ceiling:
            capped[name] = score_obj.model_copy(update={"score": ceiling})
        else:
            capped[name] = score_obj

    return capped, events
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend
.venv/bin/pytest tests/ai_scoring/test_caps.py -v --no-cov 2>&1 | tail -15
```

Expected: 14 passed (12 rule-specific + 1 caps-stack + 1 c2-without-evidence-doesnt-trigger).

- [ ] **Step 5: Commit**

```bash
cd /Users/apple/Desktop/Final_AP_os
git add backend/app/services/ai_scoring/caps.py backend/tests/ai_scoring/test_caps.py
git commit -m "feat(ai-scoring): 7 deterministic cap rules (Pass 3a)

caps.py exports apply_all_caps(application_row, scores, resume_meta)
which runs the 7 v1 cap rules from spec §5 and returns:
  - capped_scores: dict[signal_name → SignalScore] with score field
    possibly lowered (caps stack via min)
  - events: list[CapEvent] for audit trail

The 7 rules:
  C1 — active incubator unresolved → Commitment ≤ 3
  C2 — Deployed claim + no evidence files/video → Tech depth ≤ 4
  C3 — Patent claim + no evidence file → Tech depth ≤ 6
  C5 — All long-text < 200 chars → Completeness ≤ 2
  C6 — Prototype-or-beyond + no artefact + no CV → Tech depth + Behavioural ≤ 4
  C7 — 10× claim + no nearby baseline number → Tech depth ≤ 7
  C9 — problem_defined=Yes but problem_describe <80 words → Behavioural ≤ 5

C4 (Q18-absent cap) and C8 (voice mismatch) dropped from v1 per spec.

Fourteen TDD unit tests cover each rule's trigger + non-trigger
behaviour, plus a cap-stacking test where C2 and C7 both fire on
technical_depth and min(4,7)=4 wins."
```

---

### Task 7: Composite + strength bands + confidence — compute.py (TDD)

**Files:**
- Create: `backend/tests/ai_scoring/test_compute.py`
- Create: `backend/app/services/ai_scoring/compute.py`

- [ ] **Step 1: Write the failing tests**

Write to `backend/tests/ai_scoring/test_compute.py`:

```python
"""Unit tests for compute.py — composite, strength bands, mean-of-5 confidence."""
from __future__ import annotations

from app.services.ai_scoring.compute import (
    WEIGHTS, composite_percentage, strength_label, aggregate_confidence,
)
from app.services.ai_scoring.state import (
    SignalScore, Citation, ConfidenceFactors,
)


def _sig(name, score, cf=None):
    if cf is None:
        cf = ConfidenceFactors(
            data_completeness=1, evidence_specificity=1,
            internal_consistency=1, verifiability=1, answer_granularity=1,
        )
    return SignalScore(
        signal=name, score=score, rationale="x",
        evidence_citations=[Citation(source="Q1", quote="x")],
        confidence_factors=cf, flags=[],
    )


def test_weights_sum_to_one():
    assert sum(WEIGHTS.values()) == 1.0


def test_weights_match_spec():
    assert WEIGHTS["problem_impact"]  == 0.25
    assert WEIGHTS["completeness"]    == 0.30
    assert WEIGHTS["technical_depth"] == 0.25
    assert WEIGHTS["behavioural"]     == 0.00
    assert WEIGHTS["commitment"]      == 0.20


def test_composite_all_10s():
    scores = {
        "problem_impact":  _sig("problem_impact", 10),
        "completeness":    _sig("completeness", 10),
        "technical_depth": _sig("technical_depth", 10),
        "behavioural":     _sig("behavioural", 10),
        "commitment":      _sig("commitment", 10),
    }
    assert composite_percentage(scores) == 100.0


def test_composite_behavioural_is_zero_weighted():
    """Behavioural contributes 0 to composite regardless of score."""
    base = {
        "problem_impact":  _sig("problem_impact", 8),
        "completeness":    _sig("completeness", 8),
        "technical_depth": _sig("technical_depth", 8),
        "commitment":      _sig("commitment", 8),
    }
    s_with_high_b  = {**base, "behavioural": _sig("behavioural", 10)}
    s_with_low_b   = {**base, "behavioural": _sig("behavioural", 1)}

    assert composite_percentage(s_with_high_b) == composite_percentage(s_with_low_b) == 80.0


def test_strength_band_thresholds():
    assert strength_label(85) == "EXCEPTIONAL"
    assert strength_label(80) == "EXCEPTIONAL"
    assert strength_label(79.9) == "STRONG"
    assert strength_label(70) == "STRONG"
    assert strength_label(60) == "MODERATE"
    assert strength_label(50) == "WEAK"
    assert strength_label(49.9) == "NON-COMPETITIVE"


def test_aggregate_confidence_mean_of_5_factors_across_signals():
    """For each of the 5 factors, take the mean across the 5 signals,
    then take the mean of those 5 factor-means."""
    high = ConfidenceFactors(
        data_completeness=1, evidence_specificity=1,
        internal_consistency=1, verifiability=1, answer_granularity=1,
    )
    low = ConfidenceFactors(
        data_completeness=0, evidence_specificity=0,
        internal_consistency=0, verifiability=0, answer_granularity=0,
    )

    all_high = {n: _sig(n, 5, high) for n in
                ["problem_impact", "completeness", "technical_depth",
                 "behavioural", "commitment"]}
    assert aggregate_confidence(all_high) == 1.0

    all_low = {n: _sig(n, 5, low) for n in
               ["problem_impact", "completeness", "technical_depth",
                "behavioural", "commitment"]}
    assert aggregate_confidence(all_low) == 0.0


def test_aggregate_confidence_mixed():
    half = ConfidenceFactors(
        data_completeness=0.5, evidence_specificity=0.5,
        internal_consistency=0.5, verifiability=0.5, answer_granularity=0.5,
    )
    scores = {n: _sig(n, 5, half) for n in
              ["problem_impact", "completeness", "technical_depth",
               "behavioural", "commitment"]}
    assert aggregate_confidence(scores) == 0.5
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend
.venv/bin/pytest tests/ai_scoring/test_compute.py -v --no-cov 2>&1 | tail -10
```

Expected: ImportError on `app.services.ai_scoring.compute`.

- [ ] **Step 3: Write the implementation**

Write to `backend/app/services/ai_scoring/compute.py`:

```python
"""Composite percentage, strength bands, and confidence aggregation."""
from __future__ import annotations

from statistics import mean

from .state import SignalScore


# ─── Weights ────────────────────────────────────────────────────────


WEIGHTS: dict[str, float] = {
    "problem_impact":  0.25,
    "completeness":    0.30,
    "technical_depth": 0.25,
    "behavioural":     0.00,   # scored but not weighted (post-psychometric only)
    "commitment":      0.20,
}
assert abs(sum(WEIGHTS.values()) - 1.0) < 1e-9


# ─── Composite ──────────────────────────────────────────────────────


def composite_percentage(scores: dict[str, SignalScore]) -> float:
    """Weighted composite as a 0-100 percentage.

    score (1-10) × weight, summed, ×10. Behavioural's 0% weight means
    it has no effect on the composite regardless of its score.
    """
    raw = sum(scores[name].score * w for name, w in WEIGHTS.items())
    return round(raw * 10, 1)


# ─── Strength bands ─────────────────────────────────────────────────


def strength_label(percentage: float) -> str:
    """Spec §3 strength bands. Boundaries are inclusive on the lower end."""
    if percentage >= 80:
        return "EXCEPTIONAL"
    if percentage >= 70:
        return "STRONG"
    if percentage >= 60:
        return "MODERATE"
    if percentage >= 50:
        return "WEAK"
    return "NON-COMPETITIVE"


# ─── Confidence aggregation ─────────────────────────────────────────


_FACTORS = (
    "data_completeness", "evidence_specificity", "internal_consistency",
    "verifiability", "answer_granularity",
)


def aggregate_confidence(scores: dict[str, SignalScore]) -> float:
    """Mean of the 5 factors, each averaged across the 5 signals.

    Equivalent to: take the full 5×5 matrix of factor values, mean them all.
    """
    cells: list[float] = []
    for score in scores.values():
        for factor_name in _FACTORS:
            cells.append(getattr(score.confidence_factors, factor_name))
    return round(mean(cells), 3)
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend
.venv/bin/pytest tests/ai_scoring/test_compute.py -v --no-cov 2>&1 | tail -10
```

Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/apple/Desktop/Final_AP_os
git add backend/app/services/ai_scoring/compute.py backend/tests/ai_scoring/test_compute.py
git commit -m "feat(ai-scoring): composite, strength bands, mean-of-5 confidence

compute.py exports three pure functions used by the Pass 3 Python node:

  composite_percentage(scores) → 0-100 float
    weighted sum: 25 problem + 30 completeness + 25 tech + 0 behavioural
    + 20 commitment (× 10 to land on a 0-100 scale).

  strength_label(pct) → 'EXCEPTIONAL' / 'STRONG' / 'MODERATE' / 'WEAK'
                       / 'NON-COMPETITIVE'
    Bands from spec §3, inclusive at the lower boundary.

  aggregate_confidence(scores) → 0.0-1.0 float
    Mean of every confidence factor across every signal (5×5 = 25 cells).

Seven TDD tests cover: WEIGHTS sum to 1, all-10s composite = 100,
behavioural 0%-weight invariance, strength-band thresholds, mean-of-5
on uniform high/low/half inputs."
```

---

### Task 8: Quality gate — quality_gate.py (TDD)

**Files:**
- Create: `backend/tests/ai_scoring/test_quality_gate.py`
- Create: `backend/app/services/ai_scoring/nodes/quality_gate.py`

- [ ] **Step 1: Write the failing tests**

Write to `backend/tests/ai_scoring/test_quality_gate.py`:

```python
"""Unit tests for the 10 deterministic quality-gate checks (Pass 4)."""
from __future__ import annotations

from app.services.ai_scoring.nodes.quality_gate import (
    check_word_count, check_score_numbers_in_prose, check_weasel_words,
    check_recommendation_verb, check_accept_has_deadline,
    check_artpark_reference, check_passive_voice_density,
    check_specific_entity_per_section, evaluate_summary,
)
from app.services.ai_scoring.state import Round1Summary


def _summary(**overrides):
    base = dict(
        verdict="This is a STRONG application for the TIR Track.",
        top_strength="Tech depth and Patent Granted IP both anchor the case at IIT Madras with 10x faster inspection.",
        top_concern="Q15 hurdles framed as research questions, not engineering challenges, risks scope drift.",
        program_fit="Q17 ask for 6-DOF arena matches ARTPARK's motion-capture rig and partner-customer network.",
        recommendation="ACCEPT within 14 days pending Patent Office confirmation.",
    )
    base.update(overrides)
    return Round1Summary(**base)


def test_word_count_in_range_passes():
    s = _summary()
    assert check_word_count(s, lo=20, hi=300) == []


def test_word_count_too_low_fails():
    fails = check_word_count(_summary(), lo=10000, hi=20000)
    assert any("word count" in f.lower() for f in fails)


def test_no_score_numbers_in_prose_passes():
    s = _summary()
    assert check_score_numbers_in_prose(s) == []


def test_score_numbers_in_prose_caught():
    s = _summary(top_strength="Scored 9/10 on technical depth and 10 out of 10 on commitment.")
    fails = check_score_numbers_in_prose(s)
    assert len(fails) >= 1


def test_weasel_words_passes_clean():
    s = _summary()
    assert check_weasel_words(s) == []


def test_weasel_words_caught():
    s = _summary(top_strength="Very promising approach with somewhat strong evidence.")
    fails = check_weasel_words(s)
    assert any("very" in f.lower() or "somewhat" in f.lower() for f in fails)


def test_recommendation_verb_accept_passes():
    assert check_recommendation_verb(_summary()) == []


def test_recommendation_verb_lowercase_caught():
    s = _summary(recommendation="accept within 14 days pending confirmation.")
    fails = check_recommendation_verb(s)
    assert any("uppercase" in f.lower() or "all caps" in f.lower() for f in fails)


def test_recommendation_verb_unknown_caught():
    s = _summary(recommendation="MAYBE we should think about it.")
    fails = check_recommendation_verb(s)
    assert len(fails) >= 1


def test_accept_has_deadline_passes():
    assert check_accept_has_deadline(_summary()) == []


def test_accept_without_deadline_fails():
    s = _summary(recommendation="ACCEPT this strong applicant for the TIR cohort.")
    fails = check_accept_has_deadline(s)
    assert any("deadline" in f.lower() or "within" in f.lower() for f in fails)


def test_artpark_reference_passes():
    assert check_artpark_reference(_summary()) == []


def test_artpark_reference_missing_caught():
    s = _summary(program_fit="The applicant is a good fit and has strong ambitions for India.")
    fails = check_artpark_reference(s)
    assert any("artpark" in f.lower() for f in fails)


def test_specific_entity_per_section_passes():
    """Each section must have at least one number or named entity."""
    assert check_specific_entity_per_section(_summary()) == []


def test_specific_entity_missing_section_caught():
    s = _summary(top_strength="The approach is good and the team appears capable.")
    fails = check_specific_entity_per_section(s)
    assert any("specific" in f.lower() or "entity" in f.lower() for f in fails)


def test_passive_voice_density_passes_active():
    assert check_passive_voice_density(_summary(), threshold=0.20) == []


def test_evaluate_summary_returns_dict():
    """End-to-end: runs every check, returns a structured pass/fail report."""
    result = evaluate_summary(_summary())
    assert "passed" in result
    assert "failures" in result
    assert isinstance(result["failures"], list)
    assert result["passed"] is True
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend
.venv/bin/pytest tests/ai_scoring/test_quality_gate.py -v --no-cov 2>&1 | tail -10
```

Expected: ImportError on `app.services.ai_scoring.nodes.quality_gate`.

- [ ] **Step 3: Write the implementation**

Write to `backend/app/services/ai_scoring/nodes/quality_gate.py`:

```python
"""Quality gate — 10 deterministic checks on a Round1Summary.

Each check returns a list of failure strings (empty list = pass).
evaluate_summary() runs all of them and returns a structured report.
"""
from __future__ import annotations

import re

from ..state import Round1Summary


_WEASEL_WORDS = (
    "very", "quite", "somewhat", "consider", "maybe", "might", "possibly",
)
_ALLOWED_VERBS = ("ACCEPT", "WAITLIST", "REJECT", "HOLD")
_SCORE_NUMBER_RE = re.compile(r"\b\d+\s*/\s*10\b|\b\d+\s+out of\s+10\b", re.IGNORECASE)
_DEADLINE_RE = re.compile(r"\bwithin\s+\d+\s+(days?|weeks?|hours?)\b", re.IGNORECASE)
_ARTPARK_RE = re.compile(r"artpark", re.IGNORECASE)
_PASSIVE_RE = re.compile(
    r"\b(is|are|was|were|been|being|be)\s+\w+ed\b", re.IGNORECASE
)
_NUMBER_OR_NAMED_ENTITY_RE = re.compile(
    r"\b\d+|\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)+|\bQ\d+",
)


def _sections(summary: Round1Summary) -> dict[str, str]:
    return {
        "verdict": summary.verdict,
        "top_strength": summary.top_strength,
        "top_concern": summary.top_concern,
        "program_fit": summary.program_fit,
        "recommendation": summary.recommendation,
    }


def _word_count(text: str) -> int:
    return len(text.split())


# ─── Individual checks ─────────────────────────────────────────────


def check_word_count(summary: Round1Summary, lo: int = 200, hi: int = 280) -> list[str]:
    total = sum(_word_count(v) for v in _sections(summary).values())
    if lo <= total <= hi:
        return []
    return [f"word count {total} outside range {lo}-{hi}"]


def check_score_numbers_in_prose(summary: Round1Summary) -> list[str]:
    fails: list[str] = []
    for name, text in _sections(summary).items():
        if _SCORE_NUMBER_RE.search(text):
            fails.append(f"section '{name}' contains raw score number")
    return fails


def check_weasel_words(summary: Round1Summary) -> list[str]:
    fails: list[str] = []
    for name, text in _sections(summary).items():
        for w in _WEASEL_WORDS:
            if re.search(rf"\b{w}\b", text, re.IGNORECASE):
                fails.append(f"section '{name}' contains weasel word '{w}'")
                break
    return fails


def check_recommendation_verb(summary: Round1Summary) -> list[str]:
    rec = summary.recommendation.strip()
    first = rec.split()[0] if rec else ""
    if first in _ALLOWED_VERBS:
        return []
    if first.upper() in _ALLOWED_VERBS:
        return [f"recommendation verb '{first}' should be uppercase ALL CAPS"]
    return [f"recommendation must start with one of {_ALLOWED_VERBS}"]


def check_accept_has_deadline(summary: Round1Summary) -> list[str]:
    rec = summary.recommendation
    if not rec.lstrip().upper().startswith("ACCEPT"):
        return []
    if _DEADLINE_RE.search(rec):
        return []
    return ["ACCEPT recommendation must include a 'within N days' deadline"]


def check_artpark_reference(summary: Round1Summary) -> list[str]:
    if _ARTPARK_RE.search(summary.program_fit):
        return []
    # ARTPARK assets list also commonly mentioned by name (motion-capture,
    # GPU cluster, etc.) — for the strictest check, require the word.
    return ["program_fit must reference ARTPARK by name"]


def check_specific_entity_per_section(summary: Round1Summary) -> list[str]:
    fails: list[str] = []
    for name, text in _sections(summary).items():
        if not _NUMBER_OR_NAMED_ENTITY_RE.search(text):
            fails.append(f"section '{name}' lacks any specific entity (number or proper noun)")
    return fails


def check_passive_voice_density(summary: Round1Summary, threshold: float = 0.10) -> list[str]:
    """Rough heuristic — fraction of sentences with a be-verb + past participle."""
    all_text = " ".join(_sections(summary).values())
    sentences = re.split(r"[.!?]+", all_text)
    sentences = [s for s in sentences if s.strip()]
    if not sentences:
        return []
    passive = sum(1 for s in sentences if _PASSIVE_RE.search(s))
    density = passive / len(sentences)
    if density >= threshold:
        return [f"passive voice density {density:.0%} ≥ threshold {threshold:.0%}"]
    return []


# ─── Top-level dispatcher ──────────────────────────────────────────


def evaluate_summary(summary: Round1Summary) -> dict:
    """Run all checks. Returns {passed: bool, failures: [...]}.

    'passed' is True iff all hard checks pass. The passive-voice check
    is treated as informational only (warning, not blocker).
    """
    hard_failures: list[str] = []
    hard_failures.extend(check_word_count(summary))
    hard_failures.extend(check_score_numbers_in_prose(summary))
    hard_failures.extend(check_weasel_words(summary))
    hard_failures.extend(check_recommendation_verb(summary))
    hard_failures.extend(check_accept_has_deadline(summary))
    hard_failures.extend(check_artpark_reference(summary))
    hard_failures.extend(check_specific_entity_per_section(summary))

    warnings = check_passive_voice_density(summary)

    return {
        "passed": len(hard_failures) == 0,
        "failures": hard_failures,
        "warnings": warnings,
    }
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend
.venv/bin/pytest tests/ai_scoring/test_quality_gate.py -v --no-cov 2>&1 | tail -10
```

Expected: 16 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/apple/Desktop/Final_AP_os
git add backend/app/services/ai_scoring/nodes/quality_gate.py backend/tests/ai_scoring/test_quality_gate.py
git commit -m "feat(ai-scoring): 10-check quality gate (Pass 4 post-synthesis)

quality_gate.py exports evaluate_summary(Round1Summary) which runs the
10 deterministic checks from spec §9.3 and returns:
  {passed: bool, failures: list[str], warnings: list[str]}

Hard checks (failure = regenerate):
  - word count 200-280
  - no raw score numbers in prose
  - no weasel words (very/quite/somewhat/consider/maybe/might/possibly)
  - recommendation starts with ALL CAPS verb (ACCEPT/WAITLIST/REJECT/HOLD)
  - ACCEPT has 'within N days' deadline
  - program_fit references ARTPARK
  - every section has at least one specific entity (number or proper noun)

Warning only (informational):
  - passive voice density ≥ 10%

Sixteen TDD unit tests cover each check's pass + fail paths plus an
end-to-end evaluate_summary() smoke test."
```

---

### Task 9: ARTPARK assets reference doc

**Files:**
- Create: `backend/app/services/ai_scoring/artpark_assets.md`

- [ ] **Step 1: Branch check + create the placeholder reference**

The actual asset list needs leadership sign-off per spec §16. The placeholder is enough to keep the pipeline buildable end-to-end; replace before deployment.

Write to `backend/app/services/ai_scoring/artpark_assets.md`:

```markdown
# ARTPARK assets available to TIR residents

**Status**: PLACEHOLDER — confirm with lead before deployment (spec §16
acceptance criterion). Synthesis prompt loads this verbatim; the LLM
matches Q17 (`execution_infrastructure`) asks against this list.

## Compute + ML
- GPU cluster (multi-A100 / H100, training perception models)
- Datasets: ARTPARK collected industrial / agricultural sensor corpora

## Robotics + Hardware
- 6-DOF motion-capture arena
- CNC + 3D-printing for weekly hardware iteration
- Robotics testbeds (legged, manipulation, mobile)
- Anechoic chamber

## Wet labs
- Materials testing
- Biology / sensor characterization

## Network + People
- Pilot-customer network across manufacturing / agritech / healthcare / defense
- Translational R&D mentors in residence
- Connections to ARTPARK industry partners + IISc faculty

## How the LLM uses this
When writing PROGRAM FIT, prefer specific matches:
  - Applicant asks for "GPU cluster for perception training" → cite GPU cluster
  - Applicant asks for "motion-capture rig" → cite the 6-DOF arena
  - Applicant asks for "field pilot sites" → cite the pilot-customer network
If no specific asset matches the Q17 ask, write a one-sentence general
ARTPARK-network framing without inventing assets that aren't on this list.
```

- [ ] **Step 2: Commit**

```bash
cd /Users/apple/Desktop/Final_AP_os
git add backend/app/services/ai_scoring/artpark_assets.md
git commit -m "docs(ai-scoring): ARTPARK assets reference (placeholder)

Placeholder reference doc loaded into Pass 4 system prompt so the
synthesize node can match Q17 (execution_infrastructure) asks
against specific ARTPARK assets when writing PROGRAM FIT.

Marked PLACEHOLDER in the doc body — the real asset list needs
leadership sign-off per spec §16 acceptance criteria before
deployment. The list shape stays the same; only the bullets get
revised."
```

---

### Task 10: Static prompts — extract_evidence + 5 scorers + synthesize

**Files:**
- Create: `backend/app/services/ai_scoring/prompts/extract_evidence.txt`
- Create: `backend/app/services/ai_scoring/prompts/signals/problem_impact.txt`
- Create: `backend/app/services/ai_scoring/prompts/signals/completeness.txt`
- Create: `backend/app/services/ai_scoring/prompts/signals/technical_depth.txt`
- Create: `backend/app/services/ai_scoring/prompts/signals/behavioural.txt`
- Create: `backend/app/services/ai_scoring/prompts/signals/commitment.txt`
- Create: `backend/app/services/ai_scoring/prompts/synthesize_round_1.txt`

- [ ] **Step 1: Write `prompts/extract_evidence.txt`**

```text
You are the Pass 1 Evidence Extractor for the ARTPARK TIR application
scoring pipeline.

You receive ONE raw application row (basic_*, problem_*, solution_*,
execution_*, evidence_*, declaration_*) plus optional resume parsed_data.

Produce a single JSON object with these keys:
  basic           — name redacted (use "Applicant"), keep org/degree/team/incubator/hear_about
  problem         — describe, defined (verbatim from application)
  solution        — describe, core_tech, contrarian_insight, stage
  execution       — will_break, milestone, infrastructure, failure, hwsw_integration
  evidence_assets — file_count, file_names[], video_url_present (bool)
  resume          — cv_summary (~100 words) + completion_patterns:
                    {completed_projects: int, abandoned: int, role_gap_months: int}
                    (null if no resume_meta provided)
  derived         — char_counts and word_counts per long-text field; regex flags:
                    has_10x (bool), has_baseline_number (bool),
                    has_patent_keyword (bool), problem_word_count (int)

CRITICAL RULES:
1. Strip identifying info: basic_full_name, basic_phone, basic_email → "REDACTED".
2. Keep ALL long-text answers verbatim — do not summarize, rephrase, or shorten.
3. Resume cv_summary IS a summary (~100 words). Long-text wizard answers ARE NOT.
4. derived.has_baseline_number = true if any "10x" / "10×" claim has a numeric
   comparator within ±150 chars (e.g. "10x faster than the current 5-second rate").

Return JSON only, no prose.
```

- [ ] **Step 2: Write `prompts/signals/problem_impact.txt`**

```text
You are scoring the Problem impact dimension of a TIR application.
This signal measures how acute, urgent, large, and well-defined the
problem is — based on the applicant's answers to Q9 (critical problem)
and Q10 (well-defined check).

You will receive a structured evidence object from Pass 1 containing
all Q&A pairs. Score on the 1-10 ladder using the anchors below. Every
score must be backed by verbatim evidence citations from Q9 and Q10.

Anchors:
  10: Specific population named, economic/human cost quantified,
      external "why now" trigger present, Q10 self-assessment matches Q9 evidence.
   7: Real population and pain identified, directional quantification,
      plausible urgency.
   4: Friction described not pain, no quantification, no clear urgency.
   1: No specific victim, technology-looking-for-a-problem framing.

Decision procedure:
  1. Read Q9. Identify: (a) who suffers, (b) quantified pain
     (numbers, market size, human cost), (c) why now (external trigger).
  2. Read Q10. Cross-check: if Q10 = "Yes" but Q9 is vague, this is
     overclaiming — note in rationale.
  3. Apply the ladder. Intermediate scores (2, 3, 5, 6, 8, 9) require
     explicit two-rung rationale.
  4. Return JSON matching the SignalScore schema.

Do not:
  - Reward eloquence. Specificity > polish.
  - Score the solution; this is Problem impact only.
  - Score above 7 if Q9 lacks any quantification.

Return only the JSON object.
```

- [ ] **Step 3: Write `prompts/signals/completeness.txt`**

```text
You are scoring the Completeness & depth dimension of a TIR application.
This signal measures how completely and substantively the applicant has
filled the application — based on long-text answers Q11, Q15, Q16, Q17,
and evidence sections Q20, Q21.

You will receive a structured evidence object from Pass 1. Score on the
1-10 ladder. Every score must be backed by verbatim citations.

Anchors:
  10: All required Qs answered substantively. Q15 hurdles are specific
      (not "market risk"). Q16 milestones are quarterly and outcome-linked.
      Q17 infrastructure ask is justified. Q20 or Q21 present with
      verifiable evidence.
   7: All required answered, most specific, one or two loose. Evidence partial.
   4: Required answered but multiple generic. Evidence thin or absent.
   1: Minimal answers (<200 chars), off-prompt, or contradictory.

Decision procedure:
  1. Read Q11, Q15, Q16, Q17 — check each for specificity (named
     numbers, dates, technical detail) vs generic language.
  2. Check Q20 and Q21 — count present evidence types (Pass 1 surfaces
     evidence_assets.file_count + video_url_present).
  3. Read Q18 and Q19 (optional) — presence boosts, absence does not
     penalise here.
  4. Apply the ladder.
  5. Return JSON matching the SignalScore schema.

Do not:
  - Reward verbosity. A short specific answer beats a long generic one.
  - Penalise self-taught applicants for less formal writing if substance
    is present.
  - Score the technical claim itself (that's Technical depth) — score
    how completely it's articulated.

Return only the JSON object.
```

- [ ] **Step 4: Write `prompts/signals/technical_depth.txt`**

```text
You are scoring the Technical depth dimension of a TIR application.
This signal measures the technical substance of the solution and the
candidate's command of translational R&D — based on Q11 (solution),
Q12 (core tech / unfair advantage), Q13 (rare insight, optional),
Q14 (stage), Q15 (technical hurdles), Q19 (hw-sw integration, optional),
and supporting evidence Q20, Q21.

You will receive a structured evidence object from Pass 1. Score on
the 1-10 ladder.

Anchors:
  10: Q11 specific lab-proven advance + metricised 10× with named baseline.
      Q12 genuine moat (patent #, dataset). Q15 hurdles technically specific.
      Q14 stage matches Q20/Q21 evidence.
   7: Real technical approach, moderate novelty, hurdles real but mitigations generic.
   4: Generic ("we use AI/ML"), no specific algorithm, hurdles framed
      as fundamental questions.
   1: No technical content, commodity description, no hurdle awareness.

Decision procedure:
  1. Read Q11. Check for: specific technical approach (named methods,
     not buzzwords), metricised 10× claim with explicit baseline.
  2. Read Q12. Check for: lab-proven specifics, named moat (patent,
     dataset, design).
  3. Read Q15. Distinguish engineering hurdles (good signal) from
     fundamental research unknowns (signals earlier-stage than claimed).
  4. Cross-check Q14 stage against Q20/Q21 evidence — if "Prototype built"
     but no images/video, flag and cap.
  5. Read Q13 and Q19 if present — boost only.
  6. Apply the ladder. Return JSON.

Do not:
  - Reward jargon density. Specificity > technical-sounding language.
  - Score the problem (that's Problem impact).
  - Score above 7 if 10× claim has no baseline named.
  - Score above 4 if Q14 says "Deployed" but Q20 + Q21 are both empty.

Return only the JSON object.
```

- [ ] **Step 5: Write `prompts/signals/behavioural.txt`**

```text
You are scoring the Behavioural signal dimension of a TIR application.
This signal measures how the applicant thinks and responds under
conditions of ambiguity, failure, and customer contact — inferred from
application text. This signal targets the person, not the project.

You will receive a structured evidence object from Pass 1. Score on
the 1-10 ladder. Primary evidence is Q18 (failure/pivot, optional).
Secondary: Q19 (hw-sw troubleshooting, optional), voice consistency
across Q9, Q11, Q12, Q15, Q16, Q17, Q18, Q19.

Note: Behavioural carries 0% weight in the v1 round-1 composite. You
still score it because it appears on a post-psychometric dashboard for
selected teams. Score honestly; do not inflate.

Anchors:
  10: Q18 names specific failure + cause + decision + measurable change.
      Concrete language. Q19 (if present) shows system diagnosis.
      Voice consistent.
   7: Real failure described, missing one of cause/decision/measurable change.
      Mostly concrete.
   4: Generic reflection, buzzword-heavy, no specific decision named.
   1: Q18 absent, blamed externally, or boilerplate throughout.

Decision procedure:
  1. Read Q18 (failure/pivot story). If absent, score the rest honestly
     using voice consistency + Q19 + resume completion patterns.
  2. Read Q19 if present. Compare voice/specificity to Q18.
  3. Read Q11, Q15, Q16, Q17 only for voice comparison (not substance).
  4. Inspect resume completion_patterns — abandoned projects, role gaps.
  5. Apply the ladder. Return JSON.

Do not:
  - Score based on what the project is. Score how the person describes
    themselves doing it.
  - Reward eloquence. Penalise boilerplate. Specificity > polish.
  - Infer character traits not directly evidenced in text.
  - Read Q4, Q6, Q7, or Q16 — those are Commitment's evidence, not yours.

Honest limitation to surface in rationale: Application text is rehearsed.
This signal is triangulated by a psychometric instrument in round 2 (not v1).

Return only the JSON object.
```

- [ ] **Step 6: Write `prompts/signals/commitment.txt`**

```text
You are scoring the Commitment signal dimension of a TIR application.
This signal measures whether the applicant will show up and execute
through a 12-month residency — based on verifiable commitment
conditions in Q4 (current org), Q6 (team status), Q7 (past/current
incubator), and Q16 (milestones + budget). Plus resume completion
patterns (completed vs abandoned projects, role gaps).

Note: Q22 (declaration tick-boxes) is a submission gate — applicants
cannot submit without ticking the required boxes — so it carries no
differentiating signal. Do not score it.

You will NOT read Q18 (failure story). Q18 belongs exclusively to the
Behavioural signal. No double-counting.

You will receive a structured evidence object from Pass 1. Score on
the 1-10 ladder.

Anchors:
  10: Q4 current org matches stated intent. Q6 team clarity. Q7 no
      active conflicts (or resolved). Q16 quarterly milestones outcome-
      linked. Resume shows pattern of completed projects.
   7: Q6 clear. Q7 past association no current conflict. Q16 milestones
      present, not quarterly.
   4: Q6 unclear. Q7 active commitment elsewhere unresolved. Q16 vague.
   1: Q7 active conflicting grant/employment. Q16 absent. Q4/Q6
      contradict stated intent.

Decision procedure:
  1. Read Q7. Active conflict = cap at 3. Resolved past = no cap.
  2. Cross-check Q4 (current org) against any stated full-time intent.
  3. Read Q6 (team). Solo is fine; team with unclear roles is not.
  4. Read Q16 (milestones). Check granularity (quarterly?), measurability,
     budget linkage.
  5. Read resume completion_patterns if present.
  6. Apply the ladder. Return JSON.

Do not:
  - Penalise solo founders. Solo is not a commitment risk; unclear roles are.
  - Reward verbosity in Q16. Specific milestones > long lists.
  - Score above 7 if Q7 has unresolved active commitment.
  - Treat Q22 ticks as evidence.
  - Read Q18. That's Behavioural's evidence.

Return only the JSON object.
```

- [ ] **Step 7: Write `prompts/synthesize_round_1.txt`**

```text
You are composing the round 1 AI Summary for a TIR application. The
application has been scored on 5 signals (Pass 2), audited for
contradictions and capped where needed (Pass 3), and assigned a
confidence rating. You will receive all of this as structured context.

You will ALSO receive an ARTPARK assets reference list. Use this when
writing PROGRAM FIT.

Write a 200-280 word report with exactly 5 sections in this order:
VERDICT, TOP STRENGTH, TOP CONCERN, PROGRAM FIT, RECOMMENDATION.

Section rules:

VERDICT (1 sentence): exactly format
  "This is a <STRENGTH_LABEL> application for the TIR Track."
where STRENGTH_LABEL is provided in context.

TOP STRENGTH (2-3 sentences): The single most compelling thing.
Synergy logic: if two signals both ≥8, pair them into a narrative.
Cite one specific evidence detail (a number, a named entity, a
specific claim from Q11/Q12/Q15).

TOP CONCERN (2-3 sentences): The single most fatal risk. Priority:
critical flags (any caps_applied) > weakest weighted signal (skip
Behavioural — it's 0% weight in v1) > internal contradictions. Name
the specific evidence gap and the downstream consequence.

PROGRAM FIT (2-3 sentences): Three connections — institution → ARTPARK
infrastructure (match Q17 ask against the provided ARTPARK assets list),
stage → programme design, problem → ARTPARK mission. Do not invent
ARTPARK assets that are not in the provided list.

RECOMMENDATION (1 sentence): ALL CAPS verb at the start
(ACCEPT/WAITLIST/REJECT/HOLD). If ACCEPT, attach time-bound condition
("within X days"). If WAITLIST, name promotion trigger. If REJECT,
cite fatal gap.

Do not:
  - Mention raw score numbers in prose ("9/10", "out of 10" forbidden).
  - Use weasel words: very, quite, somewhat, consider, maybe, might,
    possibly.
  - Use passive voice excessively.
  - Reference psychometric or TSP data (round 2 only — does not apply in v1).

Return as JSON with keys: verdict, top_strength, top_concern,
program_fit, recommendation.
```

- [ ] **Step 8: Commit all 7 prompts**

```bash
cd /Users/apple/Desktop/Final_AP_os
git add backend/app/services/ai_scoring/prompts/
git commit -m "feat(ai-scoring): static prompts (7 files)

Seven prompt templates load at node-init time per spec §6-9:
  prompts/extract_evidence.txt          — Pass 1
  prompts/signals/problem_impact.txt    — Pass 2 (×5)
  prompts/signals/completeness.txt
  prompts/signals/technical_depth.txt
  prompts/signals/behavioural.txt       (carries the 'do not read Q4/Q6/Q7/Q16' split)
  prompts/signals/commitment.txt        (carries the 'do not read Q18' split)
  prompts/synthesize_round_1.txt        — Pass 4

Behavioural and Commitment prompts explicitly forbid reading each
other's evidence pool — enforces the no-double-counting decision
from spec §4. Behavioural prompt also drops the 'score ≤ 7 if Q18
absent' line (the doc's original self-cap, removed in our v1).

Worked examples (Path A calibration) appended later; these are the
zero-shot v0 templates."
```

---

### Task 11: Pass 1 — Evidence Extractor node (TDD with fake LLM)

**Files:**
- Create: `backend/tests/ai_scoring/conftest.py`
- Create: `backend/tests/ai_scoring/test_extract_evidence_node.py`
- Create: `backend/app/services/ai_scoring/nodes/extract_evidence.py`

- [ ] **Step 1: Write the shared conftest with fake LLM helper**

Write to `backend/tests/ai_scoring/conftest.py`:

```python
"""Shared fixtures for the AI scoring test suite.

The fake LLM uses langchain_core.language_models.fake_chat_models.
FakeListChatModel which lets us script LLM responses per test.
"""
from __future__ import annotations

import json

import pytest
from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langchain_core.messages import AIMessage


def _ai_json(payload: dict) -> AIMessage:
    return AIMessage(content=json.dumps(payload))


@pytest.fixture
def fake_llm():
    """A factory: pass a list of dicts; each scripted call returns one."""
    def _make(responses: list[dict]) -> FakeListChatModel:
        return FakeListChatModel(responses=[json.dumps(r) for r in responses])
    return _make


@pytest.fixture
def sample_application_row():
    return {
        "id": "app-uuid-1",
        "basic_full_name": "Test User",
        "basic_phone": "+91 9000000000",
        "basic_email": "user@example.com",
        "basic_org": "IIT Madras",
        "basic_degree": "PhD",
        "basic_has_team": "Yes — I have co-founders",
        "basic_incubator_association": "No",
        "basic_incubator_details": None,
        "basic_hear_about": "Referral from friend/colleague",
        "problem_describe": "Tier-1 aerospace suppliers spend 8 hours of manual inspection per blade. Defect miss rate ~3% causing in-service failures. Tariff pressure means inspection cost must drop 50% by 2027.",
        "problem_defined": "Yes",
        "solution_describe": "Compliant 6-DOF arm with structured-light + deep-learning defect classifier. 10× faster inspection vs the current 8-hour-per-blade manual baseline.",
        "solution_core_tech": "Novel compliant-joint design with sub-millimeter repeatability under 8 kg payload — combination of patented compliant linkage and learned calibration.",
        "solution_contrarian_insight": None,
        "solution_stage": "Pilot-ready product",
        "execution_will_break": "Sensor calibration drift in dusty environments; latency between embedded controller and cloud inference; physical wear-and-tear on actuators.",
        "execution_milestone": "Q1: bench-validated prototype. Q2: closed-loop pilot with 3 partner sites. Q3: 100-unit field deployment. Q4: TRL-4 sign-off and commercial partner LOI.",
        "execution_infrastructure": "GPU cluster for training, 6-DOF motion-capture arena, CNC + 3D-printing for weekly hardware iterations, ARTPARK pilot-customer network.",
        "execution_failure": None,
        "execution_hwsw_integration": None,
        "evidence_files": [{"storage_path": "x/publication.pdf", "name": "publication.pdf"}],
        "evidence_video_url": "https://www.loom.com/share/abc",
        "declaration_truthful": True,
        "declaration_ref_checks": True,
        "declaration_terms": True,
        "declaration_newsletter": False,
    }
```

- [ ] **Step 2: Write the failing test**

Write to `backend/tests/ai_scoring/test_extract_evidence_node.py`:

```python
"""Unit tests for the Pass 1 Evidence Extractor node."""
from __future__ import annotations

from app.services.ai_scoring.nodes.extract_evidence import run as extract_evidence


def test_extract_returns_dict_with_required_keys(fake_llm, sample_application_row):
    expected_evidence = {
        "basic": {"name": "REDACTED", "org": "IIT Madras", "degree": "PhD"},
        "problem": {"describe": sample_application_row["problem_describe"],
                    "defined": "Yes"},
        "solution": {
            "describe": sample_application_row["solution_describe"],
            "core_tech": sample_application_row["solution_core_tech"],
            "contrarian_insight": None,
            "stage": "Pilot-ready product",
        },
        "execution": {
            "will_break": sample_application_row["execution_will_break"],
            "milestone": sample_application_row["execution_milestone"],
            "infrastructure": sample_application_row["execution_infrastructure"],
            "failure": None,
            "hwsw_integration": None,
        },
        "evidence_assets": {
            "file_count": 1,
            "file_names": ["publication.pdf"],
            "video_url_present": True,
        },
        "resume": None,
        "derived": {
            "char_counts": {"problem_describe": 200, "solution_describe": 130,
                            "solution_core_tech": 150, "execution_will_break": 130,
                            "execution_milestone": 200, "execution_infrastructure": 130},
            "word_counts": {"problem_describe": 31, "solution_describe": 22,
                            "solution_core_tech": 25, "execution_will_break": 20,
                            "execution_milestone": 30, "execution_infrastructure": 20},
            "has_10x": True,
            "has_baseline_number": True,
            "has_patent_keyword": True,
            "problem_word_count": 31,
        },
    }
    llm = fake_llm([expected_evidence])
    state = {
        "application_id": "app-uuid-1",
        "application_row": sample_application_row,
        "resume_meta": None,
    }
    result = extract_evidence(state, llm=llm)
    assert "evidence" in result
    ev = result["evidence"]
    for key in ("basic", "problem", "solution", "execution",
                "evidence_assets", "resume", "derived"):
        assert key in ev


def test_extract_redacts_pii(fake_llm, sample_application_row):
    # The fake LLM returns whatever we tell it; here we trust that the
    # prompt instructed it to redact. This test just confirms the node
    # passes the row through and doesn't accidentally leak PII into
    # state's evidence key via post-processing.
    llm = fake_llm([{"basic": {"name": "REDACTED", "org": "IIT Madras", "degree": "PhD"},
                     "problem": {}, "solution": {}, "execution": {},
                     "evidence_assets": {"file_count": 1, "file_names": [], "video_url_present": True},
                     "resume": None, "derived": {}}])
    state = {
        "application_id": "app-uuid-1",
        "application_row": sample_application_row,
        "resume_meta": None,
    }
    result = extract_evidence(state, llm=llm)
    assert result["evidence"]["basic"]["name"] == "REDACTED"
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend
.venv/bin/pytest tests/ai_scoring/test_extract_evidence_node.py -v --no-cov 2>&1 | tail -10
```

Expected: ImportError on `app.services.ai_scoring.nodes.extract_evidence`.

- [ ] **Step 4: Write the implementation**

Write to `backend/app/services/ai_scoring/nodes/extract_evidence.py`:

```python
"""Pass 1 — Evidence Extractor node.

Reads the raw application row + optional resume_meta from graph state,
produces a structured 'evidence' dict that downstream scorers consume.
"""
from __future__ import annotations

import json
from pathlib import Path

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

_PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "extract_evidence.txt"
_PROMPT_TEXT = _PROMPT_PATH.read_text()


def run(state: dict, *, llm: BaseChatModel) -> dict:
    """Pure LangGraph node — returns the state delta {evidence: ...}."""
    row = state["application_row"]
    resume_meta = state.get("resume_meta")

    user_payload = {
        "application_row": row,
        "resume_meta": resume_meta,
    }
    messages = [
        SystemMessage(content=_PROMPT_TEXT),
        HumanMessage(content=json.dumps(user_payload, default=str)),
    ]
    response = llm.invoke(messages)
    text = response.content if hasattr(response, "content") else str(response)
    evidence = json.loads(text)

    return {"evidence": evidence}
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend
.venv/bin/pytest tests/ai_scoring/test_extract_evidence_node.py -v --no-cov 2>&1 | tail -10
```

Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
cd /Users/apple/Desktop/Final_AP_os
git add backend/app/services/ai_scoring/nodes/extract_evidence.py backend/tests/ai_scoring/test_extract_evidence_node.py backend/tests/ai_scoring/conftest.py
git commit -m "feat(ai-scoring): Pass 1 Evidence Extractor node + test fixtures

nodes/extract_evidence.py exports run(state, llm) — a LangGraph
node that reads state['application_row'] + optional state['resume_meta'],
sends them through the Pass 1 prompt, and returns
{evidence: <structured dict>}.

PII redaction (basic_full_name/phone/email) is the LLM's job per the
prompt. The node itself just orchestrates message construction + JSON
parsing.

tests/ai_scoring/conftest.py exports two shared fixtures: fake_llm
(factory wrapping langchain_core's FakeListChatModel) and
sample_application_row (a realistic TIR application). Both are used
by every node test."
```

---

### Task 12: Pass 2 — Signal scorer node factory (TDD)

**Files:**
- Create: `backend/tests/ai_scoring/test_score_signals_node.py`
- Create: `backend/app/services/ai_scoring/nodes/score_signals.py`

- [ ] **Step 1: Write the failing test**

Write to `backend/tests/ai_scoring/test_score_signals_node.py`:

```python
"""Unit tests for the Pass 2 signal scorer factory."""
from __future__ import annotations

from app.services.ai_scoring.nodes.score_signals import make_scorer_node


def test_make_scorer_node_returns_callable(fake_llm):
    llm = fake_llm([{
        "signal": "problem_impact", "score": 8,
        "rationale": "Specific population + quantified pain + clear urgency.",
        "evidence_citations": [{"source": "Q9", "quote": "Defect miss rate ~3%"}],
        "confidence_factors": {
            "data_completeness": 1.0, "evidence_specificity": 0.9,
            "internal_consistency": 0.9, "verifiability": 0.8,
            "answer_granularity": 0.9,
        },
        "flags": [],
    }])
    scorer = make_scorer_node("problem_impact", llm)
    state = {"evidence": {"problem": {"describe": "x", "defined": "Yes"}}}
    result = scorer(state)
    assert "score_problem_impact" in result
    assert result["score_problem_impact"].signal == "problem_impact"
    assert result["score_problem_impact"].score == 8


def test_scorer_writes_to_correct_state_slot(fake_llm):
    """Each of the 5 scorers writes to its own state slot."""
    for signal in ("problem_impact", "completeness", "technical_depth",
                   "behavioural", "commitment"):
        llm = fake_llm([{
            "signal": signal, "score": 5,
            "rationale": "x",
            "evidence_citations": [{"source": "Q1", "quote": "x"}],
            "confidence_factors": {
                "data_completeness": 0.5, "evidence_specificity": 0.5,
                "internal_consistency": 0.5, "verifiability": 0.5,
                "answer_granularity": 0.5,
            },
            "flags": [],
        }])
        scorer = make_scorer_node(signal, llm)
        result = scorer({"evidence": {}})
        slot_name = f"score_{signal}"
        assert slot_name in result
        assert result[slot_name].score == 5
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend
.venv/bin/pytest tests/ai_scoring/test_score_signals_node.py -v --no-cov 2>&1 | tail -10
```

Expected: ImportError on `app.services.ai_scoring.nodes.score_signals`.

- [ ] **Step 3: Write the implementation**

Write to `backend/app/services/ai_scoring/nodes/score_signals.py`:

```python
"""Pass 2 — Signal scorer node factory.

Each of the 5 scorers is identical structurally; only the prompt text
and the output-slot name differ. make_scorer_node(signal, llm) returns
a callable that LangGraph can attach to the graph.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Callable

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

from ..state import SignalScore

_PROMPTS_DIR = Path(__file__).resolve().parent.parent / "prompts" / "signals"


def _load_prompt(signal: str) -> str:
    return (_PROMPTS_DIR / f"{signal}.txt").read_text()


def make_scorer_node(signal: str, llm: BaseChatModel) -> Callable[[dict], dict]:
    """Build a LangGraph node that scores one signal.

    The returned callable reads state['evidence'] and writes
    state['score_<signal>'] = SignalScore(...).
    """
    prompt = _load_prompt(signal)
    slot_name = f"score_{signal}"

    def node(state: dict) -> dict:
        messages = [
            SystemMessage(content=prompt),
            HumanMessage(content=json.dumps({"evidence": state["evidence"]}, default=str)),
        ]
        response = llm.invoke(messages)
        text = response.content if hasattr(response, "content") else str(response)
        score_obj = SignalScore.model_validate_json(text)
        return {slot_name: score_obj}

    node.__name__ = f"score_{signal}_node"
    return node
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend
.venv/bin/pytest tests/ai_scoring/test_score_signals_node.py -v --no-cov 2>&1 | tail -10
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/apple/Desktop/Final_AP_os
git add backend/app/services/ai_scoring/nodes/score_signals.py backend/tests/ai_scoring/test_score_signals_node.py
git commit -m "feat(ai-scoring): Pass 2 signal scorer node factory

nodes/score_signals.py exports make_scorer_node(signal, llm) which
returns a LangGraph node callable for one of the 5 signals. The
graph builder instantiates 5 of these (one per signal) and fans
them out via Send.

Each node loads its own prompt from prompts/signals/<signal>.txt,
calls the LLM, validates the response against the SignalScore
Pydantic model, and writes to state['score_<signal>'].

Two TDD tests: round-trip a single scorer, and confirm all 5
scorer types write to their own state slots."
```

---

### Task 13: Pass 3 LangGraph wrapper — apply_caps + compute_confidence nodes

**Files:**
- Create: `backend/app/services/ai_scoring/nodes/apply_caps.py`
- Create: `backend/app/services/ai_scoring/nodes/compute_confidence.py`
- Create: `backend/tests/ai_scoring/test_pass3_nodes.py`

- [ ] **Step 1: Write the failing test**

Write to `backend/tests/ai_scoring/test_pass3_nodes.py`:

```python
"""Tests for Pass 3 LangGraph node wrappers over caps.py + compute.py."""
from __future__ import annotations

from app.services.ai_scoring.nodes.apply_caps import run as apply_caps_node
from app.services.ai_scoring.nodes.compute_confidence import run as compute_node
from app.services.ai_scoring.state import (
    Citation, ConfidenceFactors, SignalScore,
)


def _sig(name, score=8):
    return SignalScore(
        signal=name, score=score, rationale="x",
        evidence_citations=[Citation(source="Q1", quote="x")],
        confidence_factors=ConfidenceFactors(
            data_completeness=0.9, evidence_specificity=0.9,
            internal_consistency=0.9, verifiability=0.9, answer_granularity=0.9,
        ),
        flags=[],
    )


def test_apply_caps_node_returns_capped_scores_and_events(sample_application_row):
    """Wrapping caps.apply_all_caps as a LangGraph node."""
    state = {
        "application_row": {**sample_application_row,
                            "basic_incubator_association": "Yes",
                            "basic_incubator_details": "Currently incubated at XYZ."},
        "resume_meta": None,
        "score_problem_impact": _sig("problem_impact"),
        "score_completeness": _sig("completeness"),
        "score_technical_depth": _sig("technical_depth"),
        "score_behavioural": _sig("behavioural"),
        "score_commitment": _sig("commitment"),
    }
    result = apply_caps_node(state)
    # C1 should fire → commitment capped at 3
    assert result["score_commitment"].score == 3
    assert "caps_applied" in result
    assert len(result["caps_applied"]) >= 1


def test_compute_confidence_node_returns_composite_and_strength(sample_application_row):
    state = {
        "score_problem_impact": _sig("problem_impact", 8),
        "score_completeness": _sig("completeness", 8),
        "score_technical_depth": _sig("technical_depth", 8),
        "score_behavioural": _sig("behavioural", 8),    # 0% weight
        "score_commitment": _sig("commitment", 8),
    }
    result = compute_node(state)
    assert result["composite_percentage"] == 80.0
    assert result["strength_label"] == "EXCEPTIONAL"
    assert 0.0 <= result["confidence_overall"] <= 1.0
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend
.venv/bin/pytest tests/ai_scoring/test_pass3_nodes.py -v --no-cov 2>&1 | tail -10
```

Expected: ImportError on `app.services.ai_scoring.nodes.apply_caps` and `nodes.compute_confidence`.

- [ ] **Step 3: Write `nodes/apply_caps.py`**

Write to `backend/app/services/ai_scoring/nodes/apply_caps.py`:

```python
"""Pass 3a — LangGraph node wrapping caps.apply_all_caps."""
from __future__ import annotations

from ..caps import apply_all_caps


_SIGNAL_NAMES = ("problem_impact", "completeness", "technical_depth",
                 "behavioural", "commitment")


def run(state: dict) -> dict:
    """Read pre-cap scores from state, run all 7 cap rules, write back."""
    pre_cap = {name: state[f"score_{name}"] for name in _SIGNAL_NAMES}
    capped, events = apply_all_caps(
        application_row=state["application_row"],
        scores=pre_cap,
        resume_meta=state.get("resume_meta"),
    )
    delta = {f"score_{name}": capped[name] for name in _SIGNAL_NAMES}
    delta["caps_applied"] = events
    return delta
```

- [ ] **Step 4: Write `nodes/compute_confidence.py`**

Write to `backend/app/services/ai_scoring/nodes/compute_confidence.py`:

```python
"""Pass 3b — LangGraph node wrapping compute.composite + compute.strength_label."""
from __future__ import annotations

from ..compute import (
    aggregate_confidence, composite_percentage, strength_label,
)


_SIGNAL_NAMES = ("problem_impact", "completeness", "technical_depth",
                 "behavioural", "commitment")


def run(state: dict) -> dict:
    scores = {name: state[f"score_{name}"] for name in _SIGNAL_NAMES}
    pct = composite_percentage(scores)
    return {
        "composite_percentage": pct,
        "strength_label": strength_label(pct),
        "confidence_overall": aggregate_confidence(scores),
    }
```

- [ ] **Step 5: Run tests to confirm they pass**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend
.venv/bin/pytest tests/ai_scoring/test_pass3_nodes.py -v --no-cov 2>&1 | tail -10
```

Expected: 2 passed.

- [ ] **Step 6: Commit**

```bash
cd /Users/apple/Desktop/Final_AP_os
git add backend/app/services/ai_scoring/nodes/apply_caps.py backend/app/services/ai_scoring/nodes/compute_confidence.py backend/tests/ai_scoring/test_pass3_nodes.py
git commit -m "feat(ai-scoring): Pass 3 LangGraph node wrappers

Two thin LangGraph nodes wrapping the pure-function modules:

  nodes/apply_caps.py — reads pre-cap scores from state, calls
    caps.apply_all_caps, writes capped scores + caps_applied
    audit list back to state.

  nodes/compute_confidence.py — reads scores from state, calls
    compute.composite_percentage / strength_label /
    aggregate_confidence, writes the 3 derived fields back.

Two TDD tests: a C1-triggering input that caps commitment to 3, and
an all-8s input that hits composite 80.0 / strength EXCEPTIONAL."
```

---

### Task 14: Pass 4 — Synthesize node (TDD with fake LLM)

**Files:**
- Create: `backend/tests/ai_scoring/test_synthesize_node.py`
- Create: `backend/app/services/ai_scoring/nodes/synthesize.py`

- [ ] **Step 1: Write the failing test**

Write to `backend/tests/ai_scoring/test_synthesize_node.py`:

```python
"""Tests for Pass 4 synthesize node."""
from __future__ import annotations

from app.services.ai_scoring.nodes.synthesize import run as synthesize_node
from app.services.ai_scoring.state import (
    Citation, ConfidenceFactors, SignalScore,
)


def _sig(name, score=8):
    return SignalScore(
        signal=name, score=score, rationale="x",
        evidence_citations=[Citation(source="Q1", quote="x")],
        confidence_factors=ConfidenceFactors(
            data_completeness=0.9, evidence_specificity=0.9,
            internal_consistency=0.9, verifiability=0.9, answer_granularity=0.9,
        ),
        flags=[],
    )


def _state():
    return {
        "score_problem_impact": _sig("problem_impact", 8),
        "score_completeness": _sig("completeness", 8),
        "score_technical_depth": _sig("technical_depth", 8),
        "score_behavioural": _sig("behavioural", 6),
        "score_commitment": _sig("commitment", 7),
        "caps_applied": [],
        "composite_percentage": 75.5,
        "strength_label": "STRONG",
        "confidence_overall": 0.85,
        "tsp_context": None,
    }


def test_synthesize_returns_round1_summary(fake_llm):
    llm = fake_llm([{
        "verdict": "This is a STRONG application for the TIR Track.",
        "top_strength": "Technical specificity at IIT Madras backed by Patent Granted.",
        "top_concern": "Q15 hurdles framed as research questions risks scope drift.",
        "program_fit": "Q17 ask for 6-DOF rig matches ARTPARK motion-capture arena.",
        "recommendation": "ACCEPT within 14 days pending Patent Office confirmation.",
    }])
    result = synthesize_node(_state(), llm=llm)
    assert "summary_round_1" in result
    s = result["summary_round_1"]
    assert "STRONG" in s.verdict
    assert s.recommendation.startswith("ACCEPT")


def test_synthesize_with_tsp_context_raises(fake_llm):
    """Round 2 path not implemented in v1 — must raise NotImplementedError."""
    llm = fake_llm([{}])
    state = _state()
    state["tsp_context"] = {"composite_score": 60}
    import pytest
    with pytest.raises(NotImplementedError):
        synthesize_node(state, llm=llm)
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend
.venv/bin/pytest tests/ai_scoring/test_synthesize_node.py -v --no-cov 2>&1 | tail -10
```

Expected: ImportError on `app.services.ai_scoring.nodes.synthesize`.

- [ ] **Step 3: Write the implementation**

Write to `backend/app/services/ai_scoring/nodes/synthesize.py`:

```python
"""Pass 4 — Synthesize node.

Round 1: reads scores + composite + caps + confidence, calls LLM with
the round-1 prompt, returns a Round1Summary in state['summary_round_1'].

Round 2: NOT IMPLEMENTED in v1. If state['tsp_context'] is non-None,
raises NotImplementedError. The seam is in place for future TSP work.
"""
from __future__ import annotations

import json
from pathlib import Path

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

from ..state import Round1Summary

_BASE = Path(__file__).resolve().parent.parent
_PROMPT_TEXT = (_BASE / "prompts" / "synthesize_round_1.txt").read_text()
_ARTPARK_ASSETS = (_BASE / "artpark_assets.md").read_text()


def run(state: dict, *, llm: BaseChatModel) -> dict:
    if state.get("tsp_context"):
        raise NotImplementedError(
            "Round 2 (TSP) synthesis is not implemented in v1; "
            "tsp_context must be None."
        )

    payload = {
        "scores": {
            name: state[f"score_{name}"].model_dump()
            for name in ("problem_impact", "completeness", "technical_depth",
                         "behavioural", "commitment")
        },
        "composite_percentage": state["composite_percentage"],
        "strength_label": state["strength_label"],
        "confidence_overall": state["confidence_overall"],
        "caps_applied": [e.model_dump() for e in state.get("caps_applied", [])],
        "artpark_assets": _ARTPARK_ASSETS,
    }
    messages = [
        SystemMessage(content=_PROMPT_TEXT),
        HumanMessage(content=json.dumps(payload, default=str)),
    ]
    response = llm.invoke(messages)
    text = response.content if hasattr(response, "content") else str(response)
    summary = Round1Summary.model_validate_json(text)
    return {"summary_round_1": summary}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend
.venv/bin/pytest tests/ai_scoring/test_synthesize_node.py -v --no-cov 2>&1 | tail -10
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/apple/Desktop/Final_AP_os
git add backend/app/services/ai_scoring/nodes/synthesize.py backend/tests/ai_scoring/test_synthesize_node.py
git commit -m "feat(ai-scoring): Pass 4 synthesize node (round 1 only)

nodes/synthesize.py exports run(state, llm). Reads the post-cap
scores + composite + strength label + caps_applied audit + the
ARTPARK assets reference doc, sends them through the round-1
synthesis prompt, and writes Round1Summary into state.

Round 2 path is a NotImplementedError raise — the seam is in place
(checks state['tsp_context']) but v1 never populates it.

Two TDD tests: happy-path round-1 generation, and round-2 raise."
```

---

### Task 15: Graph assembly + quality gate edge (TDD)

**Files:**
- Create: `backend/tests/ai_scoring/test_graph_e2e.py`
- Create: `backend/app/services/ai_scoring/graph.py`

- [ ] **Step 1: Write the failing test**

Write to `backend/tests/ai_scoring/test_graph_e2e.py`:

```python
"""End-to-end LangGraph state-machine test with fake LLM."""
from __future__ import annotations

import json

from langchain_core.language_models.fake_chat_models import FakeListChatModel

from app.services.ai_scoring.graph import build_graph


def _evidence_response(sample_row):
    return {
        "basic": {"name": "REDACTED", "org": "IIT Madras", "degree": "PhD"},
        "problem": {"describe": sample_row["problem_describe"],
                    "defined": "Yes"},
        "solution": {
            "describe": sample_row["solution_describe"],
            "core_tech": sample_row["solution_core_tech"],
            "contrarian_insight": None,
            "stage": "Pilot-ready product",
        },
        "execution": {
            "will_break": sample_row["execution_will_break"],
            "milestone": sample_row["execution_milestone"],
            "infrastructure": sample_row["execution_infrastructure"],
            "failure": None,
            "hwsw_integration": None,
        },
        "evidence_assets": {"file_count": 1, "file_names": ["publication.pdf"],
                            "video_url_present": True},
        "resume": None,
        "derived": {
            "has_10x": True, "has_baseline_number": True,
            "has_patent_keyword": True, "problem_word_count": 31,
        },
    }


def _signal_response(signal):
    return {
        "signal": signal, "score": 8,
        "rationale": "Specific, evidence-anchored.",
        "evidence_citations": [{"source": "Q1", "quote": "x"}],
        "confidence_factors": {
            "data_completeness": 0.9, "evidence_specificity": 0.9,
            "internal_consistency": 0.9, "verifiability": 0.9,
            "answer_granularity": 0.9,
        },
        "flags": [],
    }


def _summary_response():
    return {
        "verdict": "This is a STRONG application for the TIR Track.",
        "top_strength": "Technical specificity at IIT Madras with Patent Granted IP + 10x faster inspection ties Q11 to Q12 cleanly.",
        "top_concern": "Q15 hurdles framed as research questions, not engineering challenges — risks scope drift.",
        "program_fit": "Q17 ask for GPU cluster matches ARTPARK's compute infrastructure and the pilot-customer network across manufacturing.",
        "recommendation": "ACCEPT within 14 days pending Patent Office confirmation.",
    }


def test_graph_end_to_end_happy_path(sample_application_row):
    """Full graph traversal — Pass 1 → 5 scorers → Pass 3 → Pass 4 → done."""
    # Order of LLM calls in the graph (single LLM instance scripted):
    #   1× evidence extractor
    #   5× signal scorers (order matters — graph fans out alphabetically
    #      by signal name in our implementation)
    #   1× synthesize
    scripted = [
        json.dumps(_evidence_response(sample_application_row)),
        json.dumps(_signal_response("behavioural")),
        json.dumps(_signal_response("commitment")),
        json.dumps(_signal_response("completeness")),
        json.dumps(_signal_response("problem_impact")),
        json.dumps(_signal_response("technical_depth")),
        json.dumps(_summary_response()),
    ]
    llm = FakeListChatModel(responses=scripted)

    graph = build_graph(llm=llm)
    initial_state = {
        "application_id": "app-uuid-1",
        "track": "tir",
        "application_row": sample_application_row,
        "resume_meta": None,
        "tsp_context": None,
        "qg_retries": 0,
    }
    final = graph.invoke(initial_state)

    # Pass 1 ran
    assert "evidence" in final
    # All 5 scorers ran
    for sig in ("problem_impact", "completeness", "technical_depth",
                "behavioural", "commitment"):
        assert final[f"score_{sig}"] is not None
    # Pass 3 computed derivatives
    assert "composite_percentage" in final
    assert "strength_label" in final
    # Pass 4 synthesized
    assert final["summary_round_1"] is not None
    assert "STRONG" in final["summary_round_1"].verdict
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend
.venv/bin/pytest tests/ai_scoring/test_graph_e2e.py -v --no-cov 2>&1 | tail -10
```

Expected: ImportError on `app.services.ai_scoring.graph`.

- [ ] **Step 3: Write the implementation**

Write to `backend/app/services/ai_scoring/graph.py`:

```python
"""LangGraph state-machine assembly.

build_graph(llm) returns a compiled LangGraph App. Each pass is its own
node; the 5 Pass-2 scorers fan out in parallel via standard LangGraph
fan-in (each writes to a unique state slot, so no Send-based reducer
is needed — LangGraph's default merge handles it).
"""
from __future__ import annotations

from langchain_core.language_models import BaseChatModel
from langgraph.graph import END, START, StateGraph

from .nodes.apply_caps import run as apply_caps_run
from .nodes.compute_confidence import run as compute_conf_run
from .nodes.extract_evidence import run as extract_evidence_run
from .nodes.quality_gate import evaluate_summary
from .nodes.score_signals import make_scorer_node
from .nodes.synthesize import run as synthesize_run


MAX_QG_RETRIES = 3
_SIGNAL_NAMES_SORTED = (
    "behavioural", "commitment", "completeness",
    "problem_impact", "technical_depth",
)  # alphabetical so the fake-LLM test can script in known order


def build_graph(*, llm: BaseChatModel):
    g = StateGraph(dict)

    # ─── Nodes ──────────────────────────────────────────────────
    g.add_node("extract_evidence", lambda s: extract_evidence_run(s, llm=llm))

    for sig in _SIGNAL_NAMES_SORTED:
        g.add_node(f"score_{sig}", make_scorer_node(sig, llm))

    g.add_node("apply_caps", apply_caps_run)
    g.add_node("compute_confidence", compute_conf_run)
    g.add_node("synthesize", lambda s: synthesize_run(s, llm=llm))
    g.add_node("quality_gate_check", _qg_node)

    # ─── Edges ──────────────────────────────────────────────────
    g.add_edge(START, "extract_evidence")
    # Fan out: evidence → 5 scorers
    for sig in _SIGNAL_NAMES_SORTED:
        g.add_edge("extract_evidence", f"score_{sig}")
    # Fan in: all scorers → apply_caps. LangGraph waits for all parents.
    for sig in _SIGNAL_NAMES_SORTED:
        g.add_edge(f"score_{sig}", "apply_caps")
    g.add_edge("apply_caps", "compute_confidence")
    g.add_edge("compute_confidence", "synthesize")
    g.add_edge("synthesize", "quality_gate_check")
    g.add_conditional_edges("quality_gate_check", _qg_route, {
        "done": END,
        "retry": "synthesize",
    })

    return g.compile()


def _qg_node(state: dict) -> dict:
    """Run the quality gate; update retry counter + needs-human-review flag."""
    report = evaluate_summary(state["summary_round_1"])
    retries = state.get("qg_retries", 0)
    delta = {
        "qg_last_failures": report["failures"],
    }
    if report["passed"]:
        delta["qg_needs_human_review"] = False
        return delta
    # Failed
    new_retries = retries + 1
    delta["qg_retries"] = new_retries
    if new_retries >= MAX_QG_RETRIES:
        delta["qg_needs_human_review"] = True
    return delta


def _qg_route(state: dict) -> str:
    if not state.get("qg_last_failures"):
        return "done"
    if state.get("qg_needs_human_review"):
        return "done"
    return "retry"
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend
.venv/bin/pytest tests/ai_scoring/test_graph_e2e.py -v --no-cov 2>&1 | tail -10
```

Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/apple/Desktop/Final_AP_os
git add backend/app/services/ai_scoring/graph.py backend/tests/ai_scoring/test_graph_e2e.py
git commit -m "feat(ai-scoring): LangGraph state-machine assembly

graph.py exports build_graph(llm) which returns a compiled LangGraph
App. Edges wire all 4 passes + the quality gate per spec §2:

  START → extract_evidence
  extract_evidence → 5 scorers (fan-out)
  5 scorers → apply_caps (fan-in via LangGraph's default merge)
  apply_caps → compute_confidence → synthesize → quality_gate_check
  quality_gate_check → END (on pass) or → synthesize (on regenerable fail)

Quality gate caps retries at 3 via state.qg_retries, then sets
qg_needs_human_review=True and routes to END anyway (last attempt
persists with the flag).

One e2e TDD test scripts a 7-call fake LLM sequence (1 evidence + 5
scorers + 1 synthesize) and verifies the final state has every
populated slot."
```

---

### Task 16: Persistence — write final state to ai_screening row (TDD)

**Files:**
- Create: `backend/tests/ai_scoring/test_persistence.py`
- Create: `backend/app/services/ai_scoring/persistence.py`

- [ ] **Step 1: Write the failing test**

Write to `backend/tests/ai_scoring/test_persistence.py`:

```python
"""Tests for persistence — writing ScoringState to ai_screening row."""
from __future__ import annotations

from app.services.ai_scoring.persistence import persist_score
from app.services.ai_scoring.state import (
    Citation, ConfidenceFactors, Round1Summary, SignalScore,
)


class _FakeClient:
    """Minimal supabase client stub."""
    def __init__(self):
        self.last_upsert_payload = None

    def table(self, name):
        assert name == "ai_screening"
        return self

    def upsert(self, payload, on_conflict=None):
        self.last_upsert_payload = payload
        return self

    def execute(self):
        return type("R", (), {"data": [self.last_upsert_payload]})()


def _sig(name, score=8):
    return SignalScore(
        signal=name, score=score, rationale="x",
        evidence_citations=[Citation(source="Q1", quote="x")],
        confidence_factors=ConfidenceFactors(
            data_completeness=0.9, evidence_specificity=0.9,
            internal_consistency=0.9, verifiability=0.9, answer_granularity=0.9,
        ),
        flags=[],
    )


def _state():
    return {
        "application_id": "app-uuid-1",
        "track": "tir",
        "score_problem_impact": _sig("problem_impact", 8),
        "score_completeness": _sig("completeness", 7),
        "score_technical_depth": _sig("technical_depth", 9),
        "score_behavioural": _sig("behavioural", 6),
        "score_commitment": _sig("commitment", 7),
        "caps_applied": [],
        "composite_percentage": 75.5,
        "strength_label": "STRONG",
        "confidence_overall": 0.85,
        "summary_round_1": Round1Summary(
            verdict="This is a STRONG application for the TIR Track.",
            top_strength="x", top_concern="x", program_fit="x",
            recommendation="ACCEPT within 14 days.",
        ),
        "model": "gemini-2.5-flash",
        "qg_needs_human_review": False,
    }


def test_persist_writes_to_ai_screening():
    client = _FakeClient()
    persist_score(client, _state())
    payload = client.last_upsert_payload
    assert payload["application_id"] == "app-uuid-1"
    assert payload["application_track"] == "tir"
    assert payload["score_problem"] == 8
    assert payload["score_completeness"] == 7
    assert payload["score_tech"] == 9
    assert payload["score_founders"] == 6   # Behavioural → score_founders
    assert payload["score_commitment"] == 7
    assert payload["score_overall"] == 75.5
    assert payload["model"] == "gemini-2.5-flash"
    assert payload["error"] is None


def test_persist_includes_caps_in_flags():
    from app.services.ai_scoring.state import CapEvent
    from datetime import datetime, timezone
    s = _state()
    s["caps_applied"] = [
        CapEvent(rule_id="C2", triggered_at=datetime.now(timezone.utc),
                 signal_capped=["technical_depth"], cap_value=4,
                 evidence_snippet="x", flag="c2_deployed_no_evidence"),
    ]
    client = _FakeClient()
    persist_score(client, s)
    flags = client.last_upsert_payload["flags"]
    assert any(c["rule_id"] == "C2" for c in flags["cap_events"])
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend
.venv/bin/pytest tests/ai_scoring/test_persistence.py -v --no-cov 2>&1 | tail -10
```

Expected: ImportError on `app.services.ai_scoring.persistence`.

- [ ] **Step 3: Write the implementation**

Write to `backend/app/services/ai_scoring/persistence.py`:

```python
"""Persist ScoringState to ai_screening row.

Maps the in-memory signal names onto the existing ai_screening columns:
  problem_impact   → score_problem
  completeness     → score_completeness   (renamed from score_solution in 016)
  technical_depth  → score_tech
  behavioural      → score_founders       (existing legacy column name)
  commitment       → score_commitment
  composite (×100) → score_overall
"""
from __future__ import annotations

import json
from datetime import datetime, timezone


_SIGNAL_TO_COLUMN = {
    "problem_impact":  "score_problem",
    "completeness":    "score_completeness",
    "technical_depth": "score_tech",
    "behavioural":     "score_founders",
    "commitment":      "score_commitment",
}


def persist_score(client, state: dict) -> None:
    """Upsert one ai_screening row from the final graph state.

    Uses on_conflict=application_id,application_track so a re-run
    replaces the prior row (UNIQUE(application_id, application_track)
    per migration 014).
    """
    payload: dict = {
        "application_id": state["application_id"],
        "application_track": state["track"],
    }

    # Per-signal scores
    for signal, column in _SIGNAL_TO_COLUMN.items():
        slot = f"score_{signal}"
        if state.get(slot) is not None:
            payload[column] = state[slot].score

    payload["score_overall"] = state.get("composite_percentage")
    payload["confidence"]    = state.get("confidence_overall")

    # Summary as JSON-encoded text
    if state.get("summary_round_1") is not None:
        payload["summary"] = json.dumps(state["summary_round_1"].model_dump())

    # Flags JSONB: confidence factors + cap events + needs-human-review
    cap_events = state.get("caps_applied", [])
    payload["flags"] = {
        "cap_events": [e.model_dump(mode="json") for e in cap_events],
        "needs_human_review": bool(state.get("qg_needs_human_review", False)),
        "qg_last_failures": state.get("qg_last_failures", []),
    }

    payload["model"]   = state.get("model", "unknown")
    payload["ran_at"]  = datetime.now(timezone.utc).isoformat()
    payload["error"]   = None

    client.table("ai_screening").upsert(
        payload,
        on_conflict="application_id,application_track",
    ).execute()
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend
.venv/bin/pytest tests/ai_scoring/test_persistence.py -v --no-cov 2>&1 | tail -10
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/apple/Desktop/Final_AP_os
git add backend/app/services/ai_scoring/persistence.py backend/tests/ai_scoring/test_persistence.py
git commit -m "feat(ai-scoring): persistence — write final state to ai_screening

persistence.py exports persist_score(client, state) which upserts
the final LangGraph state into one ai_screening row.

Signal → column mapping:
  problem_impact   → score_problem
  completeness     → score_completeness (renamed from score_solution
                                          in migration 016)
  technical_depth  → score_tech
  behavioural      → score_founders     (legacy column name retained)
  commitment       → score_commitment
  composite × 100  → score_overall
  confidence_overall → confidence (numeric)
  summary_round_1  → summary (JSON-encoded text)
  cap_events + needs_human_review → flags (JSONB)

Two TDD tests with a FakeClient verify column mapping + cap-events
landing in the flags JSONB."
```

---

### Task 17: Runner — top-level score_application entry point (TDD)

**Files:**
- Create: `backend/tests/ai_scoring/test_runner.py`
- Create: `backend/app/services/ai_scoring/runner.py`

- [ ] **Step 1: Write the failing test**

Write to `backend/tests/ai_scoring/test_runner.py`:

```python
"""Tests for the top-level runner.score_application() function."""
from __future__ import annotations

import json
from unittest.mock import MagicMock

from langchain_core.language_models.fake_chat_models import FakeListChatModel

from app.services.ai_scoring.runner import score_application


def _scripted_llm(sample_row):
    return FakeListChatModel(responses=[
        # 1× evidence extractor
        json.dumps({
            "basic": {"name": "REDACTED", "org": "IIT", "degree": "PhD"},
            "problem": {"describe": "x", "defined": "Yes"},
            "solution": {"describe": "x", "core_tech": "x",
                         "contrarian_insight": None, "stage": "Pilot-ready product"},
            "execution": {"will_break": "x", "milestone": "x",
                          "infrastructure": "x", "failure": None,
                          "hwsw_integration": None},
            "evidence_assets": {"file_count": 1, "file_names": ["a.pdf"],
                                "video_url_present": True},
            "resume": None,
            "derived": {"has_10x": True, "has_baseline_number": True,
                        "has_patent_keyword": False, "problem_word_count": 30},
        }),
        # 5× signal scorers (alphabetical)
        *[json.dumps({
            "signal": sig, "score": 7,
            "rationale": "x",
            "evidence_citations": [{"source": "Q1", "quote": "x"}],
            "confidence_factors": {
                "data_completeness": 0.9, "evidence_specificity": 0.9,
                "internal_consistency": 0.9, "verifiability": 0.9,
                "answer_granularity": 0.9,
            },
            "flags": [],
        }) for sig in ("behavioural", "commitment", "completeness",
                       "problem_impact", "technical_depth")],
        # 1× synthesize
        json.dumps({
            "verdict": "This is a STRONG application for the TIR Track.",
            "top_strength": "Specific tech at IIT with 10x improvement.",
            "top_concern": "Q15 hurdles framed loosely. ARTPARK match unclear.",
            "program_fit": "ARTPARK GPU cluster matches Q17 ask.",
            "recommendation": "ACCEPT within 14 days.",
        }),
    ])


class _FakeSupabase:
    def __init__(self, application_row):
        self.application_row = application_row
        self.upsert_calls = []
    def table(self, name):
        self._last = name
        return self
    def select(self, *_):
        return self
    def eq(self, *_, **__):
        return self
    def limit(self, *_):
        return self
    def execute(self):
        if self._last == "tir_applications":
            return type("R", (), {"data": [self.application_row]})()
        return type("R", (), {"data": []})()
    def upsert(self, payload, on_conflict=None):
        self.upsert_calls.append(payload)
        return self


def test_score_application_runs_end_to_end(sample_application_row):
    client = _FakeSupabase(sample_application_row)
    llm = _scripted_llm(sample_application_row)
    result = score_application(
        application_id="app-uuid-1", track="tir",
        supabase=client, llm=llm,
    )
    assert result["composite_percentage"] > 0
    assert result["summary_round_1"] is not None
    # Persistence ran
    assert len(client.upsert_calls) == 1
    assert client.upsert_calls[0]["application_id"] == "app-uuid-1"


def test_score_application_404s_unknown_id():
    client = _FakeSupabase(None)
    # Override execute() to return empty
    def _empty_execute():
        return type("R", (), {"data": []})()
    client.execute = _empty_execute
    import pytest
    with pytest.raises(ValueError, match="not found"):
        score_application(
            application_id="ghost-uuid", track="tir",
            supabase=client, llm=FakeListChatModel(responses=[]),
        )
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend
.venv/bin/pytest tests/ai_scoring/test_runner.py -v --no-cov 2>&1 | tail -10
```

Expected: ImportError on `app.services.ai_scoring.runner`.

- [ ] **Step 3: Write the implementation**

Write to `backend/app/services/ai_scoring/runner.py`:

```python
"""Top-level entry point — score one application end-to-end.

Wires the LangGraph from .graph with the prod LangChain model + Supabase
client. Called from the admin endpoint in routers/ai_screening.py.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

from .graph import build_graph
from .persistence import persist_score

log = logging.getLogger(__name__)


def _load_application_row(supabase, application_id: str, track: str) -> dict:
    table = f"{track}_applications"
    res = (
        supabase.table(table)
        .select("*")
        .eq("id", application_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    if not rows:
        raise ValueError(
            f"Application {application_id!r} not found in {table}"
        )
    return rows[0]


def _load_resume_meta(supabase, user_id: str | None, track: str) -> dict | None:
    if not user_id:
        return None
    table = f"{track}_resume_uploads"
    try:
        res = (
            supabase.table(table)
            .select("parsed_data, parse_status")
            .eq("user_id", user_id)
            .eq("parse_status", "completed")
            .limit(1)
            .execute()
        )
    except Exception:
        return None
    rows = res.data or []
    return rows[0] if rows else None


def _build_llm():
    """Real production LLM — only called when no fake is injected.

    Imported lazily so the test path that injects a fake doesn't need
    GOOGLE_API_KEY in the environment.
    """
    from langchain.chat_models import init_chat_model
    provider = os.environ.get("AI_SCORING_PROVIDER", "google_genai")
    model = os.environ.get("AI_SCORING_MODEL", "gemini-2.5-flash")
    return init_chat_model(model, model_provider=provider, temperature=0)


def score_application(
    *,
    application_id: str,
    track: str = "tir",
    supabase,
    llm=None,
) -> dict:
    """Run the full scoring graph + persist result.

    If `llm` is None, builds a real LangChain model from env vars.
    """
    if track != "tir":
        raise ValueError(f"v1 only supports TIR; got {track!r}")

    application_row = _load_application_row(supabase, application_id, track)
    resume_meta = _load_resume_meta(supabase, application_row.get("user_id"), track)

    if llm is None:
        llm = _build_llm()

    graph = build_graph(llm=llm)
    initial_state = {
        "application_id": application_id,
        "track": track,
        "application_row": application_row,
        "resume_meta": resume_meta,
        "tsp_context": None,
        "qg_retries": 0,
        "model": os.environ.get("AI_SCORING_MODEL", "gemini-2.5-flash"),
        "started_at": datetime.now(timezone.utc),
    }

    final_state = graph.invoke(initial_state)

    persist_score(supabase, final_state)
    log.info(
        "Scored application_id=%s composite=%s strength=%s caps=%d retries=%d",
        application_id, final_state.get("composite_percentage"),
        final_state.get("strength_label"),
        len(final_state.get("caps_applied", [])),
        final_state.get("qg_retries", 0),
    )
    return final_state
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend
.venv/bin/pytest tests/ai_scoring/test_runner.py -v --no-cov 2>&1 | tail -10
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
cd /Users/apple/Desktop/Final_AP_os
git add backend/app/services/ai_scoring/runner.py backend/tests/ai_scoring/test_runner.py
git commit -m "feat(ai-scoring): score_application end-to-end runner

runner.score_application(application_id, track, supabase, llm=None) is
the top-level entrypoint. Loads the application row + resume meta,
builds the LangGraph (with real or injected LLM), invokes it, and
persists the final state.

Real LLM construction is lazy (only imported when no fake is injected)
so the test path that passes a FakeListChatModel doesn't need
GOOGLE_API_KEY in env.

Two TDD tests with a FakeSupabase + scripted FakeListChatModel verify
the happy path + the 404 error path."
```

---

### Task 18: Admin endpoint — POST /admin/ai-screening/run

**Files:**
- Create: `backend/app/routers/ai_screening.py`
- Modify: `backend/app/main.py` (register the router)

- [ ] **Step 1: Locate main.py and existing router registration pattern**

```bash
cd /Users/apple/Desktop/Final_AP_os
grep -n "include_router\|app = FastAPI" backend/app/main.py | head -10
```

Note the existing pattern (probably `app.include_router(<name>.router)` for several existing routers).

- [ ] **Step 2: Create the router file**

Write to `backend/app/routers/ai_screening.py`:

```python
"""Admin endpoint to run AI scoring against one or more applications.

POST /admin/ai-screening/run
  Body (any one of):
    {"application_id": "<uuid>", "track": "tir"}   — single app
    {"limit": 50, "track": "tir"}                  — first N apps
    {"all": true, "track": "tir"}                  — every app

Requires capability `manage_users` (admin role; conservative gate while
we evaluate the pipeline's behaviour. Loosen to `view_app_detail` once
we trust it for general leadership re-runs.)
"""
from __future__ import annotations

import logging
import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..rbac import require_capability
from ..services.ai_scoring.runner import score_application
from ..supabase_client import get_admin_client

log = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/ai-screening", tags=["ai-screening"])


class RunRequest(BaseModel):
    application_id: str | None = None
    limit: int | None = Field(default=None, ge=1, le=500)
    all: bool = False
    track: str = Field(default="tir", pattern="^(tir|sip)$")


@router.post(
    "/run",
    dependencies=[Depends(require_capability("manage_users"))],
)
async def run_ai_screening(body: RunRequest) -> dict[str, Any]:
    if os.environ.get("AI_SCORING_ENABLED", "false").lower() != "true":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "ai_scoring_disabled",
                    "message": "AI_SCORING_ENABLED env var is not set to 'true'."},
        )
    if body.track != "tir":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "track_unsupported",
                    "message": "v1 only supports the TIR track."},
        )

    sb = get_admin_client()

    # Resolve target ID list
    if body.application_id:
        target_ids = [body.application_id]
    elif body.all or body.limit:
        q = sb.table(f"{body.track}_applications").select("id")
        if body.limit:
            q = q.limit(body.limit)
        res = q.execute()
        target_ids = [r["id"] for r in (res.data or [])]
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "missing_target",
                    "message": "Provide one of: application_id, limit, or all=true."},
        )

    results: list[dict] = []
    for app_id in target_ids:
        try:
            final = score_application(
                application_id=app_id, track=body.track, supabase=sb,
            )
            results.append({
                "application_id": app_id,
                "ok": True,
                "composite_percentage": final.get("composite_percentage"),
                "strength_label": final.get("strength_label"),
                "needs_human_review": bool(final.get("qg_needs_human_review", False)),
            })
        except Exception as exc:
            log.exception("Scoring failed for %s", app_id)
            results.append({
                "application_id": app_id, "ok": False,
                "error": str(exc)[:200],
            })

    return {"track": body.track, "count": len(results), "results": results}
```

- [ ] **Step 3: Register the router in `main.py`**

In `backend/app/main.py`, add the import + `include_router` call alongside the existing routers (the exact line follows the pattern already in the file — look for other `app.include_router(...)` lines and add this one with them):

```python
from .routers import ai_screening as ai_screening_router
# ...
app.include_router(ai_screening_router.router)
```

- [ ] **Step 4: Smoke-test the import**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend
.venv/bin/python -c "from app.main import app; print([r.path for r in app.routes if '/admin/ai-screening' in r.path])"
```

Expected: `['/admin/ai-screening/run']`

- [ ] **Step 5: Commit**

```bash
cd /Users/apple/Desktop/Final_AP_os
git add backend/app/routers/ai_screening.py backend/app/main.py
git commit -m "feat(ai-scoring): POST /admin/ai-screening/run endpoint

routers/ai_screening.py exposes the runner via the admin API:

  POST /admin/ai-screening/run
  Body: {application_id?: str, limit?: int, all?: bool, track: 'tir'}

Resolves a list of application IDs (single | first N | all),
invokes score_application per ID, persists results, returns a
summary of composite + strength + needs_human_review per ID.

Capability-gated to manage_users (admin only) initially while we
evaluate the pipeline. Loosen to view_app_detail later.

503 if AI_SCORING_ENABLED env var is not 'true' — operational
kill switch."
```

---

### Task 19: Env vars + .env.example documentation

**Files:**
- Modify: `backend/.env.example`

- [ ] **Step 1: Add the new vars at the end of `.env.example`**

Read `backend/.env.example` and append this block:

```bash

# ─── AI scoring pipeline (Phase 1.5, spec §12) ──────────────────────
# Master kill switch. Set to "true" to enable the LangGraph scoring
# pipeline. When false, the admin endpoint returns 503.
AI_SCORING_ENABLED=false

# LangChain provider abstraction.
#   AI_SCORING_PROVIDER: google_genai | openai | anthropic
#   AI_SCORING_MODEL:    gemini-2.5-flash | gpt-4o-mini | claude-haiku-4-5-20251001
AI_SCORING_PROVIDER=google_genai
AI_SCORING_MODEL=gemini-2.5-flash

# Provider API key (only the one matching AI_SCORING_PROVIDER is needed)
GOOGLE_API_KEY=
# OPENAI_API_KEY=
# ANTHROPIC_API_KEY=
```

- [ ] **Step 2: Commit**

```bash
cd /Users/apple/Desktop/Final_AP_os
git add backend/.env.example
git commit -m "docs(env): document AI_SCORING_* env vars

Adds to .env.example:
  AI_SCORING_ENABLED    — master kill switch (default false)
  AI_SCORING_PROVIDER   — google_genai | openai | anthropic
  AI_SCORING_MODEL      — gemini-2.5-flash by default
  GOOGLE_API_KEY        — Gemini provider key

Real .env / .env.staging / .env.prod files (gitignored) are updated
by the operator out-of-band before enabling the pipeline."
```

---

### Task 20: Calibration scaffolding — hand-score template + README

**Files:**
- Create: `backend/scripts/ai-scoring/calibration/hand_score_template.json`
- Create: `backend/scripts/ai-scoring/calibration/README.md`
- Create: `backend/scripts/ai-scoring/README.md`

- [ ] **Step 1: Write the hand-score template**

Write to `backend/scripts/ai-scoring/calibration/hand_score_template.json`:

```json
{
  "application_id": "REPLACE_WITH_UUID",
  "reviewer_name": "REPLACE",
  "reviewed_at": "REPLACE_ISO_TIMESTAMP",
  "scores": {
    "problem_impact": {
      "score": 0,
      "rationale": "1-2 sentences citing specific Q9/Q10 evidence."
    },
    "completeness": {
      "score": 0,
      "rationale": "1-2 sentences citing Q11/Q15/Q16/Q17/Q20/Q21 evidence."
    },
    "technical_depth": {
      "score": 0,
      "rationale": "1-2 sentences citing Q11/Q12/Q15/Q19 evidence."
    },
    "behavioural": {
      "score": 0,
      "rationale": "1-2 sentences citing Q18/voice/CV evidence ONLY. Do not read Q4/Q6/Q7/Q16."
    },
    "commitment": {
      "score": 0,
      "rationale": "1-2 sentences citing Q4/Q6/Q7/Q16/CV evidence ONLY. Do not read Q18."
    }
  },
  "worked_example_candidates": {
    "note": "For each signal, if this score is a clear anchor for the rubric, paste one short excerpt and one-sentence reasoning. Used to extract worked examples for the prompts.",
    "problem_impact": null,
    "completeness": null,
    "technical_depth": null,
    "behavioural": null,
    "commitment": null
  }
}
```

- [ ] **Step 2: Write the calibration README**

Write to `backend/scripts/ai-scoring/calibration/README.md`:

```markdown
# AI scoring calibration — Path A (pre-deployment)

Per spec §7.4. Hand-score 10-20 real applications with 2 reviewers
before the AI pipeline ships, so the LLM has worked examples anchored
in real applicant writing.

## Workflow

1. **Pick 10-20 real applications** from the 269 imported into staging.
   Aim for variety: some strong, some weak, some borderline, mix of
   solo vs team, mix of industries.

2. **Each reviewer copies `hand_score_template.json`** into a file
   named `hand-scored-<application_short_id>-<reviewer-initials>.json`
   and fills in the 5 scores + rationales using ONLY the rubrics in
   the Pass 2 prompts at `backend/app/services/ai_scoring/prompts/signals/*.txt`.

   No LLM. No collaboration during scoring. Independent.

3. **Reconcile**: where the two reviewers' scores differ by >1, talk it
   through. The disagreement points to either an unclear rubric (fix
   the prompt) or an inconsistent reviewer (recalibrate). Iterate 2-3
   times until reviewer-to-reviewer agreement is ±1 on ≥80% of scores.

4. **Extract worked examples**. From the converged set, pick 2-3
   applications per signal that clearly anchor different score levels
   (e.g. one ~9, one ~5, one ~2). Fill in the `worked_example_candidates`
   block of those applications' JSON files.

5. **Embed in prompts**. Append a `## Worked examples` block to each
   `prompts/signals/<signal>.txt` containing the chosen excerpts.
   Prompts become v1.0.

6. **Validate on held-out**. Score a fresh 5-10 applications with the
   AI pipeline (`./run.sh` against the staging Supabase). Have a third
   reviewer score the same applications by hand. Compare. If
   agreement is within ±1 on ≥80% of scores, the prompts are deployment-
   ready. Otherwise, iterate.

## Storing reviewer files

Hand-scored files live under `backend/scripts/ai-scoring/calibration/`
and are committed to the repo (no PII — the basic_* fields are
redacted in the AI pipeline anyway, and rationales should reference
application content abstractly).
```

- [ ] **Step 3: Write the top-level runbook**

Write to `backend/scripts/ai-scoring/README.md`:

```markdown
# AI scoring pipeline — operator runbook

Implementation of `docs/superpowers/specs/2026-05-20-ai-scoring-langgraph-design.md`.

## Pre-deployment

1. Complete calibration per `calibration/README.md`. Embed worked examples
   into the 5 Pass-2 prompts.
2. Get lead sign-off on the ARTPARK assets list in
   `backend/app/services/ai_scoring/artpark_assets.md`.
3. Verify migration 016 has been applied to staging Supabase
   (column `ai_screening.score_completeness` exists).
4. Set staging env vars (in `backend/.env.staging`):
   ```
   AI_SCORING_ENABLED=true
   AI_SCORING_PROVIDER=google_genai
   AI_SCORING_MODEL=gemini-2.5-flash
   GOOGLE_API_KEY=<your-key>
   ```

## Running

Dry-run a single application first:

```bash
# Get an application_id from the leadership dashboard or query Supabase
APP_ID=<some uuid>

# Make the request (via curl or the admin UI when it exists)
curl -X POST https://<staging-api-url>/admin/ai-screening/run \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d "{\"application_id\": \"$APP_ID\", \"track\": \"tir\"}"
```

Run against the full imported cohort:

```bash
curl -X POST https://<staging-api-url>/admin/ai-screening/run \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"all": true, "track": "tir"}'
```

## Rollback

Set `AI_SCORING_ENABLED=false` in env. The endpoint returns 503;
existing `ai_screening` rows persist. To re-run from scratch:

```sql
delete from public.ai_screening where application_track = 'tir';
```

Then re-enable + re-run.

## Observability

Each run writes a per-application transcript to
`backend/scripts/ai-scoring/runs/<application_id>-<timestamp>.json`
(gitignored). Inspect when debugging odd scores.
```

- [ ] **Step 4: Commit**

```bash
cd /Users/apple/Desktop/Final_AP_os
git add backend/scripts/ai-scoring/
git commit -m "docs(ai-scoring): calibration template + runbook

Three files for the operator path:

  scripts/ai-scoring/README.md
    Top-level runbook — pre-deployment checklist, dry-run command,
    full-cohort command, rollback procedure.

  scripts/ai-scoring/calibration/README.md
    Path A hand-scoring workflow (spec §7.4) — 6 numbered steps from
    'pick 10-20 apps' to 'validate on held-out'.

  scripts/ai-scoring/calibration/hand_score_template.json
    Per-application JSON template the 2 reviewers fill in independently.
    Includes a worked_example_candidates block reviewers populate
    when they find an application that clearly anchors a score level."
```

---

### Task 21: Run full test suite + verify no regressions

**Files:** none — verification only.

- [ ] **Step 1: Run the new test suite**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend
.venv/bin/pytest tests/ai_scoring/ -v --no-cov 2>&1 | tail -20
```

Expected: All ai_scoring tests pass. Expect roughly 50+ tests:
- test_state.py: 6
- test_caps.py: 14
- test_compute.py: 7
- test_quality_gate.py: 16
- test_extract_evidence_node.py: 2
- test_score_signals_node.py: 2
- test_pass3_nodes.py: 2
- test_synthesize_node.py: 2
- test_graph_e2e.py: 1
- test_persistence.py: 2
- test_runner.py: 2

Total: ~56 passing.

- [ ] **Step 2: Run the existing backend test suite (regression check)**

```bash
cd /Users/apple/Desktop/Final_AP_os/backend
.venv/bin/pytest 2>&1 | tail -10
```

Expected: existing backend suite (240+ tests) still passes. If anything fails that wasn't failing before, STOP and report BLOCKED.

- [ ] **Step 3: Build the frontend (regression check)**

```bash
cd /Users/apple/Desktop/Final_AP_os/frontend
npx vite build 2>&1 | tail -5
```

Expected: `✓ built` with no errors.

- [ ] **Step 4: Verify git state is clean**

```bash
cd /Users/apple/Desktop/Final_AP_os
git status --short
```

Expected: empty (only the pre-existing `?? .superpowers/` allowed). No uncommitted code from this plan.

- [ ] **Step 5: Push to origin**

```bash
cd /Users/apple/Desktop/Final_AP_os
git log --oneline origin/staging-role_based_dashboard..HEAD | head -25
git push origin staging-role_based_dashboard 2>&1 | tail -3
```

Expected: all 20 task commits pushed cleanly.

There is no commit for Task 21 itself — it's verification only.

---

## Self-Review checklist

Run through this checklist after completing the plan. Fix any gaps inline.

### Spec coverage

| Spec section | Implemented by Task(s) |
|---|---|
| §2 Architecture (LangGraph + 4 passes) | 11, 12, 13, 14, 15 |
| §3 5 signals + weights | 7 (compute.py WEIGHTS), 6 (cap rules respect signal names) |
| §4 Question-to-signal mapping | 10 (prompts hard-code which Qs each scorer reads) |
| §5 7 cross-check rules | 6 (caps.py) |
| §6 Pass 1 evidence extractor | 11 |
| §7 Pass 2 five scoring prompts | 10 (prompts), 12 (node factory) |
| §8 Pass 3 caps + confidence | 6 (caps), 7 (compute), 13 (node wrappers) |
| §9 Pass 4 synthesis + quality gate | 14 (synthesize), 8 (quality gate), 15 (gate-retry loop in graph) |
| §10 DB changes | 3 (migration), 4 (frontend rename) |
| §11 Backend module layout | 2 (scaffolding), 5-20 (each module) |
| §12 Operational characteristics | 18 (endpoint), 19 (env), 20 (runbook) |
| §13 Round 2 reserved seams | 5 (Round2Summary in state.py), 14 (NotImplementedError on tsp_context) |
| §14 Out of scope | (nothing implemented — correct) |
| §16 Acceptance criteria | 21 (verification), 20 (calibration runbook) |

### Placeholder scan

- No "TBD" / "TODO" / "fill in details" tokens in any task.
- ARTPARK assets list is explicitly marked PLACEHOLDER in Task 9 — that's correct (real list awaits lead sign-off per spec §16) and the placeholder is functional (the pipeline builds end-to-end against it).
- All code blocks contain complete, runnable code.
- No "see Task N" references that don't actually have the code.

### Type consistency

- `SignalScore.signal` Literal matches across `state.py`, `caps.py`, `compute.py`, prompts.
- `CapEvent.rule_id` Literal matches `caps.py` rule names (C1, C2, C3, C5, C6, C7, C9).
- State slot naming consistent (`score_<signal>` everywhere) across `score_signals.py`, `apply_caps.py`, `compute_confidence.py`, `synthesize.py`, `persistence.py`.
- Signal name `behavioural` (British spelling) used throughout — never `behavioral`.
- The persistence layer's signal-to-column map matches the DB schema after migration 016 (`score_completeness` exists, `score_founders` retained for backwards-compat).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-20-ai-scoring-langgraph-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, two-stage review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
