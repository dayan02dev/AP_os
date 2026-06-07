# Reviewer V2 — Manual Smoke Test Checklist

**Branch:** `work/reviewer-integration`  
**Mode:** Mock data, no backend needed (`VITE_REVIEWER_V2_MOCK=true`, `VITE_REVIEWER_V2_READONLY=true`)

## Prerequisites

`frontend/.env.local` must exist with:
```
VITE_REVIEWER_V2_MOCK=true
VITE_REVIEWER_V2_READONLY=true
VITE_API_BASE_URL=http://localhost:8000
VITE_SUPABASE_URL=https://example.supabase.co
VITE_SUPABASE_ANON_KEY=placeholder
```

If it's missing, create it (see `docs/REVIEWER_V2_MANUAL_STEPS.md §4`).

## Dev server boot

```bash
cd frontend
npm run dev
```

Then open **http://localhost:5173** and tick off each item below.

---

## Section 1 — Marketing + auth (existing flows must be unaffected)

These routes existed before this branch. The checklist item passes if the
page loads without a blank screen or console error.

- [ ] **http://localhost:5173/** — marketing / landing page loads
- [ ] **http://localhost:5173/apply** — TIR welcome screen loads
- [ ] **http://localhost:5173/apply/signin** — sign-in form renders  
  _(No real backend in mock mode — do not attempt to sign in here)_
- [ ] **http://localhost:5173/apply/signup** — sign-up form renders
- [ ] Open browser devtools (F12 → Console) — no red JS errors on any of the
  above pages

---

## Section 2 — Reviewer V2 (new portal, mock data)

Because `VITE_REVIEWER_V2_MOCK=true` is set, all data comes from the 16-startup
fixture in `frontend/src/pages/reviewer-v2/data/mockData.js`.
The backend is not called for any of these steps.

### 2.1 Navigation

- [ ] Go to **http://localhost:5173/reviewer-v2**  
  Expected: redirects to `/reviewer-v2/inbox` automatically
- [ ] URL bar shows `/reviewer-v2/inbox` after redirect

### 2.2 Inbox — Dashboard tab

- [ ] Click the **Dashboard** tab  
  Expected: five stat tiles visible (Applications Assigned, Submitted,
  In Progress, Not Started, Average AI Score)
- [ ] At least one stat tile shows a real number (not "—")
- [ ] "Queue pipeline" pipeline bars section renders
- [ ] "AI score distribution" histogram renders
- [ ] "Queue by industry" bar chart renders with clickable industry rows
- [ ] Clicking an industry row switches to **My Queue** tab pre-filtered
  by that industry

### 2.3 Inbox — My Queue tab

- [ ] **My Queue** tab shows the filterable 8-column table
- [ ] Table has columns: Project, Founder, Industry, Stage, AI Score, Status,
  Due, ID
- [ ] At least 8 rows are visible (mock queue has 8 items)
- [ ] Status chips are coloured (green = Submitted, blue = In Progress,
  amber = Draft, grey = Not Started)
- [ ] AI Score column shows a score bar + number for rows that have AI data
- [ ] Search box filters rows by name as you type
- [ ] Track buttons (All / TIR / VIP) filter the table
- [ ] Status filter buttons work
- [ ] "Export CSV ↓" button triggers a file download named
  `reviewer-queue-TIR-VIP-2026.csv`
- [ ] "Clear filters" appears when any filter is active and resets all filters

### 2.4 Evaluation screen

- [ ] Click any row in the My Queue table  
  Expected: navigates to `/reviewer-v2/eval/<number>`
- [ ] Eval screen shows a **2-column layout**: application content on the
  left, scoring panel on the right
- [ ] Left column shows: AI summary card, Problem & solution section with
  collapsible cards, "View full application →" button
- [ ] Right column shows: 5 score sliders (Problem, Solution, Tech, Founders,
  Commitment), Recommendation buttons (YES / MAYBE / NO), Notes textarea,
  Risk flags section
- [ ] Sliders respond to mouse drag (value updates as you drag)
- [ ] "Your overall" number updates live as you adjust sliders
- [ ] Recommendation button highlights on click (YES turns green, etc.)
- [ ] Type text in the Notes textarea — text stays (controlled input)
- [ ] **Edit window chip** is visible in the toolbar (amber or red)
- [ ] **"Show AI Scores"** button reveals the AI baseline scores; clicking
  again hides them (anti-anchoring UX)
- [ ] **"Open rubric →"** opens the rubric modal overlay
  - Modal shows 5 scoring categories with anchors
  - Backdrop click or "Close ✕" button closes it
- [ ] **"Save draft"** button — click it  
  Expected: no network error (mock mode doesn't call backend)
- [ ] **"Submit evaluation →"** button — click it  
  Expected: toast appears reading **"Demo mode — submission blocked."**
  (because `VITE_REVIEWER_V2_READONLY=true`)
- [ ] **"← Prev"** / **"Next →"** buttons navigate between queue items
- [ ] **"View full application →"** shows the full wizard-style read view
  - 6 numbered sections (01 Basic details through 06 Declaration)
  - "← Back to review" returns to the scoring form

### 2.5 History tab

- [ ] Click **My History** tab  
  Expected: navigates to `/reviewer-v2/history`
- [ ] History table renders with columns: Startup, Date, My score, My reco,
  AI score, Variance, Admin decision, (action column)
- [ ] At least 7 rows are visible (mock history has 7 entries)
- [ ] "—" cells appear in the AI score and Admin decision columns
- [ ] **Hover over an "—" cell in the AI score column**  
  Expected: tooltip appears reading  
  `"Backend does not yet expose AI score on this row — see docs/REVIEWER_V2_MANUAL_STEPS.md 'Known visible placeholders'"`
- [ ] Stats tiles row at the top shows "—" for all four stats
- [ ] **Hover over a "—" stats tile**  
  Expected: tooltip appears mentioning "Aggregate stats not yet returned
  by the backend"
- [ ] Locked history rows show a **"Locked"** chip (grey) in the action column

### 2.6 Navigation integrity

- [ ] While on the History page, click **My Queue** tab → returns to inbox
  correctly
- [ ] Browser Back button from eval screen → returns to inbox
- [ ] Direct URL navigation to `/reviewer-v2/eval/3` → loads eval for item 3
- [ ] Direct URL navigation to `/reviewer-v2/history` → loads history directly

---

## Section 3 — Regression (applicant flow must be unaffected)

The reviewer-v2 routes are additive — the applicant wizard must still work.

- [ ] **http://localhost:5173/apply** → applicant welcome renders, no errors
- [ ] **http://localhost:5173/apply/signin** → sign-in form unchanged
- [ ] Open devtools → no new console errors introduced by reviewer-v2 CSS or JS
- [ ] The existing `/reviewer/inbox` route still resolves without error  
  _(Will show an error about missing auth — that is expected, it's protected)_

---

## Section 4 — Visual / UX spot-checks

- [ ] ARTPARK + IISc logo visible in the reviewer portal topbar  
  _(assets/artpark-iisc-combined.webp)_
- [ ] "REVIEWER · MY QUEUE" breadcrumb pill visible in topbar
- [ ] No layout overflow / horizontal scrollbar on the queue table at
  normal desktop width (≥1280px)
- [ ] Eval screen 2-column layout holds at 1280px width
- [ ] Score slider thumb is round and responds to dragging within its track
- [ ] Rubric modal is scrollable if viewport is short

---

## Cleanup

- [ ] Press **Ctrl-C** in the terminal running `npm run dev`
- [ ] `frontend/.env.local` stays in place — it is gitignored and should
  **not** be committed
- [ ] Confirm `git status` shows a clean tree

---

## Reporting results

For each item that **failed**, note:
1. The section and item number (e.g. "2.4 — Submit evaluation toast")
2. What happened instead of the expected behaviour
3. Any console error text

Pass all of Section 1 and Section 3 before proceeding to Phase 6.
Section 2 failures are bugs to fix; Section 4 failures are polish items.
