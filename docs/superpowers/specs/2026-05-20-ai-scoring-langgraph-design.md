# ARTPARK OS — AI scoring + summary pipeline (LangGraph)

**Status**: draft for review
**Date**: 2026-05-20
**Branch**: `staging-role_based_dashboard`
**Scope**: Replace the stub-mode AI screening with a real LLM-driven scoring + summary pipeline that runs against every imported TIR application. Round 1 (application-only) ships in v1. Round 2 (application + psychometric / TSP) is forward-reserved but not implemented.

**Origin**: derived from a working session on 2026-05-20 walking through an external "TIR AI Summary" doc section-by-section. Every weighting, prompt structure, cross-check rule, and quality-gate check below either traces directly to a decision made in that session or is a structural simplification adopted because TSP doesn't exist for our build yet.

---

## 1. Goal

Today every imported TIR application in staging shows "AI screening not run yet" on the leadership review page because `ai_screening` rows are empty. Build a deployable pipeline that:

1. Reads each application's wizard answers + resume metadata
2. Produces five signal scores (0–10 each) with verbatim evidence citations + a confidence rating
3. Applies deterministic cap rules to catch claim-vs-evidence contradictions
4. Synthesises a 200-280 word jury-ready summary with VERDICT, TOP STRENGTH, TOP CONCERN, PROGRAM FIT, RECOMMENDATION
5. Persists everything to `ai_screening` so the leadership review surface stops showing stub data

Pipeline runs as a **LangGraph state machine** with a **LangChain provider abstraction** (Gemini Flash to start, swappable). Calibration against 10-20 hand-scored real applications happens **before** deployment.

---

## 2. Architecture

### 2.1 The LangGraph state machine

```
START
  │
  ▼
[Pass 1: extract_evidence]            LLM node — raw row → structured JSON evidence
  │
  ▼
[Pass 2: fan-out 5 scorers in parallel via Send]
  ├──[score_problem_impact]          LLM
  ├──[score_completeness]            LLM
  ├──[score_technical_depth]         LLM
  ├──[score_behavioural]             LLM (scored but 0% weight in composite)
  └──[score_commitment]              LLM
  │                                   (LangGraph fan-in: all 5 must complete)
  ▼
[Pass 3: apply_caps_and_confidence]   Python node — 7 cap rules + mean-of-5 confidence
  │
  ▼
[Pass 4: synthesize_round_1]          LLM node — 5-section summary
  │
  ▼
[quality_gate]                        Conditional Python edge
  │           │           │
  │           │           ▼
  │           │      done (write to ai_screening)
  │           ▼
  │      retry_synthesize (max 3) → back to Pass 4
  ▼
human_review_flag (after 3 retries) → persist last attempt + flag
```

**One LLM call per pass node × applications.** Total: 1 + 5 + 0 + 1 = **7 LLM calls per application** in the happy path (Pass 3 is Python only). With retries: up to 7 + 3 = 10. At Gemini Flash pricing, ~$0.04–$0.07 per application; ~$10-20 for the current 269 imported applications.

### 2.2 Graph state shape

```python
class ScoringState(TypedDict):
    # Inputs
    application_id: str
    track: Literal["tir", "sip"]
    application_row: dict             # raw tir_applications row
    resume_meta: dict | None          # tir_resume_uploads parsed_data if available

    # Pass 1 output
    evidence: dict                    # structured evidence graph

    # Pass 2 outputs (one slot per signal)
    score_problem_impact: SignalScore | None
    score_completeness: SignalScore | None
    score_technical_depth: SignalScore | None
    score_behavioural: SignalScore | None
    score_commitment: SignalScore | None

    # Pass 3 outputs
    caps_applied: list[CapEvent]      # audit trail of which rules fired
    composite_percentage: float       # weighted sum, 0-100
    strength_label: str               # EXCEPTIONAL / STRONG / ...
    confidence_overall: float         # mean of 5 factors

    # Pass 4 output
    summary_round_1: Round1Summary    # the 5-section JSON

    # Reserved for round 2 (always None in v1)
    tsp_context: dict | None

    # Quality gate bookkeeping
    qg_retries: int                   # 0..3
    qg_last_failures: list[str]       # which checks failed last attempt
    qg_needs_human_review: bool       # True after 3 retries

    # Metadata
    model: str                        # the LLM model name used
    started_at: datetime
```

### 2.3 LangChain provider abstraction

Single config knob:

```python
LLM_PROVIDER = os.environ.get("AI_SCORING_PROVIDER", "google")   # google | openai | anthropic
LLM_MODEL    = os.environ.get("AI_SCORING_MODEL", "gemini-2.5-flash")
LLM_TEMP_SCORE     = 0.0   # Pass 2 scorers — deterministic
LLM_TEMP_SYNTHESIZE = 0.3  # Pass 4 — slight creativity for prose without losing structure
```

Each pass node builds its LLM via `langchain.chat_models.init_chat_model(LLM_MODEL, model_provider=LLM_PROVIDER, temperature=...)`. Structured outputs enforced via Pydantic models passed to `.with_structured_output(...)`. Swapping providers requires no code changes outside config.

**Temperature discipline:** all Pass 2 scorers use `temperature=0` for reproducibility. Pass 4 synthesis uses `temperature=0.3` because prose at 0 reads stilted. Pass 1 evidence extractor uses `temperature=0` (purely mechanical work).

---

## 3. Five signals + final weights

| Signal | Weight | Object scored | Evidence (post-split) |
|---|---|---|---|
| Problem impact | **25%** | The project's problem | Q9, Q10 |
| Completeness & depth | **30%** | The application as artefact | Q11, Q15, Q16, Q17, Q20, Q21 |
| Technical depth | **25%** | The project's technical core | Q11, Q12, Q13, Q14, Q15, Q19, Q20, Q21 |
| Behavioural | **0%** (computed and stored; surfaced on post-psychometric dashboard only) | The person under failure/ambiguity | Q18, voice consistency across long-text Qs, CV |
| Commitment | **20%** | The person's readiness to execute 12-month residency | Q4, Q6, Q7, Q16, CV completion patterns |

**Composite percentage** = Σ(score × weight) / 10 × 100, computed in Python in Pass 3. The 100% sums across the 4 *weighted* signals only; Behavioural at 0% means it doesn't contribute.

**Strength bands** (applied deterministically to composite_percentage):

- ≥ 80% → **EXCEPTIONAL**
- 70-79% → **STRONG**
- 60-69% → **MODERATE**
- 50-59% → **WEAK**
- < 50% → **NON-COMPETITIVE**

---

## 4. Question-to-signal mapping (our wizard columns)

| External Q# | Our column | Required? | Feeds → |
|---|---|---|---|
| Q1-Q3 | `basic_full_name`, `basic_phone`, `basic_email` | req | — (identity / contact) |
| Q4 | `basic_org` | req | **Commitment** (cross-check vs stated intent) |
| Q5 | `basic_degree` | req | — (**dropped from scoring** per session decision; metadata only) |
| Q6 | `basic_has_team` | req | **Commitment** |
| Q7 | `basic_incubator_association` + `basic_incubator_details` | req | **Commitment** (conflict declaration) |
| Q8 | `basic_hear_about` | req | — (operational metric) |
| Q9 | `problem_describe` | req | **Problem impact** (primary), Technical depth (light) |
| Q10 | `problem_defined` | req | **Problem impact**, **Behavioural** (honesty cross-check) |
| Q11 | `solution_describe` | req | **Technical depth** (primary), **Completeness** |
| Q12 | `solution_core_tech` | req | **Technical depth** (primary) |
| Q13 | `solution_contrarian_insight` | opt | **Technical depth**, **Behavioural** |
| Q14 | `solution_stage` | req | **Completeness**, **Technical depth** (stage gate) |
| Q15 | `execution_will_break` | req | **Technical depth** (primary), **Completeness** |
| Q16 | `execution_milestone` | req | **Completeness** (primary), **Commitment** |
| Q17 | `execution_infrastructure` | req | **Completeness**, **Technical depth** |
| Q18 | `execution_failure` | opt | **Behavioural** ONLY (split — does NOT feed Commitment) |
| Q19 | `execution_hwsw_integration` | opt | **Technical depth**, **Behavioural** |
| Q20 | `evidence_files` (JSONB) | opt | **Technical depth**, **Completeness** — **presence/absence only in v1** (no OCR) |
| Q21 | `evidence_video_url` | opt | **Technical depth**, **Completeness** — **presence/absence only in v1** (no transcript) |
| Q22 | `declaration_*` (4 booleans) | req | — (submission gate; required to submit so non-differentiating) |

**Evidence-split discipline**: Behavioural reads Q18 + voice consistency + CV ONLY. Commitment reads Q4 + Q6 + Q7 + Q16 + CV completion patterns ONLY. No double-counting between the two person-level signals.

**Cross-Q signals** the LLM watches:
- Voice consistency across long-text answers (stylometric drift suggests AI-polished Q18)
- Internal consistency: Q14 stage claim vs Q20/Q21 evidence presence
- TAM/customer alignment: Q9 quantified pain vs Q11 implied customer

**Resume usage**: `tir_resume_uploads.parsed_data` (if `parse_status = 'completed'`) is passed to Behavioural + Commitment scorers. The parser already exists in the backend (`backend/app/services/resume_parser.py`). If parsing failed or was never attempted, both signals score with confidence dock.

---

## 5. Cross-check rules — Pass 3a (deterministic Python)

Seven rules apply caps on Pass 2 output. All are pure Python conditionals.

| ID | Trigger | Action |
|---|---|---|
| **C1** | `basic_incubator_association = "Yes"` AND no resolution language detected in `basic_incubator_details` | Commitment ≤ 3 + flag `c1_unresolved_incubator` |
| **C2** | `solution_stage` = "Deployed in real setting with real users" AND `evidence_files = []` AND `evidence_video_url IS NULL` | Tech depth ≤ 4 + flag `c2_deployed_no_evidence` |
| **C3** (modified) | `solution_core_tech` regex matches `/\bpatent`/i AND `evidence_files = []` | Tech depth ≤ 6 + flag `c3_patent_no_file` |
| **C5** | Sum of character lengths across all long-text columns < 200 | Completeness ≤ 2 + confidence_overall ≤ 0.3 + flag `c5_minimal_application` |
| **C6** | `solution_stage` ∈ {Prototype built, Pilot-ready product, Deployed} AND `evidence_files = []` AND resume_meta is None | Tech depth + Behavioural ≤ 4 + flag `c6_prototype_no_artefact` |
| **C7** | Regex `/\b10\s*[x×]/i` matches `solution_describe` OR `solution_core_tech` AND no numeric baseline detected within ±150 chars | Tech depth ≤ 7 + flag `c7_10x_no_baseline` |
| **C9** | `problem_defined = "Yes"` AND word count of `problem_describe` < 80 | Behavioural ≤ 5 + flag `c9_claimed_clarity_short_problem` |

**Dropped from doc**: C4 (Q18 absent → Behavioural cap-at-4) — Q18 is optional in our wizard; absence is not a punishment. C8 (voice mismatch) — stylometric analysis is a v2 capability.

**Caps stack**: if two rules cap the same signal, the lower cap wins (taking `min`).

**Audit trail**: every fired cap writes a `CapEvent` to `caps_applied` in state so the eventual `ai_screening.flags` JSONB has a complete record.

---

## 6. Pass 1 — Evidence Extractor

### 6.1 Purpose

Convert the raw `tir_applications` row + resume `parsed_data` into a normalised JSON object that all Pass 2 scorers consume. Keeps each scorer's prompt short and focused.

### 6.2 Input

Raw `tir_applications` row + optional `tir_resume_uploads.parsed_data`.

### 6.3 Output (Pydantic model)

```python
class EvidenceObject(BaseModel):
    basic: BasicEvidence       # name redacted, org, degree, team, incubator, hear_about
    problem: ProblemEvidence   # describe + defined
    solution: SolutionEvidence # describe, core_tech, contrarian_insight, stage
    execution: ExecutionEvidence # will_break, milestone, infrastructure, failure, hwsw
    evidence_assets: EvidenceAssets # file_count, file_names, file_types, video_url_present
    resume: ResumeEvidence | None  # cv_summary, completion_patterns
    derived: DerivedEvidence   # char_counts, word_counts, regex_flags
```

### 6.4 The prompt

The Pass 1 LLM is asked only to:
- Strip identifying info (`basic_full_name`, `basic_phone`, `basic_email`) — return placeholders
- Summarise resume into a 100-word `cv_summary` + a structured `completion_patterns` list (count of completed projects, count of abandoned, role gaps in months)
- Pre-compute character/word counts on each long-text answer
- Surface regex matches for "10x" / "10×" / "patent" / numeric baselines so Pass 3 rules can fire deterministically

The wizard answer text itself passes through verbatim; the LLM is not summarising or rewriting it. Citations in Pass 2 must remain verbatim quotes from the original wizard answers, not the Pass 1 paraphrase.

---

## 7. Pass 2 — Five scoring prompts

### 7.1 Common output schema (Pydantic)

```python
class SignalScore(BaseModel):
    signal: Literal["problem_impact", "completeness", "technical_depth",
                    "behavioural", "commitment"]
    score: int = Field(ge=1, le=10)
    rationale: str    # 2-4 sentences, evidence-anchored
    evidence_citations: list[Citation]  # verbatim quotes with source Q-id
    confidence_factors: ConfidenceFactors
    flags: list[str]  # informational, NOT cap-applying

class ConfidenceFactors(BaseModel):
    data_completeness: float       = Field(ge=0, le=1)
    evidence_specificity: float    = Field(ge=0, le=1)
    internal_consistency: float    = Field(ge=0, le=1)
    verifiability: float           = Field(ge=0, le=1)
    answer_granularity: float      = Field(ge=0, le=1)
```

### 7.2 Prompt structure (same for all 5)

Each prompt has:
1. **What this scores** — object + evidence pool
2. **Score ladder anchors** — concrete descriptions of 10, 7, 4, 1
3. **Decision procedure** — numbered steps
4. **"Do not" list** — common failure modes to avoid
5. **Worked examples** — 2-3 per signal, real excerpts + assigned score + one-sentence reasoning (these are **added during calibration**, not present in the initial template)

### 7.3 Per-signal evidence pool + key anchors

**Problem impact** — reads Q9, Q10.
Anchors: 10 = specific population named, quantified pain, "why now" trigger, Q10 honesty matches Q9 detail. 4 = friction not pain, no quantification. 1 = no specific victim.

**Completeness & depth** — reads Q11, Q15, Q16, Q17, Q20, Q21.
Anchors: 10 = all required answered substantively, Q15/Q16/Q17 specific + milestone-linked, evidence present. 4 = required answered but multiple generic. 1 = minimal (<200 chars). **Critical "do not"**: "Don't penalise self-taught applicants for less formal writing if substance is present."

**Technical depth** — reads Q11, Q12, Q13, Q14, Q15, Q19, Q20, Q21.
Anchors: 10 = specific lab-proven advance + metricised 10× with named baseline, genuine moat. 4 = generic ("we use AI/ML"). 1 = no technical content.

**Behavioural** — reads Q18 + voice consistency (across Q9, Q11, Q12, Q15, Q16, Q17, Q19) + CV summary. Does NOT read Q11/Q15/Q16/Q17 directly for substance — only for voice comparison against Q18.
Anchors: 10 = Q18 names specific failure + cause + decision + measurable change, voice consistent. 4 = generic reflection, buzzword-heavy. 1 = Q18 absent OR boilerplate throughout.
**No "≤ 7 if Q18 absent" self-cap** (removed from doc's prompt). Behavioural at 0% weight in v1; rigour is lower than other signals.

**Commitment** — reads Q4, Q6, Q7, Q16, CV completion patterns ONLY. Does NOT read Q18.
Anchors: 10 = Q4 consistent with stated intent, Q6 team clarity, Q7 no active conflicts, Q16 quarterly milestones outcome-linked. 4 = Q6 unclear, Q7 unresolved active commitment, Q16 vague. 1 = Q4/Q6 contradict, Q16 absent.
**Critical "do not"**: "Don't penalise solo founders. Solo is not a commitment risk; unclear roles are."

### 7.4 Calibration (Path A — pre-deployment)

Before the prompts above ship to production:

1. Hand-score 10-20 of the 269 imported real applications with 2 reviewers (lead + manager, or 2 leadership users) independently using **rubrics only — no LLM involvement**
2. Reconcile reviewer disagreements until convergence (typically 2-3 iterations refining the rubrics)
3. Extract 2-3 worked examples per signal — short excerpt + assigned score + one-sentence reasoning
4. Embed worked examples in Pass 2 prompts → prompts become **v1.0, deployable**
5. Validate on a held-out 5-10 applications. Require LLM-vs-reviewer agreement within ±1 on the 10-scale for ≥ 80% of scores

**Synthetic examples are forbidden.** Real hand-scored applications only.

---

## 8. Pass 3 — Caps + Confidence (Python only)

### 8.1 Caps

Apply the 7 rules from §5 in declaration order. Each rule reads (`evidence_object`, `pre_cap_scores`), decides whether to fire, and if so emits a `CapEvent`:

```python
class CapEvent(BaseModel):
    rule_id: Literal["C1", "C2", "C3", "C5", "C6", "C7", "C9"]
    triggered_at: datetime
    signal_capped: list[str]    # which signal(s) got their score capped
    cap_value: int              # the new ceiling
    evidence_snippet: str       # the verbatim snippet that triggered
    flag: str
```

After all rules run, apply caps to scores: `final_score = min(pre_cap_score, all_applicable_caps)`.

### 8.2 Composite

```python
WEIGHTS = {
    "problem_impact": 0.25,
    "completeness":   0.30,
    "technical_depth": 0.25,
    "behavioural":    0.00,   # scored, not weighted
    "commitment":     0.20,
}

composite_percentage = sum(scores[s] * w for s, w in WEIGHTS.items()) * 10
# scores are 0-10; weights sum to 1.0; ×10 gives 0-100
```

### 8.3 Strength label

Deterministic lookup against composite_percentage using the 5 bands from §3.

### 8.4 Confidence (mean of 5)

```python
confidence_overall = mean([
    data_completeness, evidence_specificity, internal_consistency,
    verifiability, answer_granularity,
])
# Each factor is the mean across the 5 signals' confidence_factors
```

If C5 fired, `confidence_overall ≤ 0.3` (hard ceiling).

### 8.5 No LLM in Pass 3

Pass 3b (LLM cross-signal contradiction detection) is **skipped in v1** per session decision. Caps + composite + confidence is sufficient deterministic post-processing.

---

## 9. Pass 4 — Round 1 Synthesis (LLM)

### 9.1 Output schema

```python
class Round1Summary(BaseModel):
    verdict: str             # 1 sentence
    top_strength: str        # 2-3 sentences
    top_concern: str         # 2-3 sentences
    program_fit: str         # 2-3 sentences
    recommendation: str      # 1 sentence, ALL CAPS verb
```

### 9.2 The synthesize prompt

Inputs in state to the LLM:
- 5 final scores (post-cap)
- 5 rationales + verbatim citations
- composite_percentage + strength_label
- confidence_overall
- caps_applied (list of CapEvent — surfaces in TOP CONCERN)
- ARTPARK infrastructure reference doc (loaded into system prompt — see §9.4)

Section rules:
- **VERDICT** (1 sentence): exact format `"This is a <STRENGTH_LABEL> application for the TIR Track."`
- **TOP STRENGTH** (2-3 sentences): synergy logic — if two signals both ≥ 8, pair into a narrative. Cite one specific evidence detail.
- **TOP CONCERN** (2-3 sentences): priority — critical flags (any `caps_applied`) > weakest weighted signal (Behavioural excluded since 0% weight) > internal contradictions surfaced in rationales. Name specific evidence gap + downstream consequence.
- **PROGRAM FIT** (2-3 sentences): three connections — institution → ARTPARK infrastructure (specific match via Q17), stage → programme design, problem → ARTPARK mission.
- **RECOMMENDATION** (1 sentence): ALL CAPS verb. ACCEPT requires `"within X days"` condition. WAITLIST names promotion trigger. REJECT cites fatal gap.

**Strict prohibitions:**
- No raw score numbers in prose (`/10`, `out of 10` forbidden)
- No weasel words: very, quite, somewhat, consider, maybe, might, possibly
- Passive voice density ≥ 10% triggers regeneration
- No TSP reference (round 2 only)

### 9.3 Quality gate (post-Pass 4)

10 deterministic checks, pure Python:

| # | Check | Pass condition | Fail action |
|---|---|---|---|
| 1 | Word count | 200-280 | Regenerate whole summary |
| 2 | Section count | Exactly 5, in correct order | Regenerate |
| 3 | No score numbers in prose | Zero `/10` or `out of 10` matches | Regenerate |
| 4 | ≥ 1 specific entity per section | Quantitative or named reference | Regenerate |
| 5 | RECOMMENDATION ALL CAPS verb | One of ACCEPT/WAITLIST/REJECT/HOLD | Regenerate |
| 6 | ACCEPT has time-bound condition | `within \d+ days` regex matches | Regenerate |
| 7 | REJECT has named fatal gap | Specific gap sentence present | Flag for human review |
| 8 | No weasel words | Zero matches on banned list | Regenerate |
| 9 | Passive voice < 10% | Density check via simple tagger | Flag for editor (do not regenerate) |
| 10 | ARTPARK value-add in PROGRAM FIT | Reference to a documented ARTPARK infrastructure asset | Regenerate |

**Retry policy:** failed gate → regenerate whole summary with the failing rules listed in the regeneration prompt. Max **3 retries**. After 3 fails, persist last attempt and set `qg_needs_human_review = True`.

### 9.4 ARTPARK infrastructure reference doc

A static markdown file (`backend/app/services/ai_scoring/artpark_assets.md`) lists what ARTPARK actually offers. The example below is a placeholder — the real asset list must be confirmed with leadership before deployment:

```markdown
# ARTPARK assets available to TIR residents (PLACEHOLDER — confirm with lead)
- GPU cluster (training perception models)
- 6-DOF motion-capture arena
- CNC + 3D-printing for hardware iteration
- Wet labs (biology / materials testing)
- Robotics testbeds
- Pilot-customer network (manufacturing / agritech / healthcare / defense)
- Translational R&D mentors in residence
```

Loaded into every Pass 4 system prompt so the LLM can match Q17 asks to specific assets when writing PROGRAM FIT. Confirming the real list with the lead is a deployment-blocking step (see §16 acceptance criteria).

---

## 10. Database changes

### 10.1 Signal → column mapping

| Signal | `ai_screening` column |
|---|---|
| Problem impact | `score_problem` |
| Completeness & depth | `score_completeness` (renamed from `score_solution` — see migration below) |
| Technical depth | `score_tech` |
| Behavioural | `score_founders` (existing column name retained — labelled "Behavioural signal" in the UI) |
| Commitment | `score_commitment` |
| (none — reserved) | `score_integrity` — stays in schema, never written, documented as legacy |
| Composite | `score_overall` (computed in Pass 3 from the weighted sum) |
| Confidence (mean of 5) | `confidence` (numeric(4,3), stores the overall confidence as a 0.0-1.0 decimal) |
| Confidence factors (5 individual) + cap events | `flags` JSONB — stored as `{"confidence_factors": {...}, "cap_events": [...]}` |
| Summary (5-section Round 1 JSON) | `summary` (existing TEXT column; we write the JSON.dumps of `Round1Summary`) |
| Provider transcript | `raw_response` (existing TEXT column; full Pass 4 LLM response for audit) |
| Model + ran_at | `model`, `ran_at` (existing) |
| Errors | `error` (existing) |

### 10.2 Migration 016: rename `score_solution` → `score_completeness`

```sql
-- backend/migrations/016_rename_score_solution_to_completeness.sql
begin;

alter table public.ai_screening
  rename column score_solution to score_completeness;

comment on column public.ai_screening.score_completeness is
  'Completeness & depth signal (0-10). Renamed from score_solution on 2026-05-20 '
  'to align with the AI scoring spec at docs/superpowers/specs/'
  '2026-05-20-ai-scoring-langgraph-design.md.';

comment on column public.ai_screening.score_integrity is
  'RESERVED / unused in v1. The current AI scoring spec has no Integrity signal. '
  'Column retained to avoid disruptive migrations; do not write.';

commit;
```

### 10.3 Frontend changes (one each in two files)

- `frontend/src/pages/leadership/review/AIScreeningPanel.jsx` — change `score_solution` to `score_completeness` in `CATEGORY_BARS`
- `frontend/src/pages/leadership/review/ReviewsTab.jsx` — same change

### 10.4 Resume parser hookup

`backend/app/services/resume_parser.py` already exists and produces `tir_resume_uploads.parsed_data` JSONB. Pass 1 reads this when present, gracefully degrades when absent (parsing failed or never run).

---

## 11. Backend module layout

```
backend/app/services/ai_scoring/
├── __init__.py
├── graph.py              ← LangGraph state machine assembly
├── state.py              ← ScoringState TypedDict + Pydantic models
├── nodes/
│   ├── extract_evidence.py    ← Pass 1
│   ├── score_signals.py       ← Pass 2 (one factory function, 5 instances)
│   ├── apply_caps.py          ← Pass 3a (caps)
│   ├── compute_confidence.py  ← Pass 3b (confidence + composite)
│   ├── synthesize.py          ← Pass 4
│   └── quality_gate.py        ← Conditional edge logic
├── prompts/
│   ├── extract_evidence.txt   ← Pass 1 prompt template
│   ├── signals/
│   │   ├── problem_impact.txt
│   │   ├── completeness.txt
│   │   ├── technical_depth.txt
│   │   ├── behavioural.txt
│   │   └── commitment.txt
│   └── synthesize_round_1.txt
├── caps.py               ← The 7 cap rules as pure functions
├── artpark_assets.md     ← Reference doc loaded into Pass 4
├── persistence.py        ← Writes final state to ai_screening
└── runner.py             ← Top-level "score_application(application_id)" entry point

backend/app/routers/
└── ai_screening.py       ← (modify) trigger endpoint that invokes runner

backend/tests/ai_scoring/
├── conftest.py           ← Fake LLM via langchain.chat_models.fake.FakeMessagesListChatModel
├── test_caps.py          ← Each of the 7 cap rules
├── test_composite.py     ← Weighting math + strength bands
├── test_confidence.py    ← Mean-of-5 + C5 ceiling
├── test_quality_gate.py  ← 10 checks each with pass + fail cases
├── test_state_machine.py ← Full graph end-to-end with fake LLM
└── test_persistence.py   ← Roundtrip to ai_screening
```

---

## 12. Operational characteristics

### 12.1 Where it runs

- Async job inside the existing FastAPI backend (not the wizard request path)
- Triggered manually for now via an admin endpoint: `POST /admin/ai-screening/run?track=tir&limit=N` (or `application_id=<uuid>` for single-row reruns)
- Future: triggered automatically on submit transition (after migration 015's `submitted → ai_screening` status flip)

### 12.2 Env vars

```bash
AI_SCORING_ENABLED=true          # global on/off; false reverts to stub behaviour
AI_SCORING_PROVIDER=google
AI_SCORING_MODEL=gemini-2.5-flash
AI_SCORING_DRY_RUN=false         # if true, runs the graph but doesn't write to ai_screening
GOOGLE_API_KEY=...               # or OPENAI_API_KEY, ANTHROPIC_API_KEY depending on provider
```

### 12.3 Observability

- Every graph run logs to a per-run transcript at `backend/scripts/ai-scoring/runs/<application_id>-<timestamp>.json` (gitignored)
- Transcript contains: state snapshots at each node boundary, every LLM call's request + response + token count, every cap event, all quality-gate decisions
- **PII handling in transcripts**: state snapshots are taken AFTER Pass 1 (which strips `basic_full_name`, `basic_phone`, `basic_email`). Raw pre-Pass-1 input is never written to disk. The application_id is the only correlation key in transcripts.
- Cost tracking: each run logs total tokens + estimated cost into a daily aggregate at `backend/scripts/ai-scoring/cost-YYYY-MM-DD.jsonl` (gitignored), so we can do per-cohort cost analysis without polluting `ai_screening` row payloads

### 12.4 Failure handling

- LLM timeout / rate-limit: exponential backoff (LangChain default), max 3 attempts per call. After 3 attempts the node fails; the graph terminates and the application gets a placeholder `ai_screening` row with `error = 'llm_unavailable'`
- Schema validation failure (Pydantic): the node loops back up to 2 times with the validation error in the next prompt. After 2 loops, abort and write `error`
- Quality gate fails 3× in Pass 4: persist last attempt + flag `qg_needs_human_review`

---

## 13. Round 2 (TSP) — forward-reserved seams

Round 2 synthesis is **not implemented in v1**. To avoid restructuring later:

1. `ScoringState.tsp_context` slot exists from day one, always `None` in v1.
2. The synthesize node checks for it: if `None`, use round-1 prompt path; if populated in a future version, the node would dispatch to the round-2 prompt path. In v1 the round-2 branch raises `NotImplementedError` if exercised — keeping the seam honest.
3. The summary output is a Pydantic discriminated union `Round1Summary | Round2Summary`. v1 only emits `Round1Summary`. The DB column (`ai_screening.summary` TEXT) stores `json.dumps(...)` of whichever shape arrived; the dashboard renders whichever keys are present.
4. Integration-state classifier (the 6 states: agree / rescues_grit / rescues_trd / catches / catches_coachability / neutral) is **not built** in v1. Adding it later requires only a single new Python module — no graph restructure.

When TSP eventually ships, the work is: write the round-2 prompt template, implement the integration-state classifier, add round-2 quality-gate checks. No state-machine restructure, no DB migration.

---

## 14. Out of scope for v1 (explicit deferral list)

- Round 2 synthesis + TSP integration
- Integration-state classifier
- LLM contradiction detection (Pass 3b)
- Voice / stylometric analysis (C8 + any Behavioural-prompt enforcement of voice consistency beyond what the LLM detects naturally)
- Evidence file content extraction (OCR for Q20)
- Video transcript extraction (Q21)
- Candidate-facing summary variant — applicants don't see AI output in v1
- Cohort-level recalibration of weights / thresholds (revisit after first 50 real scorings)
- Section-level regeneration in the quality gate (regenerate whole summary instead)
- Automatic triggering on submit (manual / admin-triggered in v1)

---

## 15. Risks

| Risk | Mitigation |
|---|---|
| Calibration takes longer than planned, blocks deployment | Hand-scoring is the rate-limit. Start immediately on the 269 imported real applications. 2 hours per reviewer for 10 apps is realistic. |
| LLM scores vary run-to-run on the same input | Worked examples in prompts (Path A calibration) materially reduce this. We also set `temperature=0` on all Pass 2 + Pass 4 LLM calls. |
| Self-taught applicants get systematically penalised by Completeness & depth at 30% | Risk acknowledged. Prompt explicitly says "Don't penalise self-taught applicants for less formal writing if substance is present." Monitor distribution post-deployment; recalibrate weight to 20% if bias surfaces. |
| Behavioural at 0% weight feels wrong to reviewers ("why does the system score it at all?") | Surface Behavioural on the post-psychometric dashboard (separate from round-1 leadership view). Round-1 leadership dashboard explicitly does not show Behavioural's contribution to the composite. |
| Cost overrun if reruns happen frequently | At ~$0.05/app × 269 apps = $13.50 per full cohort rerun. Cheap. Per-app reruns trivial. |
| LangGraph version-drift breaks pipeline | Pin LangGraph + LangChain versions in requirements.txt. Add version assertions to graph.py startup. |
| Worked examples ageing (later cohorts write differently) | Recalibrate every 1-2 cohorts. Add this to the operational runbook. |
| Quality gate's "passive voice < 10%" requires a parser | Use `nltk.pos_tag` or a tiny dedicated heuristic. Not perfect but good enough. |
| Provider outages (Gemini down) | Provider abstraction makes failover possible. Operational follow-up: define a failover order (Google → Anthropic → OpenAI) and a kill switch (`AI_SCORING_ENABLED=false` reverts to stub data). |

---

## 16. Acceptance criteria

This v1 ships successfully when:

1. ⬜ Migration 016 lands cleanly on staging. `score_completeness` exists; frontend reads from it; nothing else broken.
2. ⬜ Calibration loop run: 10-20 real applications hand-scored by 2 reviewers, reconciled to convergence, 2-3 worked examples per signal extracted, embedded in prompts.
3. ⬜ Held-out validation: LLM-vs-reviewer agreement within ±1 on the 10-scale for ≥ 80% of scores across the 5-10 held-out applications.
4. ⬜ Backend unit tests pass: caps (7 rules × pass-and-fail = 14+ cases), composite math, quality gate (10 checks × pass-and-fail = 20+ cases), state machine end-to-end with fake LLM.
5. ⬜ Dry run on 3 real applications, full transcript reviewed by lead. No "needs_human_review" flags trip.
6. ⬜ Run the full pipeline against all 269 imported real applications. `ai_screening` table populates. Composite distribution looks reasonable (rough expectation: ~5% EXCEPTIONAL, ~25% STRONG, ~35% MODERATE, ~25% WEAK, ~10% NON-COMPETITIVE — give-or-take).
7. ⬜ Leadership review page renders real composite + bar breakdown + summary for every application. No "AI screening not run yet" messages on imported apps.
8. ⬜ `AI_SCORING_ENABLED=false` cleanly reverts to stub behaviour (rollback path verified).
9. ⬜ Cost report: total tokens + dollars logged. Under $20 for the 269-app initial run.

---

## 17. What this design intentionally does NOT include

- Any UI changes beyond the two-file column rename (frontend dashboards already render whatever's in `ai_screening`)
- Any wizard changes (no new questions, no question deletions)
- Any change to the existing `applications_query.py` or leadership routers (they already return `ai_screening` rows)
- Any automatic invocation on wizard submit (deferred to a later phase; v1 is admin-triggered)
- Any SIP support (prod has no SIP applications; this design is TIR-only)
- Any change to the seed script `backend/scripts/seed_staging.py` (seed apps stay at stub scoring; only imported real apps get this pipeline)

---
