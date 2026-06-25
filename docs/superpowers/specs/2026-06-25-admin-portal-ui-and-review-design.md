# Admin Portal — UI cleanup + Admin Review fix — Design Spec

**Date:** 2026-06-25
**Branch:** `fix/admin-portal-ui-and-review` (worktree off `origin/release/sip-launch-v1` @ `dc667c3`)
**Target:** production, deploy **held for explicit go-ahead**. **No DB migration.**
**Surface:** Admin portal (`/admin/*`, `pages/admin/platform/*`)

Seven changes. Four are UI removals, one is an input clamp, one is a roster-metric redefinition,
one is a real bug fix on the Admin Review screen. Grounded in the live prod code + a prod-data
check on 2026-06-25.

---

## #1 — Remove Audit + Analytics from the UI (keep all logging) — frontend only

**Symptom:** The admin nav shows **Audit** (Event Trail) and **Analytics** (Calibration) tabs.

**Decision:** Remove both from the UI; **keep every backend log + endpoint intact.**

**Change:** `pages/admin/platform/AdminPortal.jsx` — remove the `audit` and `analytics` entries from
the NAV array, their two render lines (`{page === 'audit' && <AdminAudit/>}` / `… 'analytics' …`),
and the `AdminAudit` / `AdminAnalytics` imports. Leave the screen files on disk (unreferenced).

**Untouched:** `audit_log_v2`, `services/audit.write_audit()`, `GET /admin/platform/audit-log`
(+CSV), `GET /admin/platform/analytics/reviewer-calibration`. Logging continues; it's only hidden
from the UI.

---

## #2 — Remove "External · paid per review" sub-label — frontend only

**Change:** `pages/admin/platform/screens/AdminReviewers.jsx` (~line 746) — delete the hardcoded
`<small>External · paid per review</small>` rendered under each reviewer's name. Name stays.

---

## #3 — Remove the Consistency column — frontend only

**Change:** `AdminReviewers.jsx` — remove the `Consistency` table header (`renderHeader('Consistency','consistency')`),
the consistency `<td>` cell (the `r.consistency` chip block), and the `sortCol === 'consistency'`
case. Update the roster subtitle from "Assignments, progress, consistency calibration." to
"Assignments, progress." Backend `fetch_roster` may keep returning `consistency` (ignored by the UI).

---

## #4 — Progress = work done (reviewed ∪ assigned) — backend + frontend

**Symptom:** Progress shows "0 / N" for reviewers who have actually reviewed apps. Root cause
(verified on prod 2026-06-25): `completed_at` is NULL on all 171 active assignments, and reviewers
reviewed apps they were later **unassigned** from (the 24-Jun mass-unassign), so "reviewed-among-active"
is 0 (e.g. Ramanpreet: 19 reviews, 4 current assignments, 0 overlap → "0/4").

**Decision (confirmed):** Progress reflects **work done**.

**Change:** `services/admin_query.py` `fetch_roster`, per reviewer:
- `reviewed_keys` = distinct `(application_id, application_track)` with a **submitted** review by this reviewer (from `reviews_by_rev`, already fetched).
- `active_keys` = `(application_id, application_track)` of the reviewer's **active** assignments (declined_at IS NULL AND reassigned_to IS NULL).
- `completed = len(reviewed_keys)`  ·  `assigned = len(active_keys ∪ reviewed_keys)`  ·  `progress = f"{completed} / {assigned}"`.

Computed directly from `reviews` + `reviewer_assignments` (no dependence on the unreliable
`completed_at`). Examples: Ramanpreet → **19 / 23**; Nirav → 1 / 47; a fresh reviewer with a batch of
44 and no reviews → 0 / 44. Numerator never exceeds denominator.

**Frontend:** `AdminReviewers.jsx` — the progress bar width must be `completed / assigned` (guard
divide-by-zero → 0). `adaptReviewer` already passes `assigned`/`completed`/`progress` through.

---

## #5 — Clamp reviewer weight to 0–10 — frontend + backend

**Change (frontend):** In the Manage drawer's weight `<input type="number">` (`AdminReviewers.jsx`,
the `weight` state) add `min={0} max={10} step={0.1}`, and clamp the value to `[0,10]` before
calling `patchReviewer`.

**Change (backend):** `routers/admin_platform.py` `PATCH /reviewers/{user_id}` body model — constrain
`weight` to `ge=0, le=10` (Pydantic). An out-of-range weight → 422, not silently stored.

---

## #6 — Admin Review shows real reviewer evaluations + working decisions — frontend (backend verify)

**Symptom:** Admin Review (`AdminGate1`) shows "Human Reviewers Consensus — No reviewer evaluations
submitted yet" and "AI screening score (reviewer score unavailable on list)" for every app, even
though reviewers submitted evaluations.

**Root cause:** `AdminGate1` loads `useAdminData("pipeline", {status:"evaluated"})` and passes those
**pipeline-list rows** (`adaptPipelineRow` — no `reviews`, no `rev`) to `ComparativeReviewModel`,
which reads `startup.reviews`. Only `adaptDetail` (via `loadDetail`) includes `reviews`/`rev`.
(Prod data confirms the 15 `evaluated` apps each have ≥1 submitted review — the data is present;
only the fetch is missing.)

**Decision (confirmed):** Make evaluations + decisions work **now**; the shortlisted→Jury handoff
stays a **separate future task** (jury portal has no backend).

**Change (frontend, `AdminGate1.jsx`):** For the app currently being decided (Variant A, one-at-a-time —
and on Prev/Next/progress-dot navigation), fetch its detail via `loadDetail(track, id)` and render
`ComparativeReviewModel` + the "Reviewer Overall" score panel from the hydrated object (`reviews`,
`rev`). Show a lightweight loading state while the detail fetch is in flight; fall back to AI score
if a row genuinely has no reviews.

**Decision path (verify, not rebuild):** Approve / Waitlist / Reject already call the decision
endpoint. Confirm the mapping end-to-end: **Approve → `shortlisted`**, **Waitlist → `waitlisted`**,
**Reject → `rejected`** (via `BUTTON_TO_DECISION` adapter + `POST /admin/platform/applications/{track}/{id}/decision`),
and that a successful decision updates the list/counters. (Prod already has 1 shortlisted + 1
waitlisted, so the path has worked; this is a verification + wiring-through-to-the-hydrated-view task.)

**Backend verify:** confirm `admin_query.fetch_detail` returns `reviews` populated for an evaluated
app (the FE `adaptDetail` already consumes `d.reviews`). If it doesn't, add the reviews sub-fetch —
but the index + data indicate it already does.

**Out of scope:** jury_review routing / jury portal wiring.

---

## #7 — Remove Hide/Unhide (keep Archive) — frontend only

**Change:** `pages/admin/platform/screens/AdminPipeline.jsx` — remove the **"Hide / Unhide"** bulk
button (line ~1240) and its `handleBulkToggleHide` handler. **Leave** the Archive button and the
Hold / Send to Next Level / Reject bulk actions. Backend `patchMeta` (`is_hidden`/`is_archived`)
untouched. (This removes the footgun that caused the accidental mass-hide.)

---

## Cross-cutting

### Testing
- **Backend (pytest):** `fetch_roster` work-done progress (reviewed ∪ assigned; submitted review for
  an unassigned app still counts in `completed` and `assigned`); `PATCH /reviewers/{id}` rejects
  weight < 0 or > 10 (422) and accepts in-range.
- **Frontend (vitest):** AdminReviewers — no "Consistency" header, no "External · paid per review",
  weight input has min/max and clamps; AdminGate1 — renders fetched reviewer evaluations (mock
  `loadDetail` returning reviews → consensus shows, "Reviewer Overall" shows); AdminPipeline — no
  "Hide / Unhide" button (Archive still present).

### Deploy (held for go-ahead)
Feature branch in the isolated worktree (never shared HEAD). On go-ahead: `sam build` from this
worktree, grep `.env.prod` to confirm `TIR_/SIP_SUBMISSIONS_CLOSED=true` before deploy, deploy
backend to `artpark-eir-api-production`, push `release/sip-launch-v1`, then promote the Vercel build.

### Acceptance criteria
1. Admin nav no longer shows Audit or Analytics; `audit_log_v2` still receives writes; the audit/
   analytics endpoints still respond.
2. No "External · paid per review" under reviewer names; no Consistency column.
3. Roster progress shows work done (e.g. a reviewer who submitted 19 reviews reads 19 / N, N ≥ 19).
4. Reviewer weight cannot be set below 0 or above 10 (UI + API).
5. Admin Review shows each evaluated app's real reviewer evaluations + reviewer overall score;
   Approve/Waitlist/Reject write shortlisted/waitlisted/rejected.
6. The Applications page no longer has a Hide/Unhide bulk button (Archive remains).
