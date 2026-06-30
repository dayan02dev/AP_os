# Design — VIP industry filter counts + VIP industry/project-name backfill (prod)

**Date:** 2026-06-30
**Status:** Approved (design); pending user spec review → execution
**Surfaces:** Admin portal (Pipeline industry filter), `ai_screening` data for the VIP/SIP cohort
**Prod branch:** `release/sip-launch-v1` (worktree `.claude/worktrees/release-sip-launch-v1`, tip `9ba9e59`)

---

## 1. Problem (two requests)

1. **Industry filter counts are wrong.** In the admin Pipeline industry filter, the count badge on each chip is wrong — e.g. EdTech shows `6` but there are ~11 EdTech profiles. The *filter itself works* (clicking it returns the right apps); only the displayed number is wrong.
2. **VIP/SIP apps lack industry + good project names.** Most VIP applications show no industry ("—") in the pipeline, and their project names look like the generic TIR-style fallback rather than real venture names. The request: apply the *same* industry-classification + project-name algorithm used for TIR to VIP.

---

## 2. Root-cause analysis

### 2.1 Counts (request #1) — already fixed in code, not yet on prod

The numbers in the screenshot (`Robotics & Automation 48`, `Healthcare / MedTech 43`, … `EdTech 6`) are a **hardcoded `INDUSTRIES` array** in `frontend/src/pages/admin/platform/screens/AdminPipeline.jsx`.

Commit **`9ba9e59`** (`fix(admin-ui): industry filter shows real track-aware counts (drop hardcoded list)`) — already merged to `release/sip-launch-v1` — deletes that array and adds `industryCountsFor(rows, track)`, which computes real counts from the loaded pipeline rows, scoped to the selected track, excluding hidden/archived/"—". The pipeline loads up to `applications_query.FETCH_CAP` (5000) rows, so the count is over the **full cohort**, not a page.

**Conclusion:** the fix exists; it is **frontend-only and not yet promoted to Vercel prod**. The screenshot shows the pre-fix build.

### 2.2 VIP industry + names (request #2) — same algorithm, never run for VIP

The classification algorithm is **already shared** between tracks:
- The screener prompt (`backend/workers/ai_screener/openrouter_client.py`) and the backfill prompt (`backend/scripts/backfill_industry.py`) read `basic_full_name`, `basic_org`, `problem_describe`, `solution_describe`, `solution_core_tech`.
- **SIP shares those columns** — Sections 03 (Problem) and 04 (Solution) are common to TIR and SIP (`backend/migrations/011_sip_track.sql`, `backend/app/models/sip_application.py`). So the SIP prompt is *not* empty.

Why VIP industry/names are missing:
- The real-Gemini backfill was only ever run for **TIR** (the 240/240 TIR backfill at leadership cutover). VIP apps were **never** classified with the real model.
- Result: VIP `ai_screening` rows have **`industry_category_id = NULL`** → admin/leadership render industry as "—"; and **`project_name = NULL`** → the UI falls back to `stats.derive_project_name(row)` (a heuristic over `solution_describe`), which produces the generic "TIR-style" names the user dislikes.

**Confirmation that the admin re-run endpoint cannot fix this:** `POST /admin/ai-screening/run` (`backend/app/routers/ai_screening.py`) calls the **LangGraph** scorer (`app/services/ai_scoring/runner`), whose `persistence` layer **does not write `industry_category_id` or `project_name`** at all. Only the worker/backfill OpenRouter path sets those fields.

**Conclusion:** this is a **data-coverage gap, not an algorithm difference**. The fix is to *run* the existing classification for the VIP cohort.

---

## 3. Decision

- **Scope (user-selected):** industry + project name only; **preserve existing AI scores.**
- **Tool:** `backend/scripts/backfill_industry.py` — already exists (the `industry_categories` service it depends on is unit-tested; the script itself has no dedicated test). It iterates non-draft apps on **both tracks**, runs one Gemini (`google/gemini-2.5-flash`) call per app, and UPDATEs `ai_screening.industry_category_id` + `industry_confidence` + `project_name` only. Idempotent: skips apps already having **both** fields populated. It has been run before for staging; the prompt is identical in spirit to the validated TIR live-screener path.
- **No code changes, no SAM/Lambda/SQS deploy, no AWS creds.** The script talks directly to OpenRouter + the prod DB (service-role key).

### Why these choices
- Industry+name-only (vs full SQS re-screen) matches the request precisely, costs ~$0.001/app, and never disturbs the 5 component scores. `backfill_sip_ai_scores.py` (the SQS path) was rejected: it re-runs full scoring (overwriting scores), needs AWS, and only enqueues apps still in `submitted` status (it would skip VIP apps already past submit).
- A prod **dry-run** (read-only) is the safety gate instead of a staging rehearsal — the prompt is already validated on 240 prod TIR apps, so a dry-run sample review on the real corpus is the higher-signal check.

---

## 4. Runbook (execution plan with checkpoints)

> All commands run from the backend dir of the release worktree:
> `cd /Users/apple/Desktop/Final_AP_os/.claude/worktrees/release-sip-launch-v1/backend`

### Part 2 first (classify VIP), then Part 1 (promote) — so real counts are complete on first view.

**Step 0 — Prereqs / creds.**
`backfill_industry.py`'s dotenv loader reads `.env.staging`/`.env`, **not** `.env.prod`. So source prod creds explicitly into the shell (no code edit):
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (prod project `xtmszlpwgbyoumalgbhs`), `OPENROUTER_API_KEY` — taken from an existing `backend/.env.prod`.
Confirm the URL printed/used is the **production** Supabase before any write.

**Step 1 — Pre-write snapshot (rollback insurance).**
SELECT and save the current VIP `ai_screening` rows (`application_id, industry_category_id, industry_confidence, project_name`) to a timestamped file in the scratchpad. Most are expected to be NULL; the snapshot lets us restore if a classification is judged wrong.

**Step 2 — Prod DRY-RUN (read-only) — ⛔ REVIEW GATE.**
```
python scripts/backfill_industry.py --dry-run
```
Inspect the log: how many VIP (and any residual TIR) apps would be touched, and a sample of `would set ... industry=<id> name=<name>`. **Eyeball the sample for quality.** Do not proceed until the sample looks right.

**Step 3 — Full prod run.**
```
python scripts/backfill_industry.py
```
(Optionally `--limit N` for a first small batch, then full.) Writes industry + names for VIP and any TIR still missing. `slots_remaining = CATEGORY_CAP(12) − 12 = 0` → the script will **not create new categories**; VIP apps map into the existing 12-category taxonomy.

**Step 4 — Verify (Part 2).**
- Count VIP apps now having a non-null `industry_category_id` and `project_name`.
- Spot-check 5–10 VIP names + industries against the application text.
- Confirm the count of VIP apps still at "—" is small and explainable (genuinely ambiguous → `other`/NULL).

**Step 5 — Part 1: Vercel Promote-to-Production** (performed by user).
Promote the `9ba9e59` build to production. ⚠️ This ships the **full accumulated frontend delta** since the last prod promote (not just the counts fix) — recommend a 5-min visual QA of leadership/reviewer/admin after.

**Step 6 — Final verify (Part 1).**
In the live admin Pipeline → Filters → Industry: confirm chips show **computed** counts (e.g. EdTech reflects the real number), counts change with the TIR/VIP track toggle, and VIP apps now display real industries + clean names.

---

## 5. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Prod DB write is hard to undo | Step 1 snapshot of VIP `ai_screening` industry/name before writing |
| Wrong/over-eager classifications | Step 2 dry-run review gate on a real-corpus sample before any write |
| Unintended new industry categories | `slots_remaining = 0` (12/12 used) → script cannot create new categories |
| Accidentally overwriting a good name | Script only refreshes a name when the app is *included* (industry **or** name NULL); apps with **both** set are skipped. Dry-run reports any already-populated VIP apps |
| Hitting the wrong DB | Step 0 confirms the printed Supabase URL is production before writing |
| Promote ships more than the counts fix | Flagged; recommend post-promote visual QA |
| LLM cost | ~$0.001/app, ≈ $0.10–0.25 total for the VIP cohort |

---

## 6. Out of scope (explicitly not doing)

- Full re-screen of VIP (5 AI scores + summary) — user chose industry+name-only.
- Any code change to the screener prompt or the worker (the shared columns already feed it adequately; parity-with-TIR is the goal).
- Touching TIR apps that already have both fields (idempotent skip).
- New industry categories / taxonomy changes.

---

## 7. Verification checklist (done = shipped)

- [ ] Prod dry-run reviewed; sample classifications look correct
- [ ] VIP snapshot saved
- [ ] Full backfill run; N VIP rows updated, 0 unexpected failures
- [ ] VIP industry coverage materially improved (most no longer "—")
- [ ] VIP project names are real venture/what-it-does names, not TIR-style fallbacks
- [ ] `9ba9e59` promoted to Vercel prod
- [ ] Admin Pipeline industry chips show real, track-aware counts
- [ ] 5-min visual QA of the three portals post-promote
