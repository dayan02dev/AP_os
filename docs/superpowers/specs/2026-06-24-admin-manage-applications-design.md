# Admin "Manage Applications" — per-reviewer application assign/unassign

**Date:** 2026-06-24
**Surface:** Admin portal → Reviewers tab (A-5 Reviewer Roster)
**Branch:** `feat/admin-manage-applications` (worktree off `origin/release/sip-launch-v1`, prod tip `9271654`)
**Target:** Production (`apply.artpark.info` Vercel + `artpark-eir-api-production` Lambda), verified on staging first.

---

## 1. Problem

On the admin Reviewer Roster, the **Manage** button opens an "Edit reviewer details" drawer (name / email / weight / domains / batch chips). There is **no way to unassign a single application** from a reviewer — only whole batches (the `×` on a batch chip removes an entire batch). An admin cannot remove or add one specific application to a reviewer's queue.

The original prototype (`admin-2.jsx`) had a richer **"Manage Applications"** drawer — assigned-batches view, a searchable "assign new application" control, and an assigned-applications table with per-row **Remove**. The faithful UI port dropped it and replaced it with the simpler details editor. This spec restores that drawer for the live reviewer roster and wires it to the real backend.

## 2. Goals / non-goals

**Goals**
- Manage button opens a new **"Manage Applications"** drawer (per the user's screenshots).
- View the reviewer's assigned batches (read-only chips) and the full list of applications assigned to them (Project · Industry · Status · Batch).
- **Assign** an individual application to the reviewer via a searchable picker.
- **Remove (unassign)** an individual application from the reviewer.
- Keep editing name/weight/domains/email available via the existing separate **"Edit reviewer"** button (unchanged).

**Non-goals**
- Jury mode (`decisionMode === 'jury'`) stays mock/preview — no backend, out of scope.
- No changes to batch-level assign/remove (the existing chip `×` / `+` flow stays).
- No new reviewer-portal behavior.

## 3. Architecture

### 3.1 Backend — list a reviewer's applications (the one gap)

No endpoint returns the applications assigned to a single reviewer; the roster returns batch counts only. Add a focused, lazy-loaded endpoint.

- **`services/admin_query.py` → `fetch_reviewer_applications(user_id)`**
  - Query `reviewer_assignments` for `reviewer_user_id == user_id` where **active** (`declined_at IS NULL AND reassigned_to IS NULL`).
  - For the resulting `(application_id, application_track)` keys, reuse the existing pipeline joins to resolve `project` (ai_screening `project_name` → app fallback), `industry` (industry_categories), `status` (app row), and `batch` (`application_batches` → `batches`, via the existing `_fetch_batches` helper).
  - Return rows: `{ id, track, project, industry, status, batch, reviewStatus, assignment_id }`.
    - `batch: null` when the app belongs to no batch → UI renders "Random allotment".
    - `reviewStatus`: `"submitted"` if a `reviews` row for this (app, track, reviewer) has `submitted_at IS NOT NULL`, else `"pending"`.
  - Bounded by `in_(ids)` (not `select("*")`) to avoid the PostgREST 1000-row cap.
- **`routers/admin_platform.py`** — `GET /admin/platform/reviewers/{user_id}/applications`, `dependencies=[Depends(require_capability("manage_reviewers_roster"))]` (same gate as the roster).

### 3.2 Backend — assign / unassign (reuse, no new endpoints)

- **Assign** one app → `POST /leadership/applications/{application_id}/reviewers` (capability `assign_reviewers`; admin has it). Body `{ reviewer_user_ids: [reviewerId] }`. Response per-id `status ∈ created | already_assigned | not_a_reviewer`. The Detail screen already calls this via `leadershipApi.assignReviewers`.
- **Unassign** one app → `DELETE /leadership/applications/{application_id}/reviewers/{reviewer_user_id}` (capability `assign_reviewers`). Hard-deletes the assignment row. Returns **409 `review_already_submitted`** when guarded (see §3.3).

### 3.3 Backend — guard bugfix (necessary debug)

`unassign_reviewer` blocks deletion when the reviewer already submitted a review — but it checks `reviews.status == "submitted"`, and the submit pipeline (`reviewer.py`) only ever writes `submitted_at`; **`reviews.status` is never set to `"submitted"`** (stays at the mig-014 default `'draft'`). So the guard never fires today, and a submitted score can be orphaned by an unassign.

**Fix:** change the guard query from `.eq("status", "submitted")` to `.not_.is_("submitted_at", "null")` (i.e. block when a `reviews` row for this app+track+reviewer has `submitted_at IS NOT NULL`). This aligns the code with the documented intent and the rest of the codebase (which derives submit-state from `submitted_at`). Behavior change: revoking a reviewer who has actually submitted now correctly returns 409 instead of silently deleting.

### 3.4 Frontend

- **`lib/adminPlatformApi.js`** — add `getReviewerApplications(userId)` → `GET /admin/platform/reviewers/${userId}/applications`.
- **`lib/adminDataAdapter.js`** — add `adaptReviewerApplication(row)` (pass-through/normalize: `id, track, project, industry, status, batch, reviewStatus, assignment_id`); a `STATUS_TO_CHIP` mapping already exists for the status pill.
- **`hooks/useAdminData.js`** — register a `reviewerApplications` loader keyed by `userId` (lazy; only fetched when the drawer opens), or fetch directly in the drawer with `useAsync`. Decide at implementation time; prefer the existing `useAdminData` registry for consistency.
- **`pages/admin/platform/screens/AdminReviewers.jsx`**
  - New `ManageApplicationsDrawer` component (separate from the existing `ManageDrawer`). The **Manage** button (reviewer mode) opens this; the existing `ManageDrawer` is reached only via the top **"Edit reviewer"** button.
  - Drawer layout (matches screenshots):
    - Header: "Manage Applications" · "Reviewer: {name} · {domain}". Close `×`.
    - **Assigned Batches**: read-only chips from `reviewer.batches`.
    - **Assign new application**: searchable `<select>`/typeahead over `getPipeline()` (project + industry text; each option tagged with its batch or "Unassigned"); excludes apps already in this reviewer's assigned list. "Assign Application" → `leadershipApi.assignReviewers(appId, track, { reviewer_user_ids: [reviewer.id] })` → reload drawer list + `reload()` roster.
    - **Assigned Applications (N)**: table Project · Industry · Status chip · Batch chip · **Remove** → `leadershipApi.unassignReviewer(appId, track, reviewer.id)` → reload.
    - Footer: Close.
  - Jury-mode Manage button: unchanged (still opens the mock `ManageDrawer`).

### 3.5 Data flow

```
Open drawer → getReviewerApplications(reviewer.id)         → Assigned Applications table
            → getPipeline() (all apps, minus already-assigned) → Assign picker source
Assign      → leadershipApi.assignReviewers(...)  → reload both lists + roster
Remove      → leadershipApi.unassignReviewer(...) → reload both lists + roster (409 → inline notice)
```

## 4. Error handling

- **Assign** results: `created` → success; `already_assigned` → inline notice (no-op); `not_a_reviewer` → inline error (shouldn't happen from the roster).
- **Remove** 409 `review_already_submitted` → inline message: "This reviewer already submitted a review; the assignment can't be revoked." Other errors → generic inline error with the server message.
- Drawer has explicit loading / empty ("No applications assigned") / error+retry states.
- Mutations reload from the server (no optimistic UI) for consistency with the existing roster handlers.

## 5. Edge cases

- Per-app Remove deletes **only this reviewer's** `reviewer_assignments` row; the application stays in its batch (`application_batches` untouched) and other reviewers keep their assignments.
- Cross-track: each app carries its `track`; assign/unassign use it (the backend also re-resolves track from `application_id`).
- A reviewer assigned via a whole batch can have a single app removed (deletes that one assignment row); the batch chip still shows on the roster.
- Assigning makes the app appear in that reviewer's `/reviewer` queue (same `reviewer_assignments` table) — the intended effect.

## 6. Testing

- **Backend** (`backend/tests/`): `fetch_reviewer_applications` returns active assignments with project/industry/status/batch and correct `reviewStatus`; excludes declined/reassigned; endpoint requires `manage_reviewers_roster`. Guard test: unassign **blocks (409)** when a `reviews` row has `submitted_at IS NOT NULL`; **succeeds** when it's a draft (`submitted_at IS NULL`).
- **Frontend** (`AdminReviewers.test.jsx`): drawer lists assigned apps; Assign calls `assignReviewers` + reloads; Remove calls `unassignReviewer`; 409 renders the inline guard message; empty state renders.
- **Gate before "done":** full backend test run + frontend test run + `npm run build`, with output shown (no success claim without evidence).

## 7. Deployment (production)

Backend changes require a Lambda deploy (Vercel promote alone is insufficient).

1. Implement + verify locally (tests + build) on `feat/admin-manage-applications`.
2. **Deploy to staging first** (`sam build/deploy` from the staging worktree against the staging stack) and smoke-test the live drawer end-to-end.
3. Merge `feat/admin-manage-applications` → `release/sip-launch-v1`.
4. **Pre-deploy safety check (mandatory):** grep the deploying worktree's `backend/.env.prod` and confirm `TIR_SUBMISSIONS_CLOSED=true` and `SIP_SUBMISSIONS_CLOSED=true` are present **before** any prod `sam build/deploy` — a stale `.env.prod` reopens intake (per the 2026-06-23 incident). Deploy backend to `artpark-eir-api-production` from an isolated worktree (no HEAD-flip mid-build).
5. Promote the frontend build to Production in Vercel (manual "Promote to Production").
6. Post-deploy smoke test on `apply.artpark.info`: open Manage on a real reviewer, assign + remove an app, confirm the reviewer's queue reflects it.

**Commits:** solely authored by the user — no Claude/AI co-author trailer.

## 8. Risks

- The reused leadership assign/unassign endpoints are admin-callable (admin has `assign_reviewers`) — confirmed by the existing Detail-screen usage; no RBAC change needed.
- The guard fix changes unassign behavior for submitted reviewers (now 409). This is intended and low-risk, but is a live behavior change to the Detail screen's unassign as well — call it out in the PR.
- `getPipeline()` returns all apps; for the picker this is fine at current scale (hundreds). Client-side search keeps it responsive.
