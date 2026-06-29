# Leadership UI changes — design spec

**Date:** 2026-06-29
**Surface:** Leadership (review page + dashboard drawer)
**Scope:** Frontend-only. No backend, no migration, no API change.

## Goal

Three independent, user-requested polish changes to the leadership surfaces:

1. Redesign the **AI Screening sidebar** (review-page right rail + dashboard drawer) so the AI summary and its supporting sections read as a clean, well-structured panel with no awkward white space and no click-to-reveal fragmentation.
2. Show each reviewer's **final weighted score** on the Reviews tab (today only the five bifurcated dimension scores show).
3. Remove the **Unassign** button from the AI Screening panel's Reviewers tab.

## Current state (what exists today)

- **Review page** `frontend/src/pages/leadership/ReviewApplicationPage.jsx` renders a 2-column grid (`.review-body`, `grid-template-columns: 1fr 440px`) — main content + the `AIScreeningPanel` right rail.
- **`AIScreeningPanel.jsx`** has a Score tab (`ScoreTab`) and a Reviewers tab (`ReviewersTab`). The Score tab shows: an 80px composite score (`.ai-score-big`), five category bars (`.ai-bar-row`, dashed bottom borders), then the AI summary via `AISummaryBlock`.
- **`AISummaryBlock.jsx`** (shared by the panel AND the drawer) renders: flags → a TL;DR card (Verdict + Recommendation) → three detail sections (Top strength / Top concern / Programme fit) hidden behind `Collapsible` accordions.
- **`AppDrawer.jsx`** (dashboard slide-in) has its own AI-score block (44px score + `ComponentBars`) + `AISummaryBlock` + a "Problem & solution" `Collapsible` (via `renderProblemSolution` + `ReadMoreText`) + Reviewer assignments / Reviews / Status history collapsibles.
- **`ReviewsTab.jsx`** shows per-reviewer cards with five dimension bars. It tries to read `r.score_overall` for an "avg score" line, but the `reviews` row carries **no reviewer `score_overall` column** (only `ai_score_overall`), so the overall never renders.
- The reviewer's canonical score is the **weighted overall** computed in `frontend/src/pages/reviewer/v2/ui.jsx` (`weightedOverall`, weights `{problem:22, solution:30, tech:22, founders:14, commit:12}`) — this is the "My Score" the reviewer sees in their own portal, and must match `backend/app/services/reviewer_query.py:_SCORE_WEIGHTS`.

## Change 1 — AI Screening sidebar redesign (Option B: tightened card stack)

**Direction chosen:** card stack — clear grouping, strongest hierarchy, tightened inter-card gaps so there is no empty/floating white space; no accordions for the short detail sections.

### 1a. `AIScreeningPanel.jsx` — `ScoreTab`
Restructure into three stacked cards inside `.ai-panel-body`:
- **Score card:** compact score header — `Composite` eyebrow + a medium score (`3.9 / 10`, ~34px, **not** 80px) on the left, a strength-band chip on the right (e.g. "Not competitive" / "Strong"; derive band from `score_overall` thresholds). Below it, the five category bars (existing `CATEGORY_BARS`) grouped inside the same card, with **solid hairline** dividers (remove the dashed border).
- **Verdict card** (indigo-tinted to pop): the Verdict text + the Recommendation (emphasized). Rendered by the updated `AISummaryBlock` (see 1c).
- **Assessment card:** Top strength / Top concern / Programme fit as always-visible labeled rows separated by hairlines (no accordions).

### 1b. `styles/review-application.css`
- Widen the rail: `.review-body { grid-template-columns: 1fr 500px; }` (was `440px`). Keep the collapsed (`1fr 0`) and mobile (`1fr`) rules.
- Replace `.ai-score-big` 80px sizing with the compact ~34px score header styles; add a `.ai-band` chip style.
- Convert `.ai-bar-row` dashed bottom border → solid hairline; tighten vertical padding.
- Add card styles for the score / verdict / assessment grouping; ensure consistent padding and small gaps (no large empty regions).

### 1c. `AISummaryBlock.jsx` (shared — improves panel AND drawer)
- Keep Flags.
- Keep the Verdict + Recommendation as a prominent block (Recommendation emphasized).
- **Replace the `Collapsible` accordions** for Top strength / Top concern / Programme fit with always-visible labeled rows (small uppercase label + text), separated by hairlines.
- For long free-text (primarily Verdict), wrap in `ReadMoreText` (default ~75 words) so a very long verdict doesn't blow out the panel, but nothing is hidden behind a tap by default.
- The component must remain visually correct in both containers (lavender panel + white drawer). Container-specific chrome stays in CSS, not the component.

### 1d. `AppDrawer.jsx` — drawer parity
- Apply the same compact score-header treatment to the drawer's AI-score block (currently a 44px number + `ComponentBars`); align bar styling with the panel.
- Tidy the **"Problem & solution"** section (`renderProblemSolution`): keep the `ReadMoreText`, but normalize spacing/typography so the section reads cleanly (consistent label style, no oversized gaps). It may move out of the accordion to always-visible OR stay collapsible — keep it collapsible (the drawer has many sections) but ensure the inner layout is clean.

**Non-goal for Change 1:** the main "Application" tab essay rendering is out of scope (user excluded it).

## Change 2 — reviewer final weighted score

- Add a small shared helper `weightedReviewScore(reviewRow)` in a new file **`frontend/src/lib/reviewScore.js`** that computes the weighted overall from `score_problem / score_solution / score_tech / score_founders / score_commitment` using the canonical weights `{problem:22, solution:30, tech:22, founders:14, commit:12}` (mirrors `reviewer/v2/ui.jsx` `weightedOverall` and backend `_SCORE_WEIGHTS`). Returns `null` if no dimension scores are present. Do **not** import from `pages/reviewer/v2/ui.jsx` (cross-surface coupling).
- **`ReviewsTab.jsx`:** show the weighted overall prominently in each review card header (e.g. a `2.1 / 10` pill/figure next to `Reviewer · NAME`). Recompute the "avg score" summary line from `weightedReviewScore` across submitted reviews instead of the always-null `r.score_overall`.
- **`AppDrawer.jsx`:** the Reviews collapsible has the same `r.score_overall != null` gap — use `weightedReviewScore(r)` there too so the per-review overall renders.

## Change 3 — remove the Unassign button

- **`AIScreeningPanel.jsx`** `ReviewersTab`: remove the `<button className="ai-unassign">` and its props usage. Keep the reviewer name + status dot/label. The `onUnassign` / `unassigning` / `currentUserId` props become unused — drop them from the component signature.
- **`ReviewApplicationPage.jsx`:** remove the now-dead `handleUnassign` callback, the `unassigning` state, and the `onUnassign` / `unassigning` / `currentUserId` props passed to `AIScreeningPanel`. Leave `leadershipApi.unassignReviewer` in place (admin still uses it).
- `.ai-unassign` CSS may be left or removed (dead). Remove it for tidiness.

## Testing

- Frontend build must pass (`npm run build`).
- Existing frontend test suite must stay green (`npx vitest run`) — note the pre-existing `FileGridAnswer.test.jsx` collection failure (missing `@testing-library/user-event`) is unrelated.
- Manual/visual check of: review-page AI panel (score card, verdict card, assessment rows, ~500px width), the dashboard drawer (AI score + problem/solution), the Reviews tab (weighted score per card + avg line), and the Reviewers tab (no Unassign button).
- Add a focused unit test for `weightedReviewScore` (weights + null handling).

## Files touched (summary)

- `frontend/src/pages/leadership/review/AIScreeningPanel.jsx` (Change 1, 3)
- `frontend/src/pages/leadership/components/AISummaryBlock.jsx` (Change 1)
- `frontend/src/pages/leadership/components/AppDrawer.jsx` (Change 1, 2)
- `frontend/src/pages/leadership/review/ReviewsTab.jsx` (Change 2)
- `frontend/src/pages/leadership/ReviewApplicationPage.jsx` (Change 3)
- new `frontend/src/lib/reviewScore.js` (Change 2 helper) + its unit test
- `frontend/src/styles/review-application.css` (Change 1) + drawer CSS as needed (`styles/leadership.css`)
- A unit test for the weighted-score helper.

## Out of scope / non-goals

- No backend, API, or DB changes.
- The main Application-tab Problem/Solution essay rendering (user excluded).
- The admin portal's reviewer-assign/unassign controls (unchanged).
- Adding a reviewer `score_overall` column server-side (computed client-side instead).
