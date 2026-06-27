# Leadership / Admin / Reviewer-display prod fixes — Design

**Date:** 2026-06-27
**Branch:** `feat/leadership-reviewer-display-fixes` (off `origin/release/sip-launch-v1` @ `88d4905`)
**Surfaces:** Leadership portal (dashboard + review page), Admin portal (application detail)
**Ships to:** prod (backend via SAM by Claude; frontend build/push by Claude, Vercel Promote-to-Production by user)

## Goal

Five UI/data fixes on the production staff portals:

1. Remove the broken **HOME** button on the leadership header; shift the logo left and keep it tidy.
2. Remove the **"Status breakdown"** card from the leadership dashboard.
3. Remove the **"AI screening"** chip from the leadership Applications **status filter** row.
4. Show the reviewer's **name** (not the UUID prefix `6fd9bcf5`) wherever reviewer assignments/reviews render — Leadership **and** Admin.
5. Fix the reviewer status showing **"Pending"** after the review was submitted; show the real status (**"Evaluated"**) and the reviewer's name.

## Decisions (confirmed with user)

- **Scope of #4 & #5:** Leadership **+** Admin.
- **Completed-reviewer label:** **"Evaluated"**.
- **Reviewer display:** full name → fallback email → fallback short UUID. Name only (not name+email) to preserve the compact row.
- **Deploy:** Claude implements, tests, merges to `release/sip-launch-v1`, pushes, and **SAM-deploys the backend to prod**. Claude builds the frontend; **user does the Vercel Promote-to-Production**.

## Changes

### Item 1 — Remove HOME button, shift logo left
- `frontend/src/pages/leadership/LeadershipDashboard.jsx:437–444` — delete the `<button className="home-btn">…← Home…</button>` block. The header is flex with a `.spacer`; `.logos` becomes the leftmost element automatically.
- Review `.app-header-leadership` / `.home-btn` / `.logos` rules in `frontend/src/styles/admin.css` (§5.13) for any left-padding/gap that assumed the button; adjust if the logo looks cramped. Verify with a before/after screenshot.
- Leave the review page's `← Back` button untouched (works; not flagged).

### Item 2 — Remove "Status breakdown" card
- `frontend/src/pages/leadership/LeadershipDashboard.jsx:840–869` — delete the entire `lp-card lp-card-wide` block ("§ Status breakdown / Where every application sits right now / lp-status-grid"). No other code depends on it.

### Item 3 — Remove "AI screening" status filter chip
- `frontend/src/pages/leadership/LeadershipDashboard.jsx:935–948` — the chips map `stats.status_counts`; add `.filter((s) => s.id !== "ai_screening")`. Frontend-only; backend `status_counts` unchanged. (Count is always 0 in prod since the stub advances submitted→under_review.)

### Items 4 & 5 — Reviewer name + correct status (Leadership + Admin)

**Root causes:**
- Backend `applications_query.fetch_reviews_for` / `fetch_reviewer_assignments_for` do `SELECT *` from tables holding only `reviewer_user_id` (a UUID) — **no `profiles` join** → frontend can only render `uid.slice(0,8)`.
- Frontend status reads the **vestigial `state` column** (always `'pending'`) instead of the timestamp-driven `completed_at`.

**Backend (single source of truth):**
- New shared helper in `backend/app/services/applications_query.py`, e.g. `enrich_reviewers(reviewer_assignments, reviews) -> (assignments, reviews)`:
  - Collect all `reviewer_user_id`s; bulk-fetch `profiles(id, full_name, email)` once (best-effort; on failure, leave fields absent so the frontend falls back to short UUID — never 500).
  - Build a set of reviewer_ids that have a **submitted** review for this app (`submitted_at` not null).
  - Attach to **each assignment**: `reviewer_name` (`full_name || email || uid[:8]`), `reviewer_email`, and `reviewer_status` ∈ `{pending, evaluated, declined}` derived as: `declined_at` → `declined`; (`completed_at` set **or** reviewer_id in submitted-review set) → `evaluated`; else `pending`.
  - Attach to **each review**: `reviewer_name`, `reviewer_email`.
- Wire it into both detail payloads:
  - Leadership: `backend/app/routers/leadership.py get_application_detail` (after the two fetches, before the return dict).
  - Admin: `backend/app/services/admin_query.py fetch_detail` — enrich the `reviewer_assignments` and `reviews` it returns the same way (reuse the helper).

**Frontend (render the new fields; graceful fallback if absent):**
- Shared label map `{ evaluated: "Evaluated", declined: "Declined", pending: "Pending" }` and a dot-class map (evaluated=green, declined=coral, pending=amber). Co-locate or duplicate minimally per component.
- `frontend/src/pages/leadership/components/AppDrawer.jsx` — assignments (`:289`, status `:272–274,297`) and reviews (`:327`): render `reviewer_name`; status from `reviewer_status`.
- `frontend/src/pages/leadership/review/AIScreeningPanel.jsx` — ReviewersTab (`:91`, `:94`): render `reviewer_name`; status from `reviewer_status`.
- `frontend/src/pages/leadership/review/ReviewsTab.jsx` — show `reviewer_name` where the reviewer is identified.
- `frontend/src/pages/admin/platform/screens/AdminDetail.jsx` (`:216`) — render `reviewer_name`; status from `reviewer_status`.
- `frontend/src/pages/admin/platform/screens/ComparativeReviewModel.jsx` — prefer `reviewer_name` from the enriched rows (keeps its existing `reviewersById` fallback).
- Fallbacks: missing `reviewer_name` → existing short-UUID; missing `reviewer_status` → derive from `completed_at` client-side.

## Testing
- Backend: `pytest` on touched query/router tests (`--no-cov` for single-file runs — coverage gate). Add a test asserting the leadership + admin detail payloads carry `reviewer_name` and a correctly-derived `reviewer_status` (evaluated when a submitted review exists).
- Frontend: `vitest` on touched components; full `npm run build` to confirm compilation.

## Rollout
- Branch `feat/leadership-reviewer-display-fixes` off `origin/release/sip-launch-v1` (done) → implement → test → merge to `release/sip-launch-v1` → push to origin.
- **Backend prod deploy (Claude):** SAM deploy from a clean worktree whose `.env.prod` has **both** `TIR_SUBMISSIONS_CLOSED=true` and `SIP_SUBMISSIONS_CLOSED=true` (grep-verify first — a stale `.env.prod` would reopen intake). Smoke-test `/health` after.
- **Frontend:** Claude runs the build + pushes; **user does Vercel Promote-to-Production**.

## Risks / notes
- Enrichment is best-effort and additive (new fields only); existing consumers unaffected.
- No migration. No new endpoints. Backend change is read-only (reads `profiles`).
- `reviewer_status` is computed from timestamps, not the DB `state` column (left untouched).
- Deploy hygiene per repo memory: SAM build reads disk → isolated worktree; verify intake flags before deploy.
