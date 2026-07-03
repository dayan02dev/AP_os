# Applicant dashboard status states (Accepted / Rejected) — design spec

**Date:** 2026-07-03
**Branch:** `feat/applicant-status-states` (off `origin/release/sip-launch-v1` @ `38a78bb`)
**Surface:** Applicant returning-user dashboard (`SubmittedDashboard`, the "Welcome back" page)
**Scope:** Frontend only. Approved via mockup (Trebuchet MS + Open Sans, `#3213b7`, statbox removed, rail fills right column).

## Problem

When an admin makes a Gate-1 decision the backend already flips the application row's `status` and sends the email (`decisions.record_decision` → `state_machine.apply_status_change`): Approve → `jury_review`, Reject → `rejected`. But the applicant dashboard does not reflect either correctly:

- `jury_review` is **missing** from `STATUS_TO_MILESTONE` (`App.jsx`), so it falls back to `"submitted"` — an accepted applicant wrongly shows at **Stage 01 "Application"**.
- `rejected` maps to `"under_review"` and `sub.outcome` is never set, so a rejected applicant still shows plain **"Under review"** (no rejection indicator). `TERMINAL_OUTCOMES` has no `rejected` entry.

## Data flow (confirmed)

`App.jsx` builds `pastSubmissions` entries with `currentMilestone: milestoneFromRow(r)` (3 sites: TIR rows, cross-track SIP rows, just-submitted current row). `auth_upload.jsx` picks the dashboard's `currentSub = pastSubmissions.find(matchesTrack)` (`:883`) and passes it to `SubmittedDashboard`. The dashboard's `getSubmissionProgress(sub)` uses `sub.outcome` + `sub.lastReached` for terminal states, else `sub.currentMilestone`. So terminal rendering requires the `sub` entries to carry `outcome`/`lastReached`.

## Design

### 1. Extract the progress logic into a testable lib
New `frontend/src/lib/applicantProgress.js` (pure, no React) holding what is today split across `App.jsx` + `auth_upload.jsx`:
- `MILESTONES` (6-stage pipeline) — the `jury` entry relabeled **"Jury review"** (was "Jury evaluation"); desc unchanged.
- `TERMINAL_OUTCOMES` — **add** `rejected: { label: "Rejected", tone: "negative" }`.
- `STATUS_TO_MILESTONE` — **add** `jury_review: "jury"`.
- `progressFromRow(row)` → `{ currentMilestone, outcome, lastReached }`:
  - `status === "rejected"` → `{ currentMilestone: "under_review", outcome: "rejected", lastReached: "under_review" }` (per the requirement: always strike **Under review**, regardless of the exact from-status).
  - else → `{ currentMilestone: row.current_milestone || STATUS_TO_MILESTONE[status] || "submitted", outcome: null, lastReached: null }`.
- `getSubmissionProgress(sub)` and `getStatusLabel(sub)` moved here verbatim (they read MILESTONES/TERMINAL_OUTCOMES).

`App.jsx` imports `progressFromRow`; the 3 sub-builders use `...progressFromRow(r)` instead of `currentMilestone: milestoneFromRow(r)`. Remove the now-moved local `STATUS_TO_MILESTONE`/`milestoneFromRow`.
`auth_upload.jsx` imports `MILESTONES`, `TERMINAL_OUTCOMES`, `getSubmissionProgress`, `getStatusLabel` from the lib; removes the local copies.

### 2. Render changes in `SubmittedDashboard` (`auth_upload.jsx`)
- **Remove the "Current status" statbox** block (`{isActiveStage && (<div className="eir-dash-statbox">…)}`). The right column becomes the pipeline only.
- Pipeline step map:
  - **Accepted:** when `isCurrent && currentKey === "jury"`, render a green **"Advanced"** tag after the label; give the step an `is-advanced` class (green dot/label).
  - **Rejected:** when `progress.isTerminal && progress.outcomeKey === "rejected" && mi === progress.currentIdx`, give the step an `is-rejected` class, wrap the short label in a `.eir-dash-pipe-text` span for the strikethrough, and render a red **"Rejected"** tag.

### 3. CSS (`styles.css`, `eir-dash-*` block — dashboard-only, safe to change)
- `.eir-dash-app2026-right` → `display:flex; flex-direction:column;` (drop the statbox gap).
- `.eir-dash-pipebox` → add `flex:1; display:flex; flex-direction:column;`.
- `.eir-dash-pipeline` → add `flex:1; display:flex; flex-direction:column;`.
- `.eir-dash-pipe-step` → `flex:1; min-height:56px;` (drop `padding-bottom`).
- `.eir-dash-pipe-node` → `flex-direction:column;` and `.eir-dash-pipe-line` → `flex:1; width:1.5px;` (replace the absolute-positioned line so it stretches between dots as steps distribute).
- Add: `.is-advanced` dot/label green (`--accent-green`); `.is-rejected` dot red + `.eir-dash-pipe-text` line-through; `.eir-dash-pipe-tag.adv` (green) / `.rej` (red) pill styles. Reuse existing tokens (`--accent`, `--accent-green`, coral `#c0392b`).

## Testing
- `frontend/src/lib/__tests__/applicantProgress.test.js`:
  - `progressFromRow`: `jury_review` → `currentMilestone:"jury"`; `rejected` → `outcome:"rejected", lastReached:"under_review"`; `under_review` → `currentMilestone:"under_review"`; `current_milestone` override wins.
  - `getSubmissionProgress`: `{currentMilestone:"jury"}` → `currentIdx:3, isTerminal:false`; `{outcome:"rejected", lastReached:"under_review"}` → `isTerminal:true, currentIdx:1, outcomeKey:"rejected"`.
  - `getStatusLabel`: rejected sub → `"Rejected"`; jury sub → `"Jury review"`.
- `npm run build` must pass; full `vitest run` no new failures.

## Isolation / deploy
- Worktree `feat/applicant-status-states`. Files: new `lib/applicantProgress.js` + test, `App.jsx`, `auth_upload.jsx`, `styles.css`. No backend, no migration. Do not touch profile-completion files.
- Frontend-only → push FF to `release/sip-launch-v1` (fetch+rebase first, no `--force`); Vercel builds; **user promotes to production**.

## Out of scope
Other terminal statuses (waitlisted, withdrawn, not_shortlisted), the psychometry/interview/onboarding active-stage CTAs (removed with the statbox), any backend change.
