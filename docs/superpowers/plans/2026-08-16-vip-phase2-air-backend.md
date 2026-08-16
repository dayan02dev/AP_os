# VIP Phase 2 (backend): AIR evaluation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the ARTPARK Innovation Readiness assessment from the API — the framework catalog, the scoring rules, one assessment round per quarter with claimed-vs-verified levels, and evidence uploads.

**Architecture:** A static server-owned catalog (`air_catalog.py`) holds the framework so the browser never keeps its own copy. Scoring lives in `air_scoring.py` as pure functions over that catalog — no DB, no I/O, exhaustively tested. Three VIP-only tables keep real foreign keys to `sip_applications`. One router exposes a lazily-created current round.

**Tech Stack:** FastAPI + Supabase (service-role client, RLS-denied to all else), pytest with the `FakeSupabase` double.

**Spec:** `docs/superpowers/specs/2026-08-15-vip-onboarding-design.md` §4
**Framework source:** `docs/reference/air-framework.md` — the binding content authority for Tasks 1-2.

## Global Constraints

- Branch `feat/vip-onboarding`, worktree `.claude/worktrees/vip-onboarding`. Work only here.
- DB track code is **`sip`**; user-facing label is always **"VIP"**. Never put `sip` in user-facing copy.
- Migrations: 043 exists; this phase adds **044**. Wrap DDL in `begin; … commit;`. Never apply it to a database — a human pastes it into Supabase Studio.
- Phase 1 made `track` a **required** argument on every shared-table service read. Follow that: no `track="tir"` style defaults anywhere in new code. AIR tables are VIP-only and FK `sip_applications`, so they take `application_id` alone.
- Run pytest from `backend/` with `--no-cov`. Python: `/Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python`.
- Known baseline: ~20 pre-existing backend failures on this branch, unrelated. Do not fix them.
- Commit messages: no `Co-Authored-By`, no Claude/Anthropic/AI reference.
- `require_founder_access` yields `ctx` = `{'user_id', 'track', 'application_id', 'status', 'app'}`. AIR endpoints are VIP-only: reject `ctx["track"] != "sip"` with 409 `not_available_for_track`, exactly as `push_to_procurement` does in `founder_resources.py:150-157`.

---

### Task 1: `air_catalog.py` — the framework as data

**Files:**
- Create: `backend/app/services/air_catalog.py`
- Test: `backend/tests/test_air_catalog.py`

**Interfaces:**
- Consumes: `docs/reference/air-framework.md` (content source).
- Produces:
  - `LEVERS: list[dict]` — each `{"key", "name", "family"}`, in source order. `family` is `"technology"` or `"commercial"`.
  - `TECHNOLOGY_LEVERS: tuple[str, ...]`, `COMMERCIAL_LEVERS: tuple[str, ...]`, `LEVER_KEYS: tuple[str, ...]`
  - `QUESTIONS: dict[str, list[dict]]` — lever key → 3 questions in order, each `{"id": "q1"|"q2"|"q3", "text", "focus", "options": [{"id": "A".."E", "text", "level": int}]}`
  - `CRITERIA: dict[str, dict[int, list[str]]]` — lever key → AIR level → criteria strings
  - `DOCUMENTS: dict[str, dict[int, str]]` — lever key → AIR level → required document label
  - `question_max(lever: str, q_id: str) -> int`
  - `level_for_option(lever: str, q_id: str, option_id: str) -> int | None`
  - `required_document(lever: str, level: int) -> str | None` — implements the resolution rule below
  - `criteria_for(lever: str, level: int) -> list[str]`

**Content authority:** transcribe from `docs/reference/air-framework.md` §1, §3, §4 verbatim. Do not paraphrase option text, do not "fix" the duplicate level mappings the source flags, do not invent documents for the levels the source leaves blank.

> **On the `…` in Step 3's code block — deliberate, not a placeholder.** The catalog is ~1,500 lines of pure content: 59 options, 54 criteria groups, 47 document labels. Inlining it here would duplicate `docs/reference/air-framework.md` in a second place that could then drift from it. Instead the plan gives the exact structure, the committed source file is the single content authority, and Step 1's tests assert the shape hard enough to catch a transcription slip — exact option counts per question, the derived maxima table, the 59-option total, sequential option ids, non-decreasing levels, the three preserved duplicates, the exact document-gap sets, and spot-checked labels. Transcribe every ellipsis from the source.

**Resolution rule for missing documents** (`docs/reference/air-framework.md` §3): when the claimed level has no document, return the document from the highest defined level at or below it; if none exists at or below, return `None`. Only `supply_chain` at AIR 1 returns `None`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_air_catalog.py`:

```python
"""The AIR framework as data. Structural guards — a transcription slip in a
59-option catalog is invisible by eye, so assert the shape hard.

Content authority: docs/reference/air-framework.md
"""
from app.services import air_catalog as cat

EXPECTED_LEVERS = [
    ("scientific_principles", "technology"),
    ("architecture", "technology"),
    ("qualification", "technology"),
    ("user_needs", "commercial"),
    ("supply_chain", "commercial"),
    ("reliability", "commercial"),
]

# From docs/reference/air-framework.md §2 — derived from the options, and the
# thing the ladder rule depends on. If a transcription slip changes an option's
# level, this table stops matching.
EXPECTED_MAXIMA = {
    "scientific_principles": (3, 5, 9),
    "architecture": (3, 5, 9),
    "qualification": (3, 5, 9),
    "user_needs": (3, 6, 9),
    "supply_chain": (4, 7, 9),
    "reliability": (5, 7, 9),
}

EXPECTED_OPTION_COUNTS = {
    "scientific_principles": (3, 4, 5),
    "architecture": (3, 3, 4),
    "qualification": (3, 3, 4),
    "user_needs": (3, 3, 3),
    "supply_chain": (3, 3, 3),
    "reliability": (3, 3, 3),
}


def test_six_levers_in_two_families():
    assert [(l["key"], l["family"]) for l in cat.LEVERS] == EXPECTED_LEVERS
    assert cat.TECHNOLOGY_LEVERS == ("scientific_principles", "architecture", "qualification")
    assert cat.COMMERCIAL_LEVERS == ("user_needs", "supply_chain", "reliability")
    assert cat.LEVER_KEYS == tuple(k for k, _ in EXPECTED_LEVERS)


def test_every_lever_has_exactly_three_questions():
    for lever in cat.LEVER_KEYS:
        qs = cat.QUESTIONS[lever]
        assert [q["id"] for q in qs] == ["q1", "q2", "q3"], lever


def test_option_counts_match_the_source():
    for lever, counts in EXPECTED_OPTION_COUNTS.items():
        got = tuple(len(q["options"]) for q in cat.QUESTIONS[lever])
        assert got == counts, lever
    total = sum(len(q["options"]) for lever in cat.LEVER_KEYS for q in cat.QUESTIONS[lever])
    assert total == 59


def test_option_ids_are_sequential_letters():
    for lever in cat.LEVER_KEYS:
        for q in cat.QUESTIONS[lever]:
            ids = [o["id"] for o in q["options"]]
            assert ids == ["A", "B", "C", "D", "E"][: len(ids)], (lever, q["id"])


def test_every_option_level_is_a_valid_air_level():
    for lever in cat.LEVER_KEYS:
        for q in cat.QUESTIONS[lever]:
            for o in q["options"]:
                assert 1 <= o["level"] <= 9, (lever, q["id"], o["id"])


def test_option_levels_are_non_decreasing_within_a_question():
    """Later letters describe more mature states, so levels never go backwards.
    The source's duplicate mappings (supply_chain q3 A/B, reliability q2 A/B and
    q3 A/B) are equal, not decreasing, so they pass."""
    for lever in cat.LEVER_KEYS:
        for q in cat.QUESTIONS[lever]:
            levels = [o["level"] for o in q["options"]]
            assert levels == sorted(levels), (lever, q["id"], levels)


def test_question_maxima_match_the_source_table():
    for lever, maxima in EXPECTED_MAXIMA.items():
        got = (cat.question_max(lever, "q1"),
               cat.question_max(lever, "q2"),
               cat.question_max(lever, "q3"))
        assert got == maxima, lever


def test_the_sources_duplicate_mappings_are_preserved():
    """Deliberately asserted so nobody 'tidies' them away without a decision."""
    sc_q3 = {o["id"]: o["level"] for o in cat.QUESTIONS["supply_chain"][2]["options"]}
    assert sc_q3["A"] == sc_q3["B"] == 8
    rel_q2 = {o["id"]: o["level"] for o in cat.QUESTIONS["reliability"][1]["options"]}
    assert rel_q2["A"] == rel_q2["B"] == 6
    rel_q3 = {o["id"]: o["level"] for o in cat.QUESTIONS["reliability"][2]["options"]}
    assert rel_q3["A"] == rel_q3["B"] == 8


def test_level_for_option_resolves_and_rejects():
    assert cat.level_for_option("scientific_principles", "q3", "E") == 9
    assert cat.level_for_option("user_needs", "q2", "A") == 4
    assert cat.level_for_option("scientific_principles", "q1", "Z") is None
    assert cat.level_for_option("nonsense", "q1", "A") is None


def test_documents_cover_every_defined_level():
    """The source leaves gaps; they must be gaps, not silently filled."""
    assert cat.DOCUMENTS["scientific_principles"][1] == "Research & Feasibility Report"
    assert cat.DOCUMENTS["user_needs"][5] == "Signed MoU / PoC Agreement"
    assert set(cat.DOCUMENTS["supply_chain"]) == {2, 4, 6, 8, 9}
    assert set(cat.DOCUMENTS["reliability"]) == {1, 3, 5, 6, 7, 8, 9}
    for lever in ("scientific_principles", "architecture", "qualification", "user_needs"):
        assert set(cat.DOCUMENTS[lever]) == set(range(1, 10)), lever


def test_required_document_falls_back_to_the_highest_defined_level_below():
    # supply_chain defines 2,4,6,8,9 — a claim of 3 falls back to 2's document
    assert cat.required_document("supply_chain", 3) == "Draft BOM"
    assert cat.required_document("supply_chain", 5) == "DFMA Report"
    assert cat.required_document("supply_chain", 7) == "Sourcing Plan & TCO Model"
    # reliability defines 1,3,5,6,7,8,9 — a claim of 4 falls back to 3's
    assert cat.required_document("reliability", 4) == "Org Chart & RACI"
    assert cat.required_document("reliability", 2) == "Team Roster"
    # exact hits are returned unchanged
    assert cat.required_document("architecture", 8) == "Design Freeze Package"


def test_required_document_is_none_only_where_nothing_is_defined_below():
    assert cat.required_document("supply_chain", 1) is None


def test_criteria_exist_for_every_level_a_document_exists_for():
    for lever in cat.LEVER_KEYS:
        for level in cat.DOCUMENTS[lever]:
            assert cat.criteria_for(lever, level), (lever, level)


def test_criteria_for_is_empty_not_raising_for_an_undefined_level():
    assert cat.criteria_for("supply_chain", 3) == []
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd .claude/worktrees/vip-onboarding/backend
/Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python -m pytest tests/test_air_catalog.py -v --no-cov
```

Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.air_catalog'`

- [ ] **Step 3: Write the catalog**

Create `backend/app/services/air_catalog.py`. Transcribe every question, option, criterion and document from `docs/reference/air-framework.md` §1, §3 and §4. Structure:

```python
"""ARTPARK Innovation Readiness (AIR) — the framework as data.

Server-owned so the browser renders whatever we send rather than holding its
own copy of the wording, exactly like founder_mou.ACKNOWLEDGEMENTS and
founder_catalog. Revising a question's text needs no frontend deploy.

Content authority: docs/reference/air-framework.md. Two things there are
deliberate and must not be "tidied": the source maps two options to the same
AIR level in three places, and it defines no qualifying document at some
levels of supply_chain and reliability.
"""
from __future__ import annotations

LEVERS: list[dict] = [
    {"key": "scientific_principles", "name": "Scientific Principles & Models", "family": "technology"},
    {"key": "architecture", "name": "Architecture & System Definition", "family": "technology"},
    {"key": "qualification", "name": "Qualification & Final Design", "family": "technology"},
    {"key": "user_needs", "name": "User Needs & Requirements", "family": "commercial"},
    {"key": "supply_chain", "name": "Supply Chain & Manufacturing", "family": "commercial"},
    {"key": "reliability", "name": "Reliability & Maintainability", "family": "commercial"},
]

LEVER_KEYS: tuple[str, ...] = tuple(l["key"] for l in LEVERS)
TECHNOLOGY_LEVERS: tuple[str, ...] = tuple(l["key"] for l in LEVERS if l["family"] == "technology")
COMMERCIAL_LEVERS: tuple[str, ...] = tuple(l["key"] for l in LEVERS if l["family"] == "commercial")

QUESTIONS: dict[str, list[dict]] = {
    "scientific_principles": [
        {
            "id": "q1",
            "text": "How well documented and verified are the core scientific principles of your technology?",
            "focus": "Physics, Literature, Prior Art, Feasibility Scan.",
            "options": [
                {"id": "A", "level": 1, "text": "Principles are based only on a high-level idea; no formal literature review or IP scan completed."},
                {"id": "B", "level": 2, "text": "Comprehensive literature/patent search is complete; core scientific principles are formally documented, and a high-level feasibility scan is done."},
                {"id": "C", "level": 3, "text": "All critical knowledge gaps have been identified, and initial lab tests have successfully demonstrated POC viability."},
            ],
        },
        # … q2, q3 …
    ],
    # … the other five levers …
}

CRITERIA: dict[str, dict[int, list[str]]] = { ... }   # §4
DOCUMENTS: dict[str, dict[int, str]] = { ... }        # §3


def question_max(lever: str, q_id: str) -> int:
    """Highest AIR level obtainable on one question. The ladder rule in
    air_scoring depends on this, which is why it is derived from the options
    rather than written down twice."""
    for q in QUESTIONS.get(lever, []):
        if q["id"] == q_id:
            return max(o["level"] for o in q["options"])
    return 0


def level_for_option(lever: str, q_id: str, option_id: str) -> int | None:
    for q in QUESTIONS.get(lever, []):
        if q["id"] == q_id:
            for o in q["options"]:
                if o["id"] == option_id:
                    return o["level"]
    return None


def required_document(lever: str, level: int) -> str | None:
    """The document to upload for a claimed level.

    The source defines no document at some levels of supply_chain and
    reliability. Rather than invent one, fall back to the highest defined
    level at or below the claim — the founder is asked for evidence they
    should already have. Returns None only where nothing is defined below.
    """
    defined = DOCUMENTS.get(lever, {})
    candidates = [lv for lv in defined if lv <= level]
    return defined[max(candidates)] if candidates else None


def criteria_for(lever: str, level: int) -> list[str]:
    return list(CRITERIA.get(lever, {}).get(level, []))
```

Fill every `…`. The catalog is long; that is expected — it is data, and it is the single place this wording lives.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd .claude/worktrees/vip-onboarding/backend
/Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python -m pytest tests/test_air_catalog.py -v --no-cov
```

Expected: PASS (14 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/air_catalog.py backend/tests/test_air_catalog.py
git commit -m "feat(vip): AIR framework catalog — six levers, 18 questions, criteria and documents"
```

---

### Task 2: `air_scoring.py` — the ladder and the rollups

**Files:**
- Create: `backend/app/services/air_scoring.py`
- Test: `backend/tests/test_air_scoring.py`

**Interfaces:**
- Consumes: `air_catalog.question_max`, `level_for_option`, `LEVER_KEYS`, `TECHNOLOGY_LEVERS`, `COMMERCIAL_LEVERS`.
- Produces:
  - `lever_level(lever: str, answers: dict[str, str | None]) -> int | None` — `answers` maps `"q1"|"q2"|"q3"` to an option id or `None`. Implements R2.
  - `rollups(levels: dict[str, int | None]) -> dict` — returns `{"technology", "commercial", "overall"}`, each `int | None`. Implements R3.
  - `score_levers(scores: dict[str, dict[str, str | None]]) -> dict[str, int | None]` — convenience: lever key → level.

These are pure functions. No DB, no I/O, no framework imports.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_air_scoring.py`:

```python
"""AIR scoring rules R2 (ladder) and R3 (rollups).

Pure functions over the catalog — these are the rules the whole assessment
rests on, so they get exhaustive treatment.
"""
import pytest

from app.services import air_catalog as cat
from app.services import air_scoring as sc


def _answers(q1=None, q2=None, q3=None):
    return {"q1": q1, "q2": q2, "q3": q3}


# ── R2: the ladder ────────────────────────────────────────────────────

def test_unanswered_lever_has_no_level():
    assert sc.lever_level("scientific_principles", _answers()) is None


def test_q1_alone_sets_the_level():
    # scientific_principles q1: A=1, B=2, C=3
    assert sc.lever_level("scientific_principles", _answers(q1="A")) == 1
    assert sc.lever_level("scientific_principles", _answers(q1="B")) == 2


def test_q2_cannot_lift_the_level_until_q1_is_maxed():
    """The gate-skip rejection — the whole point of a ladder over max()."""
    # q1=B is 2, not q1's max (3). q2=D would be 5 but must not count.
    assert sc.lever_level("scientific_principles", _answers(q1="B", q2="D")) == 2


def test_q2_lifts_the_level_once_q1_is_maxed():
    # q1=C is 3 = max. q2=C is 4.
    assert sc.lever_level("scientific_principles", _answers(q1="C", q2="C")) == 4


def test_q3_cannot_lift_the_level_until_q2_is_maxed():
    # q1=C (3, maxed) → q2=C is 4, not q2's max (5). q3=E would be 9.
    assert sc.lever_level("scientific_principles", _answers(q1="C", q2="C", q3="E")) == 4


def test_the_full_ladder_reaches_nine():
    assert sc.lever_level("scientific_principles", _answers(q1="C", q2="D", q3="E")) == 9


def test_a_high_q3_alone_claims_nothing():
    """A venture cannot claim AIR 9 on q3 while leaving q1 unanswered."""
    assert sc.lever_level("scientific_principles", _answers(q3="E")) is None


def test_a_high_q3_with_a_weak_q1_is_held_at_q1():
    assert sc.lever_level("scientific_principles", _answers(q1="A", q3="E")) == 1


def test_the_level_never_goes_down_when_a_later_answer_is_lower():
    """q2 maxed at 5, then q3=A is also 5 — level stays 5, not reduced."""
    assert sc.lever_level("scientific_principles", _answers(q1="C", q2="D", q3="A")) == 5


def test_an_unknown_option_id_contributes_nothing():
    assert sc.lever_level("scientific_principles", _answers(q1="Z")) is None


def test_a_gap_in_the_middle_stops_the_ladder():
    """q1 maxed but q2 unanswered — q3 must not count."""
    assert sc.lever_level("scientific_principles", _answers(q1="C", q3="E")) == 3


@pytest.mark.parametrize("lever", cat.LEVER_KEYS)
def test_every_lever_reaches_nine_on_its_top_answers(lever):
    top = {}
    for q in cat.QUESTIONS[lever]:
        top[q["id"]] = max(q["options"], key=lambda o: o["level"])["id"]
    assert sc.lever_level(lever, top) == 9


@pytest.mark.parametrize("lever", cat.LEVER_KEYS)
def test_every_lever_bottoms_out_at_its_lowest_q1(lever):
    first = cat.QUESTIONS[lever][0]["options"][0]
    assert sc.lever_level(lever, _answers(q1=first["id"])) == first["level"]


def test_supply_chain_duplicate_q3_options_both_yield_eight():
    """The source's duplicate mapping must not change the ladder's behaviour."""
    a = sc.lever_level("supply_chain", _answers(q1="C", q2="C", q3="A"))
    b = sc.lever_level("supply_chain", _answers(q1="C", q2="C", q3="B"))
    assert a == b == 8


def test_reliability_duplicate_q2_options_both_yield_six():
    a = sc.lever_level("reliability", _answers(q1="C", q2="A"))
    b = sc.lever_level("reliability", _answers(q1="C", q2="B"))
    assert a == b == 6


# ── R3: the rollups ───────────────────────────────────────────────────

FULL = {
    "scientific_principles": 5, "architecture": 4, "qualification": 6,
    "user_needs": 7, "supply_chain": 3, "reliability": 8,
}


def test_rollups_take_the_minimum_of_each_family():
    r = sc.rollups(FULL)
    assert r["technology"] == 4      # min(5, 4, 6)
    assert r["commercial"] == 3      # min(7, 3, 8)
    assert r["overall"] == 3         # min of all six


def test_overall_is_the_minimum_across_both_families():
    r = sc.rollups({**FULL, "architecture": 9, "qualification": 9,
                    "scientific_principles": 9})
    assert r["technology"] == 9
    assert r["commercial"] == 3
    assert r["overall"] == 3


def test_a_family_with_any_unscored_lever_rolls_up_to_none():
    """Not a partial minimum — an incomplete family has no defensible score."""
    r = sc.rollups({**FULL, "architecture": None})
    assert r["technology"] is None
    assert r["commercial"] == 3
    assert r["overall"] is None


def test_all_unscored_rolls_up_to_none():
    r = sc.rollups({k: None for k in cat.LEVER_KEYS})
    assert r == {"technology": None, "commercial": None, "overall": None}


def test_a_missing_lever_key_is_treated_as_unscored():
    r = sc.rollups({"scientific_principles": 5})
    assert r["overall"] is None


def test_score_levers_maps_answers_to_levels():
    got = sc.score_levers({
        "scientific_principles": _answers(q1="C", q2="D", q3="E"),
        "user_needs": _answers(q1="A"),
    })
    assert got["scientific_principles"] == 9
    assert got["user_needs"] == 1
    assert got["architecture"] is None
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd .claude/worktrees/vip-onboarding/backend
/Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python -m pytest tests/test_air_scoring.py -v --no-cov
```

Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.air_scoring'`

- [ ] **Step 3: Write the scoring module**

Create `backend/app/services/air_scoring.py`:

```python
"""AIR scoring — the rules that turn 18 answers into levels.

Pure functions over air_catalog. No DB, no I/O.

R2 (the ladder) is the load-bearing rule. The three questions per lever are
progressive bands whose ranges overlap: for scientific_principles, q1 spans
AIR 1-3, q2 spans 2-5, q3 spans 5-9. A plain max() over the answers would let
a venture claim AIR 7 on q3 while admitting AIR 1 on q1 — skipping two gates.
So a question may only lift the level if the question before it is answered at
its own maximum.
"""
from __future__ import annotations

from . import air_catalog as cat

_Q_ORDER = ("q1", "q2", "q3")


def lever_level(lever: str, answers: dict[str, str | None]) -> int | None:
    """The AIR level a lever's answers claim, or None if q1 is unanswered.

    Walks the questions in order. Each question can only raise the level while
    every preceding question sits at its own maximum; the first question that
    is unanswered, unrecognised, or below its maximum stops the ladder.
    """
    level: int | None = None
    for q_id in _Q_ORDER:
        got = cat.level_for_option(lever, q_id, answers.get(q_id) or "")
        if got is None:
            break
        level = got if level is None else max(level, got)
        if got < cat.question_max(lever, q_id):
            break
    return level


def score_levers(scores: dict[str, dict[str, str | None]]) -> dict[str, int | None]:
    """Every lever's level, keyed by lever. Levers absent from `scores` are None."""
    return {
        lever: lever_level(lever, scores.get(lever) or {})
        for lever in cat.LEVER_KEYS
    }


def _family_min(levels: dict[str, int | None], keys: tuple[str, ...]) -> int | None:
    """Minimum across a family — None if ANY lever in it is unscored.

    Deliberately not a partial minimum: a family with an unscored lever has no
    defensible score, and reporting min() over the rest would overstate it.
    """
    values = [levels.get(k) for k in keys]
    if any(v is None for v in values):
        return None
    return min(values)  # type: ignore[type-var]


def rollups(levels: dict[str, int | None]) -> dict[str, int | None]:
    """Technology, Commercial and Overall AIR.

    A venture is only as mature as its weakest lever, so every rollup is a
    minimum. Technology and Commercial are surfaced separately because the
    TRL-plus-CRL split is what AIR exists to express.
    """
    return {
        "technology": _family_min(levels, cat.TECHNOLOGY_LEVERS),
        "commercial": _family_min(levels, cat.COMMERCIAL_LEVERS),
        "overall": _family_min(levels, cat.LEVER_KEYS),
    }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd .claude/worktrees/vip-onboarding/backend
/Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python -m pytest tests/test_air_scoring.py -v --no-cov
```

Expected: PASS (28 tests, counting the parametrised ones)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/air_scoring.py backend/tests/test_air_scoring.py
git commit -m "feat(vip): AIR scoring — gate-respecting ladder and family rollups"
```

---

### Task 3: Migration 044 — the three AIR tables

**Files:**
- Create: `backend/migrations/044_vip_air.sql`
- Test: `backend/tests/test_vip_air_migration.py`

**Interfaces:**
- Produces: `vip_air_assessments`, `vip_air_lever_scores`, `vip_air_evidence`, and the private storage bucket `vip-founder-docs`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_vip_air_migration.py`:

```python
"""044 creates the AIR tables. These are VIP-only, so unlike the five shared
tables in 043 they keep real foreign keys."""
from pathlib import Path


def _sql() -> str:
    return Path("migrations/044_vip_air.sql").read_text().lower()


def test_creates_the_three_air_tables():
    sql = _sql()
    for table in ("vip_air_assessments", "vip_air_lever_scores", "vip_air_evidence"):
        assert f"create table if not exists public.{table}" in sql, table


def test_air_tables_keep_real_foreign_keys():
    """VIP-only, so referential integrity is available and must be used."""
    sql = _sql()
    assert "references public.sip_applications(id) on delete cascade" in sql
    assert sql.count("references public.vip_air_assessments(id) on delete cascade") == 2


def test_one_round_per_application_and_one_score_per_lever():
    sql = _sql()
    assert "unique (application_id, round_label)" in sql
    assert "unique (assessment_id, lever)" in sql


def test_status_and_lever_are_constrained():
    sql = _sql()
    assert "check (status in ('draft','submitted','verified'))" in sql
    assert "'scientific_principles'" in sql and "'reliability'" in sql


def test_levels_are_constrained_to_the_air_range():
    sql = _sql()
    assert sql.count("between 1 and 9") >= 3


def test_rls_enabled_with_no_policies():
    sql = _sql()
    assert sql.count("enable row level security") == 3
    assert "create policy" not in sql


def test_private_bucket_is_created():
    sql = _sql()
    assert "vip-founder-docs" in sql
    assert "storage.buckets" in sql
    assert "on conflict (id) do nothing" in sql


def test_migration_is_transactional():
    sql = _sql()
    assert "begin;" in sql
    assert sql.strip().endswith("commit;")
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd .claude/worktrees/vip-onboarding/backend
/Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python -m pytest tests/test_vip_air_migration.py -v --no-cov
```

Expected: FAIL — `FileNotFoundError: migrations/044_vip_air.sql`

- [ ] **Step 3: Write the migration**

Create `backend/migrations/044_vip_air.sql`:

```sql
-- 044_vip_air.sql — ARTPARK Innovation Readiness (AIR) assessment, VIP only.
--
-- Unlike the five shared tables in 043, these are VIP-only, so they keep real
-- foreign keys to sip_applications(id). No `track` column: there is nothing to
-- disambiguate.
--
-- RLS enabled with NO policies: every access is backend-mediated via the
-- service-role client, and the /founder/air router enforces that the
-- application belongs to the caller — same pattern as 040-043.

begin;

-- 1) One assessment round per venture per quarter.
create table if not exists public.vip_air_assessments (
  id                uuid primary key default gen_random_uuid(),
  application_id    uuid not null references public.sip_applications(id) on delete cascade,
  round_label       text not null,
  status            text not null default 'draft'
                      check (status in ('draft','submitted','verified')),
  submitted_at      timestamptz,
  verified_at       timestamptz,
  verified_by       uuid,
  overall_claimed   int check (overall_claimed between 1 and 9),
  overall_verified  int check (overall_verified between 1 and 9),
  tech_claimed      int check (tech_claimed between 1 and 9),
  tech_verified     int check (tech_verified between 1 and 9),
  comm_claimed      int check (comm_claimed between 1 and 9),
  comm_verified     int check (comm_verified between 1 and 9),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (application_id, round_label)
);
alter table public.vip_air_assessments enable row level security;
create index if not exists idx_vip_air_assessments_app
  on public.vip_air_assessments(application_id);

-- 2) Six lever scores per round — claimed by the founder, verified by ARTPARK.
create table if not exists public.vip_air_lever_scores (
  id                uuid primary key default gen_random_uuid(),
  assessment_id     uuid not null references public.vip_air_assessments(id) on delete cascade,
  lever             text not null check (lever in (
                      'scientific_principles','architecture','qualification',
                      'user_needs','supply_chain','reliability')),
  q1_option         text,
  q2_option         text,
  q3_option         text,
  criteria_checked  jsonb not null default '[]'::jsonb,
  claimed_level     int check (claimed_level between 1 and 9),
  verified_level    int check (verified_level between 1 and 9),
  verifier_note     text,
  verified_at       timestamptz,
  verified_by       uuid,
  updated_at        timestamptz not null default now(),
  unique (assessment_id, lever)
);
alter table public.vip_air_lever_scores enable row level security;
create index if not exists idx_vip_air_scores_assessment
  on public.vip_air_lever_scores(assessment_id);

-- 3) Qualifying documents uploaded per lever per claimed level.
create table if not exists public.vip_air_evidence (
  id                uuid primary key default gen_random_uuid(),
  assessment_id     uuid not null references public.vip_air_assessments(id) on delete cascade,
  lever             text not null,
  air_level         int not null check (air_level between 1 and 9),
  doc_label         text not null,
  storage_path      text not null,
  filename          text,
  size_bytes        int,
  content_type      text,
  uploaded_at       timestamptz not null default now()
);
alter table public.vip_air_evidence enable row level security;
create index if not exists idx_vip_air_evidence_assessment
  on public.vip_air_evidence(assessment_id);

-- 4) Private bucket for AIR evidence documents. Service-role only; the
-- backend issues short-lived signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vip-founder-docs','vip-founder-docs', false, 26214400,
        array['application/pdf','image/png','image/jpeg',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;

commit;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd .claude/worktrees/vip-onboarding/backend
/Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python -m pytest tests/test_vip_air_migration.py -v --no-cov
```

Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/044_vip_air.sql backend/tests/test_vip_air_migration.py
git commit -m "feat(vip): migration 044 — AIR assessment, lever scores and evidence tables"
```

---

### Task 4: `air_query.py` — round lifecycle reads

**Files:**
- Create: `backend/app/services/air_query.py`
- Test: `backend/tests/test_air_query.py`

**Interfaces:**
- Consumes: `air_catalog`, `air_scoring`, `supabase_client.get_admin_client`.
- Produces:
  - `current_round_label(today: date) -> str` — Indian FY quarter, e.g. `"FY26-27-Q1"` for 2026-04-01..2026-06-30.
  - `ensure_round(application_id: str, round_label: str) -> dict` — returns the round, creating a `draft` with six empty lever rows if absent. Idempotent.
  - `fetch_round(application_id: str, round_label: str) -> dict | None`
  - `fetch_lever_scores(assessment_id: str) -> list[dict]` — always six rows, in `LEVER_KEYS` order.
  - `fetch_evidence(assessment_id: str) -> list[dict]`
  - `assessment_bundle(application_id: str, round_label: str) -> dict` — the shape `GET /founder/air` returns.

`assessment_bundle` returns:

```python
{
  "catalog": {"levers": [...], "questions": {...}, "criteria": {...}, "documents": {...}},
  "round": {"id", "round_label", "status", "submitted_at", "verified_at"},
  "levers": [
      {"lever", "name", "family", "q1_option", "q2_option", "q3_option",
       "criteria_checked", "claimed_level", "verified_level", "verifier_note",
       "required_document", "criteria", "evidence": [...]},
      ...six, in LEVER_KEYS order...
  ],
  "rollups": {"claimed": {"technology", "commercial", "overall"},
              "verified": {"technology", "commercial", "overall"}},
}
```

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_air_query.py`:

```python
"""Round lifecycle: FY-quarter labelling, lazy creation, and the read bundle."""
from datetime import date

import pytest

from app.services import air_query as aq
from tests.fixtures.fake_supabase import FakeSupabase


@pytest.fixture
def fake(monkeypatch):
    f = FakeSupabase({
        "vip_air_assessments": [],
        "vip_air_lever_scores": [],
        "vip_air_evidence": [],
    })
    monkeypatch.setattr(aq, "get_admin_client", lambda: f)
    return f


# ── Indian FY quarters ────────────────────────────────────────────────

@pytest.mark.parametrize("day,label", [
    (date(2026, 4, 1), "FY26-27-Q1"),
    (date(2026, 6, 30), "FY26-27-Q1"),
    (date(2026, 7, 1), "FY26-27-Q2"),
    (date(2026, 9, 30), "FY26-27-Q2"),
    (date(2026, 10, 1), "FY26-27-Q3"),
    (date(2026, 12, 31), "FY26-27-Q3"),
    (date(2027, 1, 1), "FY26-27-Q4"),
    (date(2027, 3, 31), "FY26-27-Q4"),
    (date(2027, 4, 1), "FY27-28-Q1"),
])
def test_fy_quarter_labels(day, label):
    assert aq.current_round_label(day) == label


def test_january_belongs_to_the_previous_fiscal_year():
    """The Indian FY starts in April, so Jan-Mar is Q4 of the year that began
    the previous April — the boundary most likely to be got wrong."""
    assert aq.current_round_label(date(2026, 1, 15)) == "FY25-26-Q4"


# ── lazy round creation ───────────────────────────────────────────────

def test_ensure_round_creates_a_draft_with_six_lever_rows(fake):
    from app.services import air_catalog as cat
    rnd = aq.ensure_round("app1", "FY26-27-Q1")
    assert rnd["status"] == "draft"
    assert rnd["application_id"] == "app1"
    scores = fake.tables["vip_air_lever_scores"]
    assert len(scores) == 6
    assert {s["lever"] for s in scores} == set(cat.LEVER_KEYS)


def test_ensure_round_is_idempotent(fake):
    a = aq.ensure_round("app1", "FY26-27-Q1")
    b = aq.ensure_round("app1", "FY26-27-Q1")
    assert a["id"] == b["id"]
    assert len(fake.tables["vip_air_assessments"]) == 1
    assert len(fake.tables["vip_air_lever_scores"]) == 6


def test_ensure_round_separates_applications(fake):
    aq.ensure_round("app1", "FY26-27-Q1")
    aq.ensure_round("app2", "FY26-27-Q1")
    assert len(fake.tables["vip_air_assessments"]) == 2
    assert len(fake.tables["vip_air_lever_scores"]) == 12


def test_ensure_round_separates_quarters(fake):
    aq.ensure_round("app1", "FY26-27-Q1")
    aq.ensure_round("app1", "FY26-27-Q2")
    assert len(fake.tables["vip_air_assessments"]) == 2


def test_fetch_lever_scores_returns_six_in_catalog_order(fake):
    from app.services import air_catalog as cat
    rnd = aq.ensure_round("app1", "FY26-27-Q1")
    got = aq.fetch_lever_scores(rnd["id"])
    assert [s["lever"] for s in got] == list(cat.LEVER_KEYS)


# ── the read bundle ───────────────────────────────────────────────────

def test_bundle_carries_the_catalog_and_six_levers(fake):
    b = aq.assessment_bundle("app1", "FY26-27-Q1")
    assert len(b["catalog"]["levers"]) == 6
    assert len(b["levers"]) == 6
    assert b["round"]["status"] == "draft"


def test_bundle_rollups_are_none_before_any_answers(fake):
    b = aq.assessment_bundle("app1", "FY26-27-Q1")
    assert b["rollups"]["claimed"] == {"technology": None, "commercial": None, "overall": None}
    assert b["rollups"]["verified"] == {"technology": None, "commercial": None, "overall": None}


def test_bundle_computes_claimed_rollups_from_stored_answers(fake):
    from app.services import air_catalog as cat
    rnd = aq.ensure_round("app1", "FY26-27-Q1")
    # top out every lever
    for row in fake.tables["vip_air_lever_scores"]:
        lever = row["lever"]
        for q in cat.QUESTIONS[lever]:
            row[f"{q['id']}_option"] = max(q["options"], key=lambda o: o["level"])["id"]
    b = aq.assessment_bundle("app1", "FY26-27-Q1")
    assert b["rollups"]["claimed"]["overall"] == 9
    assert all(l["claimed_level"] == 9 for l in b["levers"])


def test_bundle_exposes_the_required_document_per_lever(fake):
    rnd = aq.ensure_round("app1", "FY26-27-Q1")
    for row in fake.tables["vip_air_lever_scores"]:
        if row["lever"] == "user_needs":
            row["q1_option"] = "C"   # AIR 3
    b = aq.assessment_bundle("app1", "FY26-27-Q1")
    un = next(l for l in b["levers"] if l["lever"] == "user_needs")
    assert un["claimed_level"] == 3
    assert un["required_document"] == "Customer Discovery Log"
    assert un["criteria"]


def test_bundle_attaches_evidence_to_its_lever(fake):
    rnd = aq.ensure_round("app1", "FY26-27-Q1")
    fake.tables["vip_air_evidence"].append({
        "id": "e1", "assessment_id": rnd["id"], "lever": "architecture",
        "air_level": 2, "doc_label": "System Architecture Document",
        "storage_path": "p", "filename": "arch.pdf",
    })
    b = aq.assessment_bundle("app1", "FY26-27-Q1")
    arch = next(l for l in b["levers"] if l["lever"] == "architecture")
    assert [e["filename"] for e in arch["evidence"]] == ["arch.pdf"]
    others = [l for l in b["levers"] if l["lever"] != "architecture"]
    assert all(l["evidence"] == [] for l in others)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd .claude/worktrees/vip-onboarding/backend
/Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python -m pytest tests/test_air_query.py -v --no-cov
```

Expected: FAIL — `ModuleNotFoundError: No module named 'app.services.air_query'`

- [ ] **Step 3: Write the query service**

Create `backend/app/services/air_query.py`. Key points:

```python
"""Reads and lazy creation for the AIR assessment.

Rounds are quarterly and generated on read rather than by a cron: computing
the current label and inserting if absent is idempotent and leaves nothing to
operate. Sorting is done in Python because the FakeSupabase test double treats
.order() as a no-op and lever order is contractual.
"""
from __future__ import annotations

from datetime import date

from ..supabase_client import get_admin_client
from . import air_catalog as cat
from . import air_scoring as sc


def current_round_label(today: date) -> str:
    """Indian FY quarter label, e.g. FY26-27-Q1 for Apr-Jun 2026.

    The fiscal year starts in April, so January-March belongs to the year that
    began the previous April — the boundary worth being explicit about.
    """
    y, m = today.year, today.month
    if m >= 4:
        fy_start, quarter = y, (m - 4) // 3 + 1
    else:
        fy_start, quarter = y - 1, (m + 8) // 3 + 1
    return f"FY{fy_start % 100:02d}-{(fy_start + 1) % 100:02d}-Q{quarter}"
```

Verify the January boundary by hand before running the tests: for `m < 4`, `quarter = (m + 8) // 3 + 1` gives January→4, February→4, March→4. Confirm that matches the parametrised cases.

The rest of the module:

```python
def fetch_round(application_id: str, round_label: str) -> dict | None:
    rows = (
        get_admin_client().table("vip_air_assessments").select("*")
        .eq("application_id", application_id).eq("round_label", round_label)
        .limit(1).execute().data or []
    )
    return rows[0] if rows else None


def ensure_round(application_id: str, round_label: str) -> dict:
    """The round for this quarter, created as a draft if it does not exist.

    Idempotent, and generated on read rather than by a cron: there is nothing
    to schedule and nothing to operate.
    """
    existing = fetch_round(application_id, round_label)
    if existing:
        return existing
    sb = get_admin_client()
    rnd = sb.table("vip_air_assessments").insert({
        "application_id": application_id,
        "round_label": round_label,
        "status": "draft",
    }).execute().data[0]
    for lever in cat.LEVER_KEYS:
        sb.table("vip_air_lever_scores").insert({
            "assessment_id": rnd["id"],
            "lever": lever,
            "criteria_checked": [],
        }).execute()
    return rnd


def fetch_lever_scores(assessment_id: str) -> list[dict]:
    rows = (
        get_admin_client().table("vip_air_lever_scores").select("*")
        .eq("assessment_id", assessment_id).execute().data or []
    )
    order = {k: i for i, k in enumerate(cat.LEVER_KEYS)}
    return sorted(rows, key=lambda r: order.get(r.get("lever"), 99))


def fetch_evidence(assessment_id: str) -> list[dict]:
    return (
        get_admin_client().table("vip_air_evidence").select("*")
        .eq("assessment_id", assessment_id).execute().data or []
    )


def _answers_of(row: dict) -> dict[str, str | None]:
    return {q: row.get(f"{q}_option") for q in ("q1", "q2", "q3")}


def assessment_bundle(application_id: str, round_label: str) -> dict:
    """Everything the wizard needs in one read: the framework, the round, the
    six lever states, and both rollup sets.

    claimed_level is recomputed from the stored answers rather than read from
    the column, so a catalog revision cannot leave a stale score on screen.
    """
    rnd = ensure_round(application_id, round_label)
    scores = fetch_lever_scores(rnd["id"])
    evidence = fetch_evidence(rnd["id"])

    claimed: dict[str, int | None] = {}
    verified: dict[str, int | None] = {}
    levers: list[dict] = []
    by_key = {l["key"]: l for l in cat.LEVERS}

    for row in scores:
        key = row["lever"]
        level = sc.lever_level(key, _answers_of(row))
        claimed[key] = level
        verified[key] = row.get("verified_level")
        levers.append({
            "lever": key,
            "name": by_key[key]["name"],
            "family": by_key[key]["family"],
            "q1_option": row.get("q1_option"),
            "q2_option": row.get("q2_option"),
            "q3_option": row.get("q3_option"),
            "criteria_checked": row.get("criteria_checked") or [],
            "claimed_level": level,
            "verified_level": row.get("verified_level"),
            "verifier_note": row.get("verifier_note"),
            "required_document": cat.required_document(key, level) if level else None,
            "criteria": cat.criteria_for(key, level) if level else [],
            "evidence": [e for e in evidence if e.get("lever") == key],
        })

    return {
        "catalog": {
            "levers": cat.LEVERS,
            "questions": cat.QUESTIONS,
            "criteria": cat.CRITERIA,
            "documents": cat.DOCUMENTS,
        },
        "round": {
            "id": rnd["id"],
            "round_label": rnd["round_label"],
            "status": rnd["status"],
            "submitted_at": rnd.get("submitted_at"),
            "verified_at": rnd.get("verified_at"),
        },
        "levers": levers,
        "rollups": {"claimed": sc.rollups(claimed), "verified": sc.rollups(verified)},
    }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd .claude/worktrees/vip-onboarding/backend
/Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python -m pytest tests/test_air_query.py -v --no-cov
```

Expected: PASS (20 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/air_query.py backend/tests/test_air_query.py
git commit -m "feat(vip): AIR round lifecycle — FY-quarter labels, lazy creation, read bundle"
```

---

### Task 5: `/founder/air` router — read, save answers, submit

**Files:**
- Create: `backend/app/routers/founder_air.py`
- Create: `backend/app/models/air.py`
- Modify: `backend/app/main.py` (register the router)
- Test: `backend/tests/test_air_endpoints.py`

**Interfaces:**
- Consumes: `require_founder_access` (from `routers/founder.py`), `air_query`, `air_scoring`, `air_catalog`.
- Produces:
  - `GET /founder/air` → `assessment_bundle` for the current quarter
  - `PUT /founder/air/levers/{lever}` → body `LeverAnswersIn` `{q1_option, q2_option, q3_option, criteria_checked}` → saves, recomputes `claimed_level`, persists round rollups, returns the bundle
  - `POST /founder/air/submit` → `draft` → `submitted`; 422 `air_incomplete` listing levers with no `claimed_level`; 409 `air_already_submitted` if not draft

**VIP-only:** every endpoint rejects `ctx["track"] != "sip"` with 409 `not_available_for_track`, before any table access.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_air_endpoints.py`:

```python
"""The /founder/air surface: VIP-only, save-and-rescore, submit gate."""
from __future__ import annotations

import pytest

from app.deps import get_current_user
from app.main import app
from app.services import air_catalog as cat
from tests.fixtures.fake_supabase import FakeSupabase


@pytest.fixture
def _clear():
    yield
    app.dependency_overrides.clear()


def _user(track: str):
    return lambda: {"user_id": "u1", "email": "u1@x.com", "track": track,
                    "roles": ["applicant"]}


def _install(monkeypatch, track: str = "sip"):
    from app.routers import founder as founder_router
    from app.routers import founder_air as air_router
    from app.services import air_query
    tables = {
        "sip_applications": [{"id": "sapp1", "user_id": "u1", "status": "onboarded",
                              "submitted_at": "2026-07-01"}],
        "tir_applications": [{"id": "app1", "user_id": "u1", "status": "onboarded",
                              "grant_amount": 2500000, "submitted_at": "2026-07-01"}],
        "vip_air_assessments": [], "vip_air_lever_scores": [], "vip_air_evidence": [],
    }
    if track == "sip":
        tables["tir_applications"] = []
    fake = FakeSupabase(tables)
    monkeypatch.setattr(founder_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(air_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(air_query, "get_admin_client", lambda: fake)
    app.dependency_overrides[get_current_user] = _user(track)
    return fake


def test_tir_founders_cannot_reach_the_air_surface(client, monkeypatch, _clear):
    _install(monkeypatch, track="tir")
    r = client.get("/founder/air")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "not_available_for_track"


def test_get_air_creates_and_returns_a_draft_round(client, monkeypatch, _clear):
    fake = _install(monkeypatch)
    r = client.get("/founder/air")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["round"]["status"] == "draft"
    assert len(body["levers"]) == 6
    assert len(body["catalog"]["levers"]) == 6
    assert len(fake.tables["vip_air_assessments"]) == 1


def test_get_air_is_idempotent(client, monkeypatch, _clear):
    fake = _install(monkeypatch)
    client.get("/founder/air")
    client.get("/founder/air")
    assert len(fake.tables["vip_air_assessments"]) == 1
    assert len(fake.tables["vip_air_lever_scores"]) == 6


def test_saving_answers_rescores_the_lever(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/air")
    r = client.put("/founder/air/levers/user_needs", json={
        "q1_option": "C", "q2_option": "B", "q3_option": None,
        "criteria_checked": ["Initiated customer discovery"],
    })
    assert r.status_code == 200, r.text
    un = next(l for l in r.json()["levers"] if l["lever"] == "user_needs")
    assert un["claimed_level"] == 5
    assert un["criteria_checked"] == ["Initiated customer discovery"]


def test_saving_answers_respects_the_ladder(client, monkeypatch, _clear):
    """q1=B is below q1's max, so q2 must not lift the level."""
    _install(monkeypatch)
    client.get("/founder/air")
    r = client.put("/founder/air/levers/user_needs", json={
        "q1_option": "B", "q2_option": "C", "q3_option": None, "criteria_checked": [],
    })
    un = next(l for l in r.json()["levers"] if l["lever"] == "user_needs")
    assert un["claimed_level"] == 2


def test_an_unknown_lever_is_404(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/air")
    r = client.put("/founder/air/levers/nonsense", json={
        "q1_option": "A", "q2_option": None, "q3_option": None, "criteria_checked": [],
    })
    assert r.status_code == 404


def test_submit_is_422_while_any_lever_is_unscored(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/air")
    client.put("/founder/air/levers/user_needs", json={
        "q1_option": "A", "q2_option": None, "q3_option": None, "criteria_checked": []})
    r = client.post("/founder/air/submit")
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "air_incomplete"
    assert "architecture" in r.json()["detail"]["missing"]
    assert "user_needs" not in r.json()["detail"]["missing"]


def _score_everything(client):
    for lever in cat.LEVER_KEYS:
        first = cat.QUESTIONS[lever][0]["options"][0]["id"]
        client.put(f"/founder/air/levers/{lever}", json={
            "q1_option": first, "q2_option": None, "q3_option": None,
            "criteria_checked": []})


def test_submit_flips_the_round_and_stamps_rollups(client, monkeypatch, _clear):
    fake = _install(monkeypatch)
    client.get("/founder/air")
    _score_everything(client)
    r = client.post("/founder/air/submit")
    assert r.status_code == 200, r.text
    assert r.json()["round"]["status"] == "submitted"
    row = fake.tables["vip_air_assessments"][0]
    assert row["status"] == "submitted"
    assert row["submitted_at"]
    assert row["overall_claimed"] == 1


def test_submitting_twice_is_conflict(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/air")
    _score_everything(client)
    client.post("/founder/air/submit")
    r = client.post("/founder/air/submit")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "air_already_submitted"


def test_answers_cannot_be_changed_after_submit(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/air")
    _score_everything(client)
    client.post("/founder/air/submit")
    r = client.put("/founder/air/levers/user_needs", json={
        "q1_option": "C", "q2_option": None, "q3_option": None, "criteria_checked": []})
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "air_already_submitted"


def test_another_users_round_is_not_reachable(client, monkeypatch, _clear):
    """Ownership comes from require_founder_access resolving the caller's own
    application, so a foreign round simply is not addressable."""
    fake = _install(monkeypatch)
    fake.tables["vip_air_assessments"].append({
        "id": "other", "application_id": "someone-else", "round_label": "FY26-27-Q1",
        "status": "draft"})
    r = client.get("/founder/air")
    assert r.status_code == 200
    assert r.json()["round"]["id"] != "other"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd .claude/worktrees/vip-onboarding/backend
/Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python -m pytest tests/test_air_endpoints.py -v --no-cov
```

Expected: FAIL — `ModuleNotFoundError: No module named 'app.routers.founder_air'`

- [ ] **Step 3: Write the request model**

Create `backend/app/models/air.py`:

```python
from __future__ import annotations

from pydantic import BaseModel, Field


class LeverAnswersIn(BaseModel):
    """One lever's three answers plus the criteria the founder ticked.

    Option ids are validated against the catalog in the router rather than here
    — the valid set depends on (lever, question), which the request model does
    not know.
    """
    q1_option: str | None = Field(default=None, max_length=2)
    q2_option: str | None = Field(default=None, max_length=2)
    q3_option: str | None = Field(default=None, max_length=2)
    criteria_checked: list[str] = Field(default_factory=list, max_length=32)
```

- [ ] **Step 4: Write the router**

Create `backend/app/routers/founder_air.py`, following the shape of `founder_resources.py`:

```python
"""ARTPARK Innovation Readiness (AIR) assessment — VIP only.

Gate: require_founder_access resolves the caller's own application, then this
router rejects any non-VIP track. Ownership is therefore structural — a founder
can only ever address their own round, because the application id comes from
the gate rather than from the request.
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status

from ..models.air import LeverAnswersIn
from ..services import air_catalog as cat
from ..services import air_query as aq
from ..services import air_scoring as sc
from ..supabase_client import get_admin_client
from .founder import require_founder_access

router = APIRouter(prefix="/founder/air", tags=["founder-air"])


def require_vip(ctx: Annotated[dict, Depends(require_founder_access)]) -> dict:
    """AIR is a VIP-programme instrument; TIR runs its own residency track."""
    if ctx["track"] != "sip":
        raise HTTPException(
            status_code=http_status.HTTP_409_CONFLICT,
            detail={"code": "not_available_for_track"},
        )
    return ctx
```

Then the endpoints:

```python
def _label() -> str:
    return aq.current_round_label(datetime.now(UTC).date())


def _persist_claimed_rollups(assessment_id: str, bundle: dict) -> None:
    roll = bundle["rollups"]["claimed"]
    get_admin_client().table("vip_air_assessments").update({
        "overall_claimed": roll["overall"],
        "tech_claimed": roll["technology"],
        "comm_claimed": roll["commercial"],
        "updated_at": datetime.now(UTC).isoformat(),
    }).eq("id", assessment_id).execute()


@router.get("")
async def get_air(ctx: Annotated[dict, Depends(require_vip)]) -> dict:
    return aq.assessment_bundle(ctx["application_id"], _label())


@router.put("/levers/{lever}")
async def put_lever(
    lever: str,
    body: LeverAnswersIn,
    ctx: Annotated[dict, Depends(require_vip)],
) -> dict:
    if lever not in cat.LEVER_KEYS:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND,
                            detail={"code": "unknown_lever"})
    label = _label()
    rnd = aq.ensure_round(ctx["application_id"], label)
    if rnd["status"] != "draft":
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT,
                            detail={"code": "air_already_submitted"})

    # Option ids are only meaningful per (lever, question), which the request
    # model cannot know — so validate here rather than in pydantic.
    answers = {"q1": body.q1_option, "q2": body.q2_option, "q3": body.q3_option}
    for q_id, opt in answers.items():
        if opt and cat.level_for_option(lever, q_id, opt) is None:
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"code": "invalid_option", "question": q_id, "option": opt},
            )

    sb = get_admin_client()
    sb.table("vip_air_lever_scores").update({
        "q1_option": body.q1_option,
        "q2_option": body.q2_option,
        "q3_option": body.q3_option,
        "criteria_checked": body.criteria_checked,
        "claimed_level": sc.lever_level(lever, answers),
        "updated_at": datetime.now(UTC).isoformat(),
    }).eq("assessment_id", rnd["id"]).eq("lever", lever).execute()

    bundle = aq.assessment_bundle(ctx["application_id"], label)
    _persist_claimed_rollups(rnd["id"], bundle)
    return bundle


@router.post("/submit")
async def submit_air(ctx: Annotated[dict, Depends(require_vip)]) -> dict:
    label = _label()
    rnd = aq.ensure_round(ctx["application_id"], label)
    if rnd["status"] != "draft":
        raise HTTPException(status_code=http_status.HTTP_409_CONFLICT,
                            detail={"code": "air_already_submitted"})

    bundle = aq.assessment_bundle(ctx["application_id"], label)
    missing = [l["lever"] for l in bundle["levers"] if l["claimed_level"] is None]
    if missing:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "air_incomplete", "missing": missing},
        )

    roll = bundle["rollups"]["claimed"]
    get_admin_client().table("vip_air_assessments").update({
        "status": "submitted",
        "submitted_at": datetime.now(UTC).isoformat(),
        "overall_claimed": roll["overall"],
        "tech_claimed": roll["technology"],
        "comm_claimed": roll["commercial"],
    }).eq("id", rnd["id"]).execute()

    return aq.assessment_bundle(ctx["application_id"], label)
```

Register in `backend/app/main.py` beside the other founder routers:

```python
app.include_router(founder_air_router.router)
```

with the matching import (`from .routers import founder_air as founder_air_router`).

- [ ] **Step 5: Run test to verify it passes**

```bash
cd .claude/worktrees/vip-onboarding/backend
/Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python -m pytest tests/test_air_endpoints.py -v --no-cov
```

Expected: PASS (12 tests)

- [ ] **Step 6: Run the founder + VIP regression**

```bash
cd .claude/worktrees/vip-onboarding/backend
/Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python -m pytest tests/test_founder_access.py tests/test_founder_crud.py tests/test_founder_mou.py tests/test_founder_query.py tests/test_founder_journey.py tests/test_founder_resources.py tests/test_vip_migration.py tests/test_vip_mou.py tests/test_vip_resources.py tests/test_vip_endpoint_isolation.py tests/test_founder_project_name.py tests/test_air_catalog.py tests/test_air_scoring.py tests/test_air_query.py tests/test_vip_air_migration.py tests/test_air_endpoints.py -q --no-cov
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/app/routers/founder_air.py backend/app/models/air.py backend/app/main.py backend/tests/test_air_endpoints.py
git commit -m "feat(vip): /founder/air — read the round, save lever answers, submit for verification"
```

---

### Task 6: Evidence upload

**Files:**
- Modify: `backend/app/routers/founder_air.py`
- Test: `backend/tests/test_air_evidence.py`

**Interfaces:**
- Produces:
  - `POST /founder/air/evidence` — multipart `file` plus form fields `lever`, `air_level`; stores at `air/{application_id}/{lever}/{air_level}/{filename}` in bucket `vip-founder-docs`; inserts a `vip_air_evidence` row stamped with the catalog's `doc_label`; returns the bundle
  - `DELETE /founder/air/evidence/{row_id}` — 404 unless the row belongs to the caller's round
  - `GET /founder/air/evidence/{row_id}/signed-url` — short-lived signed URL; 404 unless owned

Follow `backend/app/routers/evidence_files.py` for the `UploadFile = File(...)` pattern and the storage upload call.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_air_evidence.py`:

```python
"""Evidence uploads: stamped with the catalog's document label, owned by the
caller's own round, and never reachable across applications."""
from __future__ import annotations

import io

import pytest

from app.deps import get_current_user
from app.main import app
from tests.fixtures.fake_supabase import FakeSupabase


@pytest.fixture
def _clear():
    yield
    app.dependency_overrides.clear()


def _install(monkeypatch):
    from app.routers import founder as founder_router
    from app.routers import founder_air as air_router
    from app.services import air_query
    fake = FakeSupabase({
        "sip_applications": [{"id": "sapp1", "user_id": "u1", "status": "onboarded",
                              "submitted_at": "2026-07-01"}],
        "tir_applications": [],
        "vip_air_assessments": [], "vip_air_lever_scores": [], "vip_air_evidence": [],
    })
    monkeypatch.setattr(founder_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(air_router, "get_admin_client", lambda: fake)
    monkeypatch.setattr(air_query, "get_admin_client", lambda: fake)
    monkeypatch.setattr(air_router, "_upload", lambda *a, **k: None)
    app.dependency_overrides[get_current_user] = lambda: {
        "user_id": "u1", "email": "u1@x.com", "track": "sip", "roles": ["applicant"]}
    return fake


def _post(client, lever="architecture", level=2, name="arch.pdf"):
    return client.post(
        "/founder/air/evidence",
        files={"file": (name, io.BytesIO(b"%PDF-1.4 test"), "application/pdf")},
        data={"lever": lever, "air_level": str(level)},
    )


def test_upload_stores_a_row_stamped_with_the_catalog_document_label(client, monkeypatch, _clear):
    fake = _install(monkeypatch)
    client.get("/founder/air")
    r = _post(client)
    assert r.status_code == 200, r.text
    row = fake.tables["vip_air_evidence"][0]
    assert row["lever"] == "architecture"
    assert row["air_level"] == 2
    assert row["doc_label"] == "System Architecture Document"
    assert row["filename"] == "arch.pdf"
    assert "architecture" in row["storage_path"]


def test_uploaded_evidence_appears_on_its_lever_in_the_bundle(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/air")
    body = _post(client).json()
    arch = next(l for l in body["levers"] if l["lever"] == "architecture")
    assert [e["filename"] for e in arch["evidence"]] == ["arch.pdf"]


def test_upload_rejects_an_unknown_lever(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/air")
    assert _post(client, lever="nonsense").status_code == 404


def test_upload_rejects_a_level_outside_one_to_nine(client, monkeypatch, _clear):
    _install(monkeypatch)
    client.get("/founder/air")
    assert _post(client, level=0).status_code == 422
    assert _post(client, level=10).status_code == 422


def test_upload_for_a_level_with_no_document_defined_is_422(client, monkeypatch, _clear):
    """supply_chain AIR 1 has no qualifying document in the framework."""
    _install(monkeypatch)
    client.get("/founder/air")
    r = _post(client, lever="supply_chain", level=1)
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "no_document_required"


def test_delete_removes_the_row(client, monkeypatch, _clear):
    fake = _install(monkeypatch)
    client.get("/founder/air")
    _post(client)
    row_id = fake.tables["vip_air_evidence"][0]["id"]
    assert client.delete(f"/founder/air/evidence/{row_id}").status_code == 204
    assert fake.tables["vip_air_evidence"] == []


def test_another_applications_evidence_cannot_be_deleted(client, monkeypatch, _clear):
    fake = _install(monkeypatch)
    client.get("/founder/air")
    fake.tables["vip_air_evidence"].append({
        "id": "foreign", "assessment_id": "someone-elses-round", "lever": "architecture",
        "air_level": 2, "doc_label": "x", "storage_path": "p", "filename": "f.pdf"})
    assert client.delete("/founder/air/evidence/foreign").status_code == 404
    assert any(e["id"] == "foreign" for e in fake.tables["vip_air_evidence"])


def test_another_applications_evidence_has_no_signed_url(client, monkeypatch, _clear):
    fake = _install(monkeypatch)
    client.get("/founder/air")
    fake.tables["vip_air_evidence"].append({
        "id": "foreign", "assessment_id": "someone-elses-round", "lever": "architecture",
        "air_level": 2, "doc_label": "x", "storage_path": "p", "filename": "f.pdf"})
    assert client.get("/founder/air/evidence/foreign/signed-url").status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd .claude/worktrees/vip-onboarding/backend
/Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python -m pytest tests/test_air_evidence.py -v --no-cov
```

Expected: FAIL — 404/405 on `/founder/air/evidence`, and `AttributeError` on the `_upload` monkeypatch target.

- [ ] **Step 3: Implement the three endpoints**

In `backend/app/routers/founder_air.py` add a module-level `BUCKET = "vip-founder-docs"` and an `_upload(path, data, content_type)` helper mirroring `founder_mou._upload`, then the three endpoints. Ownership for delete and signed-url is enforced by resolving the caller's round first and requiring `assessment_id` to match it — never by trusting the row id alone.

Reject before storing: unknown lever → 404; `air_level` outside 1-9 → 422 `invalid_level`; `cat.required_document(lever, air_level)` returning `None` → 422 `no_document_required`.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd .claude/worktrees/vip-onboarding/backend
/Users/apple/Desktop/Final_AP_os/backend/.venv/bin/python -m pytest tests/test_air_evidence.py -v --no-cov
```

Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/routers/founder_air.py backend/tests/test_air_evidence.py
git commit -m "feat(vip): AIR evidence upload, delete and signed-url download"
```

---

## Phase exit criteria

- [ ] All six new suites green: `test_air_catalog.py`, `test_air_scoring.py`, `test_vip_air_migration.py`, `test_air_query.py`, `test_air_endpoints.py`, `test_air_evidence.py`.
- [ ] The Phase 1 founder/VIP suites still green — no regression.
- [ ] Full backend suite shows no NEW failures against the ~20 pre-existing baseline.
- [ ] Migration 044 applied to **staging** Supabase by the user, and the `vip-founder-docs` bucket confirmed present and private.
- [ ] `GET /founder/air` on staging returns a draft round with six levers for the VIP test founder, and 409s for a TIR founder.
