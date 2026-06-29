# Admin portal — six fixes — design spec

**Date:** 2026-06-29
**Surface:** Admin portal only (`frontend/src/pages/admin/platform/*`) + backend `admin_query.py` / `admin_platform.py`.
**Scope:** Frontend + backend. Backend SAM deploy required (changes 3 & 5). **No DB migration.**

## Goal

Six user-requested fixes to the admin portal:

1. **Dashboard card cleanup** — remove the "70% of submissions" subtitle from the **Under review** KPI card and the "Preview — backend pending" badge from the **Jury evaluation** KPI card.
2. **"Clear filters" on the Applications page** — add a Clear-filters affordance in the filter bar that matches leadership's.
3. **Reviewer Score column** — it is always "—" today; make it show the real per-application reviewer score (weight-adjusted average).
4. **Status filter** — remove the **AI screening** option from the STATUS filter.
5. **Batch column** — assigning an application to a batch from the column must fan out to that batch's reviewers (create assignments + email) so it is reflected in the reviewer roster and the reviewer's queue.
6. **Reviewer roster "Last activity"** — render the raw ISO timestamp as a human-readable absolute date + time in IST.

## Decisions (locked with the user)

- **#3 aggregation:** weight-adjusted average — `Σ(reviewer_weight_i × weightedOverall_i) / Σ(reviewer_weight_i)`, where `reviewer_weight_i` is the reviewer's roster weight (`reviewer_profiles.weight`, default `1.0`) and `weightedOverall_i` is that review's 5-dimension weighted score. Only **submitted** reviews count.
- **#5 fan-out:** additive — assigning an app to a batch creates assignments for the batch's **current** reviewers and emails them; moving an app between batches does **not** strip the previous batch's assignments.
- **#6 format:** absolute date + time in **Asia/Kolkata (IST)**, e.g. `29 Jun 2026, 10:39 AM`.

## Current state (grounding)

- **Dashboard** (`screens/AdminDashboard.jsx`): reviewer-mode KPI cards. UNDER REVIEW subtitle is at `:218` (`{totalSubmitted ? Math.round(inReview / totalSubmitted * 100) : 0}% of submissions`). JURY EVALUATION card is `:225-231`; its `<PreviewBadge />` block is `:228-230`. A separate **jury-mode** dashboard view has its own `<PreviewBadge />` at `:179` — **out of scope, left as-is**.
- **Pipeline** (`screens/AdminPipeline.jsx`):
  - `STATUSES` array `:77-91`; the AI-screening entry is `:80-81` (`{ id: 'ai-screening', label: 'AI screening', color: '#3213b7' }`).
  - `hasFilters` (`:217`) already covers search + track + status + industry + batch; `clearAll()` (`:218-224`) already resets all five. The only existing "Clear all" lives inside the applied-pills row (`:864`), which renders only when `activeChips.length > 0` — and `activeChips` (`:325-329`) covers only status/industry/batch, so a bare track or search filter shows no clear affordance.
  - Filters toggle button is `:841-850`; the `{filtered.length} of {S.length}` count is `:852`.
  - Reviewer-score column header `:991` (`renderHeader('Reviewer score', 'rev', true)`); cell `:1021-1027` already renders `s.rev && s.rev.overall != null ? <b>{s.rev.overall.toFixed(1)}</b> : '—'`; sort on `'rev'` is `:302-304`.
  - Per-row batch dropdown `:1067-1078` → `changeIndividualBatch(s, val)` (`:438-464`). Bulk "Assign batch…" floating action `:1229-1242` → `applyBatchToSelected(val)` (`:392-435`). **Both** call `adminPlatformApi.assignBatch(batchId, { items })` = `POST /admin/platform/batches/{id}/applications`.
- **Adapter** (`lib/adminDataAdapter.js`): `adaptPipelineRow` (`:20-41`) hard-codes **`rev: undefined`** (`:28`) — so the Reviewer Score column is "—" by construction regardless of backend. `adaptReviewer` (`:86-92`) maps `last: r.lastActivity` (`:91`).
- **Roster** (`screens/AdminReviewers.jsx`): "Last activity" cell renders raw `{r.last || '—'}` at `:751` (reviewer mode) and `:577` (jury mode). The jury mock supplies relative strings like `'2h ago'` (`:32-35`).
- **Backend pipeline** (`services/admin_query.py`, `fetch_pipeline` `:186-298`): builds each row at `:275-290` with `ai_score_overall` (`:283`) and `batch` (`:288`) but **no reviewer score**. It fetches ai_scores + batches, not reviews.
- **Backend roster** (`services/admin_query.py`, `fetch_roster` `:405-565`): `last_activity` is computed `:528-532` as the max `submitted_at` over the reviewer's submitted reviews — a raw ISO string. Reviewer weight comes from `reviewer_profiles` (`rp` at `:554`).
- **Backend batch assign** (`routers/admin_platform.py`):
  - `assign_applications` (`POST /batches/{id}/applications`, `:336-375`): upserts `application_batches` only — **no `reviewer_assignments`, no email**.
  - `assign_batch_reviewers` (`POST /batches/{id}/reviewers`, `:383-470`): the existing fan-out pattern — snapshots apps in the batch, inserts `reviewer_assignments` skipping existing triples (`:434-450`), then `notify_reviewers_assigned(sb, rows)` (`:451`). `notify_reviewers_assigned` is imported at `:36`.
- **Per-review weighted overall:** `frontend/src/lib/reviewScore.js` `weightedReviewScore(review)` is the canonical 0–10 formula (weights problem 22 / solution 30 / tech 22 / founders 14 / commitment 12; `score_solution` is the DB column for "solution"). The backend mirror is `services/reviewer_query._weighted_overall` / `_SCORE_WEIGHTS`.

---

## Change 1 — Dashboard card cleanup (frontend-only)

`screens/AdminDashboard.jsx`, reviewer-mode KPI grid:

- **Under review card:** delete the subtitle `<div>` at `:218`. The card keeps its label + number; the wrapper's `justifyContent: 'space-between'` keeps it visually aligned with the sibling cards. (Do not change the funnel row labelled "IN REVIEW".)
- **Jury evaluation card:** remove the `<div … ><PreviewBadge /></div>` block (`:228-230`), leaving the `0` value. Keep the `PreviewBadge` import only if still referenced elsewhere in the file; otherwise drop the now-unused import.

**Out of scope:** the jury-mode dashboard view (`:176-206`) and its `<PreviewBadge />` (`:179`) — unchanged.

Frontend-only.

## Change 2 — "Clear filters" button (frontend-only)

`screens/AdminPipeline.jsx`, in the search/filter bar (`.lp-filter-row--search`, around the Filters toggle `:841-852`):

- Add a `Clear filters` button rendered when `hasFilters` (`:217`), calling the existing `clearAll()` (`:218`). Place it just before the Filters toggle (or between the toggle and the count), styled to match leadership (`LeadershipDashboard.jsx:883-887` uses a ghost button; use the portal's equivalent — `os-btn ghost sm` or the existing `lp-clear-btn` class `:712-729`).
- Keep the existing pills-row "Clear all" (`:864`) as-is; the new button is the always-available affordance (it also clears a bare track/search filter, which the pills row cannot).

Frontend-only.

## Change 3 — Reviewer Score column populates (backend + frontend)

**Backend** (`services/admin_query.py`, `fetch_pipeline`):
- Fetch all **submitted** reviews once (`submitted_at` not null) and group by `(application_id, application_track)`. (Mirror the roster's bulk-fetch style; tolerate the fake backend's no-op `.eq()`/`.in_()` by filtering in Python.)
- Build a `reviewer_user_id → weight` map from `reviewer_profiles` (default `1.0` when absent).
- For each app key, compute per review a 0–10 weighted overall (reuse `reviewer_query._weighted_overall`; **verify its scale is 0–10** — if it is not, compute inline using `_SCORE_WEIGHTS` exactly as `reviewScore.js` does: `Σ(score×weight)/Σ(weight)`). Skip reviews whose weighted overall is `None` (a dimension missing).
- Combine across reviewers as the **weight-adjusted average**: `Σ(weight_i × wo_i) / Σ(weight_i)`. Round to 1 decimal. Result is `None` when the app has no scorable submitted review.
- Add `"reviewer_score": <float|None>` to the row dict at `:275-290`.

**Frontend** (`lib/adminDataAdapter.js`, `adaptPipelineRow`):
- Replace `rev: undefined` (`:28`) with `rev: row.reviewer_score != null ? { overall: row.reviewer_score } : undefined`.
- No JSX change: the column cell (`AdminPipeline.jsx:1021-1027`) and the `'rev'` sort (`:302-304`) already consume `s.rev.overall`.

**Note:** the bulk reviews fetch is bounded by PostgREST's 1000-row default cap. Acceptable at current scale (tens of reviews); flagged for pagination if review volume grows.

Requires a backend SAM deploy.

## Change 4 — Remove "AI screening" from the STATUS filter (frontend-only)

`screens/AdminPipeline.jsx`: delete the `{ id: 'ai-screening', label: 'AI screening', color: '#3213b7' }` entry from `STATUSES` (`:80-81`). Leave `getStatusId`/`getFriendlyStatus` (`:32-62`) and the CSV inverse map (`:121-126`) untouched — they map real statuses and are harmless. Prod apps do not sit in `ai_screening` status (AI is stubbed; the flow is submitted→under_review), so no rows become unreachable.

Frontend-only.

## Change 5 — Batch column fans out to the batch's reviewers + emails (backend + frontend)

**Backend** (`routers/admin_platform.py`, `assign_applications`, `POST /batches/{id}/applications`):
After the existing `application_batches` upsert (`:363-365`), add additive fan-out:
1. List all apps currently in the batch from `application_batches` (re-filter on `batch_id` in Python, as `assign_batch_reviewers` does at `:409-420`).
2. Determine the batch's **current reviewers**: distinct `reviewer_user_id` from **active** `reviewer_assignments` (`declined_at IS NULL AND reassigned_to IS NULL`) on those apps. (Bulk-fetch `reviewer_assignments`, filter in Python — same approach as `:424-432`.)
3. For each **newly-assigned** app (the rows from `body.items`) × each current reviewer, build a `reviewer_assignments` row (`application_id`, `application_track`, `reviewer_user_id`, `assigned_by`, `assigned_at`, `state: "pending"`, `due_at: None`) skipping any `(app, track, reviewer)` triple that already exists.
4. If any rows: `sb.table("reviewer_assignments").insert(rows).execute()` then `notify_reviewers_assigned(sb, rows)` (reuse the import at `:36`).
5. Audit + return `{ "assigned": n, "assignments_created": created, "reviewers_notified": <count of distinct reviewers in `rows`> }`.

Behavior: the new app now appears in those reviewers' `/reviewer/queue`, increments the roster's "X of Batch A" count + progress denominator, and each reviewer gets the assignment email. A batch with no reviewers yet → link added, no fan-out (symmetric with today; a later reviewer→batch assign picks up the new app).

**Frontend** (`screens/AdminPipeline.jsx`):
- `changeIndividualBatch` (`:438-464`): on success, set a note from the response, e.g. `Assigned to {batchName} · {reviewers_notified} reviewer(s) notified.` (currently it shows no success note).
- `applyBatchToSelected` (`:392-435`): include the notified count in its existing success note (`:429`).
- No change needed for the bulk floating "Assign batch…" action beyond the note — it already calls the same endpoint.

Requires a backend SAM deploy.

## Change 6 — Human-readable "Last activity" (frontend-only)

`screens/AdminReviewers.jsx`:
- Add a module-level helper `formatLastActivity(value)`:
  - Falsy → `'—'`.
  - If `new Date(value)` is a valid date (ISO string), format with `Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })` and uppercase the meridiem → e.g. `29 Jun 2026, 10:39 AM`.
  - Otherwise return the original string unchanged (so jury-mock relatives like `'2h ago'` pass through).
- Apply at the reviewer-mode cell (`:751`) and the jury-mode cell (`:577`): `{formatLastActivity(r.last)}`.

Backend keeps returning raw ISO (`admin_query.fetch_roster` `:528-532` unchanged).

Frontend-only.

---

## Testing

**Backend (pytest):**
- `fetch_pipeline`: an app with two submitted reviews from reviewers of weights `w1`,`w2` returns `reviewer_score == round((w1·wo1 + w2·wo2)/(w1+w2), 1)`; an app with only a draft (or no reviews) returns `None`.
- `assign_applications`: assigning an app to a batch that already has reviewer R (via an active assignment on another app in the batch) creates a `reviewer_assignments` row for R on the new app, skips an already-existing triple, and invokes `notify_reviewers_assigned`; a batch with no reviewers creates none.
- Note the repo's ~19 pre-existing unrelated failures; run targeted files with `--no-cov` for single-file runs (coverage gate).

**Frontend (vitest):**
- AdminDashboard: UNDER REVIEW card renders no "% of submissions" text; JURY EVALUATION card renders no PreviewBadge.
- AdminPipeline: a "Clear filters" button appears when only a track/search filter is set and clears it; STATUS filter has no "AI screening" button; a row with `reviewer_score` renders the value (e.g. `7.4`) in the Reviewer Score cell.
- AdminReviewers: `formatLastActivity` formats an ISO string to the IST absolute form and passes `'2h ago'` through.

**Build:** `cd frontend && npm run build` clean.

**Manual:** assign an app to a batch from the column → it shows in the roster's "X of Batch A" + progress, lands in the assigned reviewer's queue, and the reviewer receives the assignment email.

## Deploy

- **Frontend-only** (changes 1, 2, 4, 6): Vercel **Promote to Production** on the Ready build.
- **Backend (SAM) + frontend** (changes 3, 5): from an **isolated worktree**, **grep `.env.prod` for `TIR_SUBMISSIONS_CLOSED=true` and `SIP_SUBMISSIONS_CLOSED=true` first** (must stay closed), then `infra/sam/deploy-prod.sh`, push `release/sip-launch-v1` to origin, then user Vercel-promotes. Backend must deploy before/with the frontend (Reviewer Score + batch fan-out depend on the backend changes).

## Out of scope / non-goals

- No DB migration.
- Jury-mode dashboard / roster / pipeline — unchanged (including their PreviewBadges).
- No auto-removal of stale `reviewer_assignments` when an app moves between batches (additive only).
- No change to the reviewer→batch assignment endpoint, the AI-score column, or the CSV export columns.

## Files touched (summary)

**Frontend:** `pages/admin/platform/screens/AdminDashboard.jsx`, `AdminPipeline.jsx`, `AdminReviewers.jsx`; `lib/adminDataAdapter.js`; new/updated tests under `pages/admin/platform/__tests__/`.

**Backend:** `app/services/admin_query.py` (reviewer_score in `fetch_pipeline`), `app/routers/admin_platform.py` (`assign_applications` fan-out); tests under `backend/tests/`.
