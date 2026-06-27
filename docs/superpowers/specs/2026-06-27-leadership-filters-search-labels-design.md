# Leadership portal: Reviews-tab labels + collapsible Filters + search-by-project — Design

**Date:** 2026-06-27
**Branch:** `feat/leadership-filters-search-labels` (off `origin/release/sip-launch-v1` @ `9b7589c`)
**Surfaces:** Leadership portal (review page Reviews tab; Applications tab) + backend search
**Ships to:** prod (backend via SAM by Claude; frontend build/push by Claude, Vercel Promote by user)

## Goal

1. In the leadership **Reviews tab** reviewer scorecards, rename the 5 dimensions to the verbose names already used in the reviewer portal, and remove the always-empty "Integrity & closure" row.
2. Add an admin-style collapsible **"Filters ▾"** toggle to the leadership **Applications** tab that shows/hides the existing Status / AI-score / Industry filter rows.
3. Fix the leadership **search** so it also matches the application's **project name** (the value shown in the Project column) — currently it only matches name/email/org, so searching a project like "Cognitive Warfare AI" returns 0.

## Decisions (confirmed with user)

- Item 1: Reviews tab only + drop the Integrity row. AI Screening side-panel labels unchanged.
- Item 2: collapse the existing leadership filter rows behind an admin-style "Filters ▾" button (no full visual port).
- Item 3: extend search to `project_name` (exact substring; no fuzzy/typo tolerance).
- Deploy: Claude implements/tests/merges/pushes and **SAM-deploys the backend**; **user does Vercel Promote-to-Production**.

## Changes

### Item 1 — Reviews-tab dimension labels
`frontend/src/pages/leadership/review/ReviewsTab.jsx` — `CATEGORY_BARS`:
```
score_problem    → "Problem Statement Impact and Importance"
score_solution   → "Completeness, Depth of Solution"
score_tech       → "Technical Depth"
score_founders   → "Professional Profile of Founder"
score_commitment → "Commitment to be fully available"
```
Remove the `score_integrity` / "Integrity & closure" entry (reviews never carry an integrity score → row is always "—"). Mirrors reviewer `ui.jsx CRIT_LABELS`.

### Item 2 — Collapsible "Filters ▾" on the Applications tab
`frontend/src/pages/leadership/LeadershipDashboard.jsx`:
- Add `const [filtersOpen, setFiltersOpen] = useState(false)`.
- In the top filter-bar (after the track chips, before/with the count), add an admin-style toggle button: funnel SVG + "Filters" + active-count badge + caret (▾/▴). Active count = number of applied filters among {status, AI-score bucket, industry} (track + search shown separately, like today).
- Wrap the three existing filter-bar rows (Status `:885`, AI score `:914`, Industry `:948`) in `{filtersOpen && ( … )}`.
- CSS: add a re-scoped copy of the admin `.lp-filters-toggle` / `.lp-filters-caret` / `.lp-filters-count` rules to `frontend/src/styles/leadership.css` (admin's live in `admin-portal.css` scoped under `.adm-portal`, which leadership doesn't load). Keep the existing leadership chip styling for the rows themselves.

### Item 3 — Search also matches project name
Backend `backend/app/services/applications_query.py`:
- New helper `fetch_app_ids_by_project_name(track, needle) -> list[str]`: query `ai_screening` where `application_track == track` and `project_name ilike %needle%`; return `application_id`s (cap ~1000). Best-effort (returns [] on error).
- In `fetch_apps_for_track`, when `search` is set: compute `project_ids = fetch_app_ids_by_project_name(track, search)`; if non-empty, append `id.in.(<comma-joined uuids>)` to the existing `or(...)` clause. Net match set = basic_full_name / basic_email / basic_org / display_seq(digits) / project_name. PostgREST parses the nested `in.(…)` parens inside `or(...)`.

Frontend `LeadershipDashboard.jsx`: update the search input placeholder to "Search by name, email, org, or project".

## Testing
- Backend: unit-test `fetch_app_ids_by_project_name` with a stubbed `get_admin_client` (returns ids for matches, [] on no-match / error). Run touched suites (`--no-cov` single-file); expect green except the 2 known pre-existing legacy `admin.py` failures.
- Frontend: vitest on touched files + `vite build` clean.

## Rollout
- Branch `feat/leadership-filters-search-labels` off `9b7589c` → implement → test → merge to `release/sip-launch-v1` → push origin.
- **Backend (Claude):** SAM deploy from a worktree with **both** `TIR_/SIP_SUBMISSIONS_CLOSED=true` in `.env.prod` (grep-guard before deploy). Smoke `/health` after.
- **Frontend:** Claude build + push; **user Vercel Promote-to-Production**.

## Risks / notes
- Item 3 is additive (widens the OR); no schema/endpoint changes, no migration.
- Item 1 & 2 are frontend-only; item 3 needs the backend deploy.
- `id.in.(…)` inside `or()` relies on PostgREST paren-aware parsing (standard, used elsewhere).
