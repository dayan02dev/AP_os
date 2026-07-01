# AI 4-Section Analyst Blocks — Design Spec

> **Date:** 2026-07-01
> **Base:** `release/sip-launch-v1 @ f414bdf` (current prod code; read/implement in the `release-sip-launch-v1` worktree, deploy from an isolated worktree).
> **Status:** design approved in brainstorm; pending user spec-review → implementation plan.

## 1. Goal

Generate, per application (TIR **and** VIP/`sip`), four standardized AI analyst sections and show the **same content** in three staff surfaces — Leadership (AppDrawer), Reviewer (eval page), Admin (detail page) — between the existing **AI Summary** and **View Full Application** affordances. Replace the current ad-hoc problem/solution blocks with these four. Sections are produced by a new `SectionAgent` using the same `google/gemini-2.5-flash` / OpenRouter path as the existing scoring & summary agents.

The four sections (constant everywhere):

| key | Display label |
|---|---|
| `problem` | Problem Description |
| `solution` | Solution Description |
| `moats` | Moats & Technology Edge |
| `watchouts` | Watch-outs or Flags |

**Content shape:** each section is **3–5 short bullet "pointers"** (one line each), not a paragraph.

## 2. Non-goals

- No change to AI scoring, AI summary, classifier, or the `ai_screening` score columns.
- No change to reviewer/admin/leadership backend logic beyond one new payload field per detail endpoint.
- No change to the applicant wizard or the full schema-driven application view (`FullApplication`).
- The full raw applicant answers remain available behind **View Full Application** (unchanged).

## 3. Decisions (from brainstorm)

1. **Content = bullets** (3–5 per section). The provided prompts (paragraph-oriented) are adapted to emit bullets; the `SectionAgent` word-count validation is replaced with bullet-count/format validation.
2. **Rollout = auto-on-submit + backfill all existing (~480 apps)**, staging → prod (deploy user-gated).
3. **Admin:** insert the 4 sections below the AI summary; **keep** the existing "Reviewer Notes" accordion below them.
4. **Reviewer:** inline area shows **only** the 4 sections — remove the current fact-field strip *and* the applicant-answer accordions from the inline card.
5. **Leadership:** **AppDrawer only** (the "Problem & solution" collapsible). Full Review page unchanged.

## 4. Backend — generation

### 4.1 `SectionAgent` (`backend/app/services/ai_pipeline/section_agent.py`)
Adapt the user-provided `SectionAgent` to the real `BaseAgent` interface:
- `BaseAgent` has **no module-level `CACHE_DIR`**; caching is per-instance `self._cache_dir` (a `Path | None`). Remove the `from .base_agent import CACHE_DIR` import and the module-level per-section cache helpers; instead honor `cache_dir` passed to `__init__` (matching `ClassifierAgent`/`ScoringAgent`/`SummaryAgent`), writing one cache file per app via the base `_cache_path`/`_cache_read`/`_cache_write` (keyed by `self.name` = `"sections"`).
- Keep the **per-section validate→self-correct loop** using `self._call_api(messages)` and `self.MAX_CORRECT_ROUNDS`.
- Load the 4 prompts from `backend/app/services/ai_pipeline/section_prompts/{problem,solution,moats,watchouts}.txt`.
- **`run(app_id, app_text, *, mock=False, no_cache=False, **_)` → `(result_dict, flags_str)`** where `result_dict = { problem: [bullets], solution: [...], moats: [...], watchouts: [...] }` (lists of bullet strings) plus `*_count` counts.
- **`parse(raw)`** → split model output into a list of bullet strings: strip code fences, drop any leading `text`/`md` line, split on newlines, strip leading `- `/`* `/`• `/digit-dot markers, drop empties, trim.
- **`_validate_section(bullets)`** → fail if `<3` or `>5` bullets, or any bullet is empty / exceeds ~40 words. Correction message asks for exactly 3–5 one-line bullets, same analytical content.
- **`mock_result()`** → 4 bullets per section (used in tests, `mock=True`).

### 4.2 Prompts (adapted to bullets)
Preserve each provided prompt's analyst persona and analytical focus; change only the **output-format** instruction from "single paragraph" to "3–5 one-line bullets, nothing else." Final text lives in Appendix A and is written verbatim to the four `section_prompts/*.txt` files.

### 4.3 Pipeline integration (`ai_pipeline/pipeline.py`)
- Add a stage wrapper `_sections(app_id, app_text, *, cache_dir, no_cache)` → `SectionAgent(cache_dir=cache_dir).run(app_id, app_text=app_text, no_cache=no_cache)`.
- In `run_for_application`, after `_summarize`, call `_sections(...)` and attach the dict to the returned `ScoreResult` (new field).
- `ScoreResult` (`backend/workers/ai_screener/scoring.py`): add `sections: dict | None = None` (default keeps existing constructors/`_dc_replace` valid).
- In `persist(...)`, add `"sections": result.sections` to the `ai_screening` upsert `row`.

Because the SQS worker and the admin re-run endpoint (`routers/ai_screening.py`) both call `run_for_application` + `persist`, **submit / edit / admin re-run all regenerate sections automatically.**

### 4.4 Data model — migration `028_ai_sections.sql`
Next free number on the release branch is **028** (027 = `jury_review_decision`). Add:
```sql
ALTER TABLE ai_screening ADD COLUMN IF NOT EXISTS sections JSONB;
```
Shape (nullable until generated):
```json
{ "problem": ["…","…"], "solution": ["…"], "moats": ["…"], "watchouts": ["…"] }
```
Idempotent; written via the existing `ai_screening` upsert (`on_conflict=application_id,application_track`). Apply to staging first, then prod.

### 4.5 Backfill (`backend/scripts/backfill_sections.py`)
Mirror `rescore_all_applications.py` (disk cache under `.rescore_cache`/dedicated dir, resumable, per-track loop over all non-draft `tir_applications` + `sip_applications`). For each app: `build_app_text` → `SectionAgent.run` → **update only** `ai_screening.sections` for that `(application_id, application_track)` (do **not** re-score, re-summarize, or change status). Includes `--track`, `--limit`, `--no-cache`, `--dry-run` flags and progress logging. Idempotent (safe to re-run).

## 5. Backend — API surfacing

The DB source is `ai_screening.sections`. Reviewer and admin payloads are reshaped, so they expose a top-level **`aiSections`** field (name chosen to avoid the reviewer content payload's existing/deprecated `sections` key). Leadership returns the `ai_screening` object itself, so the drawer reads `ai_screening.sections` — no rename.

- **Reviewer:** `reviewer_query.fetch_application_for_reviewer(...)` — add top-level `aiSections` (= the app's `ai_screening.sections`) to the `/reviewer/applications/{track}/{id}/content` payload.
- **Admin:** `admin_query.fetch_detail(track, id)` — add `aiSections`; adapter `adaptDetail` maps it onto `s.aiSections`.
- **Leadership:** `GET /leadership/applications/{id}` (`leadership.py` / `applications_query`) — ensure the returned `ai_screening` block includes the new `sections` column (`select("*")` picks it up automatically; add `sections` explicitly if the select is column-scoped). AppDrawer reads `ai_screening.sections`.

All three already read `ai_screening`; this is a one-field addition each.

## 6. Frontend — shared component + surfaces

### 6.1 `frontend/src/components/AiSections.jsx` (new, shared)
Props: `{ sections, variant }` where `sections = { problem:[], solution:[], moats:[], watchouts:[] }` (or null) and `variant ∈ { "dropdown", "leadership" }`.

Section order + labels are a constant array inside the component:
`[["problem","Problem Description"],["solution","Solution Description"],["moats","Moats & Technology Edge"],["watchouts","Watch-outs or Flags"]]`.

- **`variant="dropdown"` (reviewer + admin):** one collapsible accordion per section — `▸`/`▾` disclosure "pointer", section label, optional bullet-count hint when collapsed. Body is a bullet list spanning **full card width** (no `max-width:70ch`). First section open by default. Uses new `.ai-sec*` classes (NOT the shared `.ps-*`).
- **`variant="leadership"`:** 4 **sub-headed blocks** (uppercase 11px labels matching current leadership styling) each with a bullet list, rendered inside the existing "Problem & solution" `Collapsible`.
- **Empty state:** hide any section whose bullet list is empty; if `sections` is null/all-empty (not yet backfilled or generation failed), render a subtle muted line ("AI sections not generated yet") rather than empty boxes.

### 6.2 Leadership — `pages/leadership/components/AppDrawer.jsx`
Remove `renderProblemSolution` (lines ~48–85). In the "Problem & solution" `Collapsible` (lines ~258–265), render `<AiSections variant="leadership" sections={aiScreening?.sections} />`. Position (below AI score, above Reviewer assignments) unchanged.

### 6.3 Reviewer — `pages/reviewer/v2/ReviewerEval.jsx`
Between the AI summary card (~463–468) and the View-Full-Application button (~514), replace the fact-field strip **and** the `.ps-sections` `longFields` accordions (~484–509) with `<AiSections variant="dropdown" sections={content.aiSections} />`. `content.fields`/`sections` no longer rendered inline (View Full Application unaffected — it uses `FullApplication`).

### 6.4 Admin — `pages/admin/platform/screens/AdminDetail.jsx`
In the Application Details card, insert `<AiSections variant="dropdown" sections={s.aiSections} />` directly below the AI summary (~337) and **above** the existing "Reviewer Notes" block (~340–362). Keep Reviewer Notes and the View-Full-Application button.

### 6.5 CSS / responsive ("all-device friendly")
New `.ai-sec`, `.ai-sec-head`, `.ai-sec-chev`, `.ai-sec-label`, `.ai-sec-hint`, `.ai-sec-bullets` classes (added to the reviewer + admin portal stylesheets; leadership sub-headed blocks reuse `.lp-*` label styling). Requirements:
- Bullets fill the card's full width (drop the 70ch cap that caused the right-hand whitespace).
- The eval/detail two-column grid (`.os-grid-evaluation`) collapses to a single column at a mobile breakpoint; accordion header rows have comfortable touch targets (min-height, adequate padding); bullets wrap cleanly.

## 7. Rollout sequence

1. Migration 028 on **staging** Supabase.
2. Deploy backend to staging (SectionAgent in pipeline; from an isolated worktree per SAM-deploy rule).
3. Run `backfill_sections.py` on staging; QA the three surfaces (desktop + mobile).
4. Migration 028 on **prod**; deploy backend to prod (**user-gated**); run backfill on prod.
5. Promote frontend to prod (Vercel).

## 8. Testing

- **Backend unit:** `SectionAgent.parse` (bullet splitting/markers), `_validate_section` (3–5 bound, length), `mock_result`; pipeline `run_for_application` attaches `sections`; `persist` writes `sections`; `backfill_sections` updates only the `sections` column.
- **Frontend:** `AiSections` renders both variants, bullet lists, empty/partial state; reviewer/leadership have `__tests__` dirs — add interaction + snapshot tests there.
- **Manual QA:** all three surfaces show identical section content; mobile layout has no right-hand whitespace and is touch-usable.

## 9. Risks & mitigations

- **Non-bullet LLM output** → `parse` normalizes + `_validate_section` + self-correct loop (≤3 rounds), best-effort kept.
- **Backfill cost/time** → Gemini Flash is cheap; disk cache makes it resumable; sections-only update avoids re-scoring.
- **`.ps-*` reuse breakage** → new `.ai-sec*` classes, leave `.ps-*` untouched.
- **Pre-backfill / failed apps** → empty-state handling in `AiSections`.
- **Deploy safety** → deploy from isolated worktree (SAM reads disk, not HEAD); intake-closed flags must stay true.

## 10. Open items

None blocking. Migration number (028) assumes no other release-branch migration lands first — re-check before applying.

---

## Appendix A — adapted bullet prompts (verbatim file contents)

**`problem.txt`**
> You are a forensic deeptech analyst and investment evaluator. Analyze the provided startup application text and output the Problem Description as 3 to 5 concise bullet points and nothing else. Do not include any introductory sentences, headers, markdown tags, labels, or transitional filler. Each bullet must be on its own line, begin with "- ", and be at most ~30 words. Focus entirely on the physical, biological, or architectural engineering bottleneck being targeted: the exact scientific or industry choke point (thermal limits, latency constraints, material degradation, system yield losses, etc.) and the absolute economic or strategic severity of leaving it unsolved. State the problem directly, with no setup.

**`solution.txt`**
> You are a forensic deeptech analyst and investment evaluator. Analyze the provided startup application text and output the Solution Description as 3 to 5 concise bullet points and nothing else. Do not include any introductory sentences, headers, markdown tags, labels, or transitional filler. Each bullet must be on its own line, begin with "- ", and be at most ~30 words. Explain precisely how the technology works across hardware, software, custom algorithms, or advanced materials; state the current validated baseline Technology Readiness Level (TRL); and explain how the architecture creates a 10x performance step-change or operational advantage over legacy incumbents. If information is missing or vague, name the missing architectural elements as bullets.

**`moats.txt`**
> You are a forensic deeptech analyst and investment evaluator. Analyze the provided startup application text and output the Moats and Technology Edge as 3 to 5 concise bullet points and nothing else. Do not include any introductory sentences, headers, markdown tags, labels, or transitional filler. Each bullet must be on its own line, begin with "- ", and be at most ~30 words. Analyze technical depth, talent rarity, and structural defensibility: rare domain expertise (robotics/AI), multi-disciplinary engineering synergy, proprietary simulation-to-real data pipelines, or deep hardware-software co-design that prevents easy replication by well-funded incumbents.

**`watchouts.txt`**
> You are a forensic deeptech analyst and investment evaluator. Analyze the provided startup application text and output the Watch-outs and Flags as 3 to 5 concise bullet points and nothing else. Do not include any introductory sentences, headers, markdown tags, labels, or transitional filler. Each bullet must be on its own line, begin with "- ", and be at most ~30 words. Call out the most critical structural vulnerabilities, risks, data gaps, or behavioral concerns: founder split-focus or part-time commitment, unclear IP separation from university labs, adoption/substitution friction with legacy infrastructure, or unverified physical scaling bounds.

## Appendix B — key file anchors (release worktree)

- `backend/app/services/ai_pipeline/{base_agent,pipeline,serialize}.py`; `prompts/`, new `section_prompts/`, new `section_agent.py`
- `backend/workers/ai_screener/scoring.py` (`ScoreResult`)
- `backend/migrations/028_ai_sections.sql` (new)
- `backend/scripts/backfill_sections.py` (new; pattern = `rescore_all_applications.py`)
- Reviewer: `reviewer_query.py`; `pages/reviewer/v2/ReviewerEval.jsx`
- Admin: `admin_query.py`; `pages/admin/platform/screens/AdminDetail.jsx`
- Leadership: `leadership.py`/`applications_query.py`; `pages/leadership/components/AppDrawer.jsx`
- Shared FE: `components/AiSections.jsx` (new); reviewer/admin portal CSS
