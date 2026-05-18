# Reviewer pages — Phase 1.5 design

**Status:** design draft, awaiting user approval before plan/implementation
**Branch:** `feature/reviewer-screens` (worktree at `.claude/worktrees/feature-reviewer-screens`)
**Base:** `origin/staging-role_based_dashboard` @ `be13347`
**Merges into:** `staging-role_based_dashboard` once shipped
**Closes:** ARTPARK TIR spec §14.3, §14.4 (reviewer submit + auto-evaluate); progresses §14.10 (Lighthouse)
**Related context:** [admin platform Phase 1 design](2026-05-13-admin-platform-design.md), [admin/leadership design system migration](2026-05-14-design-system-admin-leadership.md)

---

## 1. Goal

Build the reviewer experience that Phase 1 deferred. Reviewers can log in, see assignments, score independently, and edit within a 60-minute window. Scoring is *blind* to the AI screening output until the reviewer submits, after which the AI scores appear side-by-side for calibration.

Phase 1.5 closes the three acceptance criteria Phase 1 left open (spec §14.3, §14.4, §14.10) and unblocks Phase 2 work (real AI integration, jury portal, scoring rubric editor).

---

## 2. Scope

### In scope

- Three reviewer pages: Inbox, Scoring, Completed history
- Reviewer app shell (header + left rail, no scoring-page rail)
- Backend endpoints under `/reviewer/*` (mostly already specced in admin-platform-design §5.4; this design fills in shapes and adds two endpoints)
- The anti-anchoring guarantee: AI screening output is stripped server-side until the reviewer has a submitted review for the application
- 60-minute edit window with live countdown, edit-in-place, 423 lock-on-PATCH
- Decline flow with reason + email-to-leadership
- Status auto-transition `under_review → evaluated` when all assigned reviewers submit
- Backend + frontend tests covering the privacy boundary, the lock, and the auto-transition

### Out of scope (Phase 2+)

| Item | Why deferred |
|---|---|
| `disagree_with_ai` JSONB per-category UI | Needs validated use of the State B comparison view first. |
| `score_integrity` column | Pairs with Phase 2 AI integrity check (spec §4.3 footnote). |
| Reviewer ↔ leadership free-text messaging | Spec §2 explicitly Phase 2. |
| Reviewer ↔ applicant communication | Spec §2. |
| Reviewer profile page | Existing `/apply/profile` shared shell suffices. |
| PDF export from scoring page | Phase 2 (mirrors leadership's stubbed-disabled button). |
| Mobile / tablet scoring UX | Reviewers do focused desk work — single-screen "use desktop" card below 1024px. |
| Reviewer dashboard with workload stats | Phase 2; manager view, not reviewer view. |
| Bulk-decline, re-open locked review | YAGNI. |

### Out of scope (forever)

- Reviewers seeing other reviewers' scores (spec §2)
- Applicants seeing reviewer identities or scores (spec §2)

---

## 3. Worktree isolation context

Three parallel Claude sessions are working on this repo (see memory `parallel-streams-2026-05`). To avoid cross-contamination:

- This branch (`feature/reviewer-screens`) lives in a dedicated worktree at `.claude/worktrees/feature-reviewer-screens`.
- Branched from `origin/staging-role_based_dashboard` (not local) so the import session's unpushed commits stay isolated.
- **Implementation copies** the leadership review chrome rather than importing it — every file overlap with the UI-polish session's branch is a merge conflict risk. The duplication is paid back as a small post-merge refactor.

---

## 4. Pages

### 4.1 Page set

```
/reviewer                              → redirect to /reviewer/inbox
/reviewer/inbox                        → ReviewerInboxPage         (in app shell + rail)
/reviewer/completed                    → ReviewerCompletedPage     (in app shell + rail)
/reviewer/:track/:id/score             → ReviewerScoringPage       (full-width, no rail)
```

All routes are protected by `require_capability("view_assigned_apps")` at the router layer. Reviewer scoring also requires `require_capability("score_app")` for write operations (server-side).

### 4.2 Reviewer app shell

Uses the design-system §5.1 app shell verbatim. Three stacked bars:

- `.app-betabar` — black `STAGING · BETA` strip identical to admin
- `.app-header` — IISc seal · 1px × 32px `--line-strong` rule · ARTPARK wordmark · `.role-tag REVIEWER` · spacer · switch-role ghost link (only when user has multiple roles) · `.user-chip` with initials avatar in `--artblue`
- Left rail (`.app-rail`, 240px sticky):
  - Section header `REVIEWS`
  - `Inbox` rail-link (active on `/reviewer/inbox`)
  - `Completed` rail-link (active on `/reviewer/completed`)
  - 1px `--line` divider
  - `Support` rail-link → `/apply/support`

**Scoring page exits the rail layout.** It uses its own sticky top chrome (§6.1) so the reviewer has maximum reading space.

### 4.3 Inbox page

Cards grouped by status: **To review** (no submitted review yet) and **Editable** (submitted within last 60 min).

```
Filter bar (.filter-bar):  [search]  [All] [TIR] [SIP]

TO REVIEW · 3
┌── .card ───────────────────────────────────────────┐
│ TIR-2026-abc12345              •  EdTech          │
│ "AI tutoring for K-12 in rural India"             │
│ Assigned 2 days ago by Dev Dayan                  │
│                                                    │
│                [ Decline ]  [ Score this → ]      │
└────────────────────────────────────────────────────┘

EDITABLE · 1 · within 60-min edit window
┌── .card (editable variant) ────────────────────────┐
│ TIR-2026-ghi13579  ●dot.amber                     │
│ "Voice-first banking for low-literacy users"      │
│ Edit window closes in 47:23                       │
│                              [ Edit review → ]    │
└────────────────────────────────────────────────────┘
```

| UI piece | Primitive |
|---|---|
| Section eyebrow `TO REVIEW · 3` | `.eyebrow` (no `.eyebrow-rule` — that's page-level) |
| Card | `.card`, sharp corners, no shadow |
| App identifier | `var(--font-display)` 600 14px, 0.04em tracking |
| Problem one-liner | 18px `--ink`, max 2 lines + ellipsis |
| Metadata row | 13px `--ink-soft`, items separated by inline 8×8 `--ink-dim` dots |
| `Decline` | `.btn .btn-ghost` |
| `Score this →` | `.btn .btn-primary` with `<span class="arrow">→</span>` |
| Editable status dot | `.dot.amber` |
| `Edit review →` | `.btn .btn-dark` |
| Empty state | `.card.card-soft`, centered, eyebrow + h3 + sub + `Clear filters` ghost |
| Loading | Three placeholder `.card` blocks filled with `--paper-soft` rectangles |

**Filter:** client-side (≤15 typical assignments).

**Decline:** card button opens `DeclineAssignmentModal` (§5.5 primitive). Required reason ≥10 chars. Confirm → POST `/reviewer/assignments/{id}/decline` → toast info variant → card removed.

**Countdown:** rerender every 30 seconds (not per-second). When `locked_at` passes, next inbox refetch drops the card; we don't animate disappearance.

### 4.4 Scoring page

Full-width. Two columns. Three states.

```
┌── Sticky header (h-72px) ────────────────────────────────────┐
│ [← Inbox]  TIR-2026-abc12345  ●Under review   [Prev] [Next] │
└──────────────────────────────────────────────────────────────┘
┌── Left main: applicant Q/A (scrolls) ─┐ ┌── Right aside (480px sticky) ─┐
│  SECTION 1 — Problem & Context        │ │  SCORING PANEL                 │
│  Q: ...                               │ │  (state A | B | C, §4.4.2-4)   │
│  A: ... (SectionBlock + QuestionBlock)│ │                                │
│  ...                                  │ │                                │
└───────────────────────────────────────┘ └────────────────────────────────┘
```

**Top chrome (`ReviewerScoringHeader`)** — copy of leadership's `ReviewHeader` markup minus the AI overall-score chip and the aside toggle (panel is never collapsible). Back button label `← Inbox`, lands at `/reviewer/inbox` (not `navigate(-1)` — same lesson as leadership commit `93fa4c9`). Prev/Next walks the reviewer's own inbox cache stored in `sessionStorage` under `reviewer_inbox_id_list`.

**Prev/Next enabled-state rule:**
- State A (scoring in progress) — **disabled** (partially-filled form would be lost)
- State B (submitted, editable) — **disabled** (in-flight edits would be lost)
- State C (locked, read-only) — **enabled** (nothing to lose)

Buttons that walk an app that isn't in the cached inbox queue render disabled (e.g., when the reviewer reached State C from the Completed page rather than the Inbox).

**Left main:** copied verbatim from `pages/leadership/review/`: `ApplicationTab.jsx`, `SectionBlock.jsx`, `QuestionBlock.jsx`, `applicationSchemas.js`, and the entire `answers/` directory.

#### 4.4.1 State machine

```
                  On mount:
  ── PARALLEL ───────────────────────────────────────────────
  GET /reviewer/reviews/mine?application_id={id}
  GET /reviewer/applications/{track}/{id}   ← ai_screening stripped iff no submitted review
  ── END PARALLEL ───────────────────────────────────────────
        │
        ▼
  Render route:
    my_review is null                     → STATE A (scoring, AI hidden)
    my_review.locked_at > now()           → STATE B (editable, AI shown)
    my_review.locked_at <= now()          → STATE C (locked, AI shown)

  Submit (State A):
    POST /reviewer/reviews   → returns review_id, submitted_at, locked_at
    refetch app detail       → now returns ai_screening populated
    snap to STATE B, start countdown

  Edit (State B):
    "Edit my review" → returns to A-style form with values prefilled
    Submit → PATCH /reviewer/reviews/{id}
      200 → back to STATE B with new values
      423 → toast "edit window closed", flip to STATE C

  Tick (State B):
    countdown text updates every 30s
    line color: black → amber at < 5min → coral at < 1min
    on hit zero → next page render shows STATE C
```

#### 4.4.2 State A — scoring (AI hidden)

```
SCORE THIS APPLICATION                  ← .eyebrow
Read carefully. Your scores stay private
until leadership compares them.

── Problem importance & clarity ─────
  [1][2][3][4][5][6][7][8][9][10]      ← .score-seg
── Solution depth & completeness ────
  [1][2][3][4][5][6][7][8][9][10]
── Technical strength ───────────────
  [1][2][3][4][5][6][7][8][9][10]
── Founder traits ───────────────────
  [1][2][3][4][5][6][7][8][9][10]
── Commitment level ─────────────────
  [1][2][3][4][5][6][7][8][9][10]

── Recommendation ───────────────────
  [  Yes  ] [  Maybe  ] [  No  ]       ← .score-seg.is-rec

Strengths
[textarea, 3 rows, .field]
Concerns
[textarea, 3 rows, .field]
Quick notes (private to you)
[textarea, 2 rows, .field]

─────────────────────────────────────
  [ Save draft ]  [ Submit review → ]   ← sticky panel footer
```

`Save draft` POSTs with `draft=true`. Draft rows have `submitted_at=NULL`, `locked_at=NULL`, no email, no status transition. Drafts are private — only fetched by `/reviewer/reviews/mine`.

`Submit review →` disabled until all 5 scores set + recommendation picked. Strengths/Concerns/Quick notes optional.

**`.score-seg` CSS** (derived primitive — not a new token, follows `.chip` shape from §5.4):

```css
.score-seg { display: flex; gap: 4px; margin-top: var(--s-2); }
.score-seg button {
  flex: 1; height: 32px;
  font-family: var(--font-display); font-weight: 600; font-size: 13px;
  color: var(--ink); background: var(--paper);
  border: 1px solid var(--line-strong); border-radius: var(--r-sharp);
  cursor: pointer;
  transition: background 150ms ease, border-color 150ms ease, color 150ms ease;
}
.score-seg button:hover { border-color: var(--ink); }
.score-seg button[aria-pressed="true"] {
  background: var(--artblue); border-color: var(--artblue); color: #fff;
}
.score-seg.is-rec button { flex: 0 0 80px; height: 36px; font-size: 14px; }
```

Keyboard: ←/→ moves selection within a category. Enter/Space selects. Tab moves between categories. Each button has `aria-label="Score N out of 10 for {category}"`.

#### 4.4.3 State B — submitted, within 60-min edit window

```
REVIEW SUBMITTED · ✓                   ← .eyebrow in --accent-green
You can edit until 4:37 PM (47:12 left).
─────────────────────────────────────

Your scores vs AI:                     ← h3

Problem importance
You: ■■■■■■■□□□  7   AI: ■■■■■■■■□□  8

Solution depth
You: ■■■■■□□□□□  5   AI: ■■■■■■□□□□  6

Technical strength
You: ■■■■■■□□□□  6   AI: ■■■■■■■□□□  7

Founder traits
You: ■■■■■■■■□□  8   AI: ■■■■■■■□□□  7

Commitment
You: ■■■■■■■□□□  7   AI: ■■■■■■■■□□  8

Recommendation: Maybe
AI summary: [first 240 chars of ai_screening.summary, …]
   ← if summary contains "Stub mode", show inline STUB chip

─────────────────────────────────────
  [ Edit my review → ]
```

Reuses leadership `.bar-row` / `.bar-track` / `.bar-fill` markup from §5.9. `You` bars in `--artblue`; `AI` bars in `--ink-soft`. Countdown text color: `--ink` → `--accent-amber` (< 5 min) → `--accent-coral` (< 1 min). No flashing/pulsing animation (§7 anti-pattern).

#### 4.4.4 State C — locked (read-only)

Same layout as State B but:
- Top eyebrow: `REVIEW SUBMITTED · LOCKED`
- No countdown line
- No edit button
- Sticky footer: `[ ← Back to inbox ]` only (top-chrome Prev/Next handles cross-app navigation)

State C is also what the Completed page links into. The `← Back to inbox` button always lands at `/reviewer/inbox` regardless of where the user arrived from — predictable destination beats clever referrer logic.

#### 4.4.5 Anti-anchoring guarantee — two layers

1. **Server-side (load-bearing):** `GET /reviewer/applications/{track}/{id}` returns `ai_screening: null` when the caller has no submitted review. A curl bypass can't reach the AI scores.
2. **Client-side (defense in depth):** even if `ai_screening` is populated, the scoring panel never renders AI bars while in State A.

#### 4.4.6 Viewport breakpoint

The scoring page requires ≥1024px viewport width (`@media (min-width: 1024px)`). Below that, the page renders a single `.card.card-soft` filling the viewport:

```
USE A DESKTOP
Scoring requires a wider screen.
This page needs at least 1024 pixels wide to show the application
content and the scoring panel side by side. Open this link on
a laptop or desktop.

[ ← Back to inbox ]
```

Inbox and Completed pages inherit whatever responsive behavior `.app-shell` already provides for admin/leadership — desktop-first today. Improving rail collapse on tablet is a cross-cutting concern handled outside this branch.

### 4.5 Completed history page

Read-only archive of locked reviews.

```
[ All · 16 ] [ TIR · 12 ] [ SIP · 4 ]

┌── .tbl ──────────────────────────────────────────────────────────┐
│ APPLICATION             │TRACK│MY SCORE│MY REC│SUBMITTED  │  •  │
├─────────────────────────┼─────┼────────┼──────┼───────────┼─────┤
│ TIR-2026-abc12345       │ TIR │  6.6   │Maybe │2 days ago │  →  │
│ "AI tutoring K-12…"     │     │        │      │           │     │
│ ...                                                              │
└──────────────────────────────────────────────────────────────────┘
[ ← Previous ]   Page 1 of 2   [ Next → ]
```

| Column | Detail |
|---|---|
| `APPLICATION` | App id in `--font-display` 600 + problem one-liner below as `.sub` |
| `TRACK` | Plain text, no pill (§1 rule 16) |
| `MY SCORE` | Right-aligned, tabular-nums. Weighted avg per spec §4.3 weights: Problem 22% / Solution 30% / Tech 22% / Founders 14% / Commitment 12%. Server-computed for parity with `ai_screening.score_overall`. |
| `MY REC` | Plain text `Yes` / `Maybe` / `No` |
| `SUBMITTED` | Relative time; full timestamp on hover via `title` |
| `•` | Single `→`; row click navigates to scoring page (renders State C) |

**Filter:** `.filter-chips` — `All` (default), `TIR`, `SIP`.

**Pagination:** ghost `← Previous` / `Next →` with `Page N of M` in `--ink-dim`. 20 per page.

**Empty state:** `.card.card-soft`, eyebrow `NO REVIEWS YET`, h3 `Nothing here yet.`, sub `Your locked reviews land here after the 60-minute edit window closes.`. No CTA.

**Sort:** default `submitted_at DESC`. Headers not sortable in Phase 1.5.

### 4.6 Decline modal

Opens from inbox card `Decline` button.

```
ASSIGNMENT                      ← .modal-eyebrow
Decline this assignment.        ← h2

Leadership will be notified and may reassign this application.
Tell them why so they pick someone better next time.

Reason
[textarea, 4 rows, .field]

──────────────────────────────────
   [ Cancel ]  [ Decline assignment ]
```

`Cancel` = `.btn-ghost`. `Decline assignment` = destructive primary (`.btn-primary` with `background: var(--accent-coral)`, hover `#e94a4e`). Submit POSTs to `/reviewer/assignments/{id}/decline`. Required reason ≥10 chars. Backend appends `audit_log_v2` and sends best-effort email (Resend 5xx does not roll back).

---

## 5. File structure

New files under `frontend/src/pages/reviewer/`:

```
reviewer/
├── ReviewerAppShell.jsx           ← top bars + rail
├── ReviewerInboxPage.jsx          ← grouped card list
├── ReviewerCompletedPage.jsx      ← past reviews table
├── ReviewerScoringPage.jsx        ← two-column scoring surface, 3 states
├── inboxCardStates.js             ← assignment → card-state mapper
├── review/                        ← COPIED from leadership/review/
│   ├── ReviewHeader.jsx           ← copy, dropped AI chip + aside toggle
│   ├── ApplicationTab.jsx         ← copy verbatim (no tab chrome — used as standalone body)
│   ├── QuestionBlock.jsx          ← copy verbatim
│   ├── SectionBlock.jsx           ← copy verbatim
│   ├── applicationSchemas.js      ← copy verbatim
│   └── answers/                   ← copy entire dir
└── scoring/                       ← new, reviewer-only
    ├── ReviewerScoringPanel.jsx   ← state-aware right rail
    ├── ScoreSegmentInput.jsx      ← 10-button segmented control
    ├── RecommendationInput.jsx    ← Yes / Maybe / No segmented
    ├── EditWindowCountdown.jsx    ← mm:ss until locked_at
    ├── AIComparisonView.jsx       ← side-by-side bars (State B/C)
    └── DeclineAssignmentModal.jsx ← modal launched from inbox

frontend/src/lib/reviewerApi.js    ← new API client, mirrors leadershipApi.js
frontend/src/styles/reviewer.css   ← new; only @imports colors_and_type.css + the .scoring-panel, .score-seg additions
```

New routes added to `frontend/src/router.jsx`. Gated by `reviewer` capability (frontend) + `view_assigned_apps` (backend).

**Why copy rather than import:** the UI-polish session is actively editing `frontend/src/pages/leadership/` files. Importing from there guarantees merge conflicts. Copying lets both branches merge in any order. Post-merge refactor extracts a shared `pages/review/` if it earns its keep.

---

## 6. Backend

All routes live in `backend/app/routers/reviewer.py` (new file). Every mutation appends to `audit_log_v2` (spec §4.6). Every endpoint enforces `require_capability("...")` and (where `track` is in the path) `require_track()`.

### 6.1 Endpoint summary

| Method | Path | Capability | Status |
|---|---|---|---|
| GET    | `/reviewer/assignments` | `view_assigned_apps` | exists (§5.4); shape filled in here |
| GET    | `/reviewer/applications/{track}/{id}` | `view_assigned_apps` | **NEW** (anti-anchoring) |
| GET    | `/reviewer/reviews/mine?application_id=…` | `view_assigned_apps` | **NEW** |
| GET    | `/reviewer/reviews?mine=true&locked=true&track=…&page=…` | `view_assigned_apps` | **NEW** |
| POST   | `/reviewer/reviews` | `score_app` | exists (§5.4); adds `draft` flag |
| PATCH  | `/reviewer/reviews/{review_id}` | `score_app` | exists (§5.4); 423 after lock |
| POST   | `/reviewer/assignments/{id}/decline` | `decline_assignment` | exists (§5.4) |

### 6.2 `GET /reviewer/assignments`

Returns only assignments where `reviewer_user_id = caller`, `declined_at IS NULL`, `reassigned_to IS NULL`, and either no review exists OR `now() < review.locked_at`. Locked-submitted reviews are filtered out (those belong on `/reviewer/reviews?locked=true`).

```json
{
  "assignments": [
    {
      "assignment_id": "uuid",
      "application_id": "uuid",
      "application_track": "tir",
      "app_identifier": "TIR-2026-abc12345",
      "industry": "EdTech",
      "problem_one_liner": "AI tutoring for K-12 in rural India",
      "assigned_at": "2026-05-16T09:14:22Z",
      "assigned_by_display": "Dev Dayan",
      "my_review": null
    },
    {
      "assignment_id": "uuid",
      "application_id": "uuid",
      "application_track": "tir",
      "app_identifier": "TIR-2026-ghi13579",
      "industry": "FinTech",
      "problem_one_liner": "Voice-first banking for low-literacy users",
      "assigned_at": "2026-05-17T08:00:00Z",
      "assigned_by_display": "Dev Dayan",
      "my_review": {
        "review_id": "uuid",
        "submitted_at": "2026-05-18T15:25:00Z",
        "locked_at":   "2026-05-18T16:25:00Z"
      }
    }
  ]
}
```

`problem_one_liner` = first 140 chars of the Q1 "What problem are you solving?" answer, ellipsized. Computed server-side.

### 6.3 `GET /reviewer/applications/{track}/{id}` — the privacy boundary

Caller must have an active (non-declined, non-reassigned) assignment for this app, else 403.

```json
{
  "application":   { ... same shape as /leadership/applications/{track}/{id}.application ... },
  "assignment":    { "assignment_id": "...", "assigned_at": "..." },
  "my_review":     null | { ...full review row... },
  "ai_screening":  null     // stripped iff my_review is null OR my_review.submitted_at is null
}
```

Decision rule:
```python
if my_review is None or my_review.submitted_at is None:
    response["ai_screening"] = None
else:
    response["ai_screening"] = fetch_ai_screening(application_id, track)
```

The frontend's check is `if (ai_screening) { ... }`. The field is always present in the response shape (null vs object) so client code doesn't branch on key existence.

### 6.4 `POST /reviewer/reviews` — submit or draft

Body:

```json
{
  "application_id":     "uuid",
  "application_track":  "tir",
  "assignment_id":      "uuid",
  "score_problem":      7,
  "score_solution":     5,
  "score_tech":         6,
  "score_founders":     8,
  "score_commitment":   7,
  "recommendation":     "maybe",
  "strengths":          "string|null",
  "concerns":           "string|null",
  "quick_notes":        "string|null",
  "draft":              false
}
```

**Validation (422 on failure):**
- All 5 scores: integers 0–10. Required when `draft=false`.
- `recommendation` ∈ `{"yes","maybe","no"}`. Required when `draft=false`.
- `score_integrity` not accepted (Phase 2 column, spec §4.3).
- `disagree_with_ai` not accepted (Phase 2).

**Server side effects (single transaction):**
1. Insert `reviews` row. If not draft: `submitted_at = now()`, `locked_at = submitted_at + interval '60 minutes'`. If draft: both NULL.
2. If not draft: `UPDATE reviewer_assignments SET completed_at = now()`.
3. Append `audit_log_v2`: `action_type="submit_review"` (or `"draft_review"`), before/after states.
4. **Auto-transition trigger** (closes spec §14.4): after the insert, count `reviewer_assignments` rows with `completed_at IS NOT NULL` for this app. If equals active assignment count, call `state_machine.transition(app_id, "evaluated", reason="all reviewers submitted")`. Email to leadership is best-effort (Resend 5xx swallowed per §8).

Returns the inserted review row + `application_id`.

### 6.5 `PATCH /reviewer/reviews/{review_id}`

Auth: caller must own the review (`reviewer_user_id`), else 403.

Lock check: if `now() > reviews.locked_at`, return **423 Locked** with body:
```json
{ "code": "review_locked", "message": "Edit window closed at 2026-05-18T16:25:00Z." }
```

Body accepts the same fields as POST, all optional (only the diff). `locked_at` is **not** extended on edit — anchored to original `submitted_at + 60 min`.

A draft transitioning to non-draft via PATCH (`draft=false`) sets `submitted_at = now()` and `locked_at = now() + 60 min` and triggers the same auto-transition + email as POST.

### 6.6 `GET /reviewer/reviews` — Completed history list

Query params:
- `mine=true` (required; 400 if missing — we don't expose other reviewers' work)
- `locked=true` (`locked_at <= now()`)
- `track=tir|sip|all` (default `all`)
- `page=N`, `page_size=20`

```json
{
  "reviews": [
    {
      "review_id": "uuid",
      "application_id": "uuid",
      "application_track": "tir",
      "app_identifier": "TIR-2026-abc12345",
      "problem_one_liner": "…",
      "score_overall_mine": 6.6,
      "recommendation": "maybe",
      "submitted_at": "…"
    }
  ],
  "page": 1,
  "total_pages": 1,
  "total": 12
}
```

`score_overall_mine` server-computed with the same weights as `ai_screening.score_overall` (Problem 22%, Solution 30%, Tech 22%, Founders 14%, Commitment 12%) so the two numbers are directly comparable on Scoring State B.

### 6.7 `GET /reviewer/reviews/mine?application_id=…`

Returns `{"review": null}` or the caller's review row for that one app. Cheap probe used on Scoring page mount to pick the initial state (A/B/C) before the full app detail fetch resolves.

### 6.8 `POST /reviewer/assignments/{id}/decline`

Already specced (§5.4). Body `{"reason": "string"}`, reason required ≥10 chars. Side effects: `declined_at = now()`, `decline_reason` set, `audit_log_v2` row, best-effort email to leadership.

### 6.9 Scoring page request sequence

```
ReviewerScoringPage mounts (track, id)
        │
        ▼
─── PARALLEL ───────────────────────────────────
GET /reviewer/reviews/mine?application_id={id}
GET /reviewer/applications/{track}/{id}
─── END PARALLEL ───────────────────────────────
        │
        ▼
Pick state A/B/C from my_review + now()

On submit:        POST /reviewer/reviews → refetch app detail (now has ai_screening) → State B
On edit (B→A):    flip panel, prefill, "Save changes →" replaces "Submit review →"
On save (A→B):    PATCH /reviewer/reviews/{id} → snap to B
On 423:           toast, flip to State C
On countdown 0:   next render shows State C (server side returns same data; locked_at < now)
```

---

## 7. Capability map

Reuses spec §3.2 capabilities. No new capabilities introduced.

| Capability | Routes |
|---|---|
| `view_assigned_apps` | All `GET /reviewer/*` |
| `score_app` | `POST /reviewer/reviews`, `PATCH /reviewer/reviews/{id}` |
| `decline_assignment` | `POST /reviewer/assignments/{id}/decline` |

Frontend route guard uses the existing `ProtectedRoute` pattern with the `reviewer` role. Users with `leadership + reviewer` both granted can access `/reviewer/*` and `/leadership/*` — capability union per spec §3.2.

---

## 8. Testing

### 8.1 Backend (`backend/tests/test_reviewer.py` — new)

Pattern: pytest + existing `client` fixture + transactional rollback per test.

| Test | Pins |
|---|---|
| `test_inbox_returns_only_my_active_assignments` | Per-reviewer filtering; declined/reassigned excluded |
| `test_inbox_includes_my_review_when_unlocked` | `my_review` populated when `now < locked_at` |
| `test_inbox_excludes_assignment_after_lock` | Locked-submitted assignments filtered out |
| `test_app_detail_strips_ai_when_no_submitted_review` | **The load-bearing privacy test.** `ai_screening: null` even when DB row exists |
| `test_app_detail_includes_ai_after_submit` | Post-submit refetch reveals `ai_screening` |
| `test_app_detail_403_when_not_assigned` | Reviewer with no assignment → 403 |
| `test_submit_review_validation` | Missing score → 422; score=11 → 422; `recommendation="foo"` → 422; `score_integrity` in body → 422 |
| `test_submit_review_sets_locked_at_60_min` | `locked_at - submitted_at == 60 min` (freezegun) |
| `test_patch_review_within_window_succeeds` | freeze submit+30min, PATCH 200 |
| `test_patch_review_after_lock_returns_423` | freeze submit+61min, PATCH returns 423 + `code="review_locked"` |
| `test_patch_review_does_not_extend_lock` | `locked_at` invariant across multiple PATCHes |
| `test_all_reviewers_complete_triggers_evaluated` | **Closes spec §14.4.** 2 active assignments, both submit, status → `evaluated`, `application_status_log` row written |
| `test_partial_completion_does_not_transition` | 1 of 2 submits → status stays `under_review` |
| `test_completed_list_only_locked_mine` | Only caller's locked reviews returned |
| `test_decline_sends_email_and_audit_logs` | `declined_at` set, audit row written, Resend called once. Resend 5xx does not roll back |
| `test_draft_mode_no_email_no_status_transition` | `submitted_at IS NULL` after draft POST; no email; status unchanged |

### 8.2 Frontend (`frontend/src/pages/reviewer/__tests__/` — new)

Vitest + RTL + MSW. Template: existing leadership tests.

| Test | Pins |
|---|---|
| `ReviewerInboxPage.test.jsx` | Cards group To-review vs Editable; decline modal opens; decline API call removes card |
| `DeclineAssignmentModal.test.jsx` | Submit disabled until reason ≥10 chars; cancel closes without API call |
| `ReviewerScoringPanel.A.test.jsx` | All 10 segments per category; ←/→ keyboard nav; submit disabled until complete |
| `ReviewerScoringPanel.A-to-B.test.jsx` | Successful POST → State B with comparison bars |
| `ReviewerScoringPanel.B.countdown.test.jsx` | `< 5min` → amber; `< 1min` → coral |
| `ReviewerScoringPanel.PATCH-423.test.jsx` | 423 response → flip to State C + toast |
| `ReviewerScoringPage.AI-hidden-in-A.test.jsx` | `ai_screening: null` → no AI bars rendered (defense-in-depth) |
| `ReviewerCompletedPage.test.jsx` | Table renders; `score_overall_mine` shown to 1 decimal; row click navigates |
| `ScoreSegmentInput.test.jsx` | `aria-pressed="true"` on selected; per-button `aria-label`; ←-from-1 wraps to 10 |

### 8.3 Acceptance criteria (closing spec §14)

| Spec | Criterion | Verification |
|---|---|---|
| §14.3 | Reviewer can submit a review | Manual test on Vercel preview: reviewer1@artpark.test → inbox → Score → submit → Supabase row check |
| §14.4 | Status auto-moves to `evaluated` | Backend test `test_all_reviewers_complete_triggers_evaluated` + manual staging run with 2 reviewers |
| §14.10 | Lighthouse ≥85 on scoring page | Manual run after merge — target ≥90 (minimal JS, no charts, no images) |

### 8.4 Manual QA pass (pre-merge)

On `ap-os-git-feature-reviewer-screens-artpark.vercel.app`:

1. Sign in as reviewer test user → `/reviewer/inbox` renders correct groups
2. Click `Score this →` → scoring page loads. Network: `/reviewer/applications/...` returns `ai_screening: null` ✓
3. Fill 5 scores + recommendation → Submit enables → submit → State B; second `/reviewer/applications/...` request now has `ai_screening` populated ✓
4. Edit a score → save → State B refreshed; `locked_at` unchanged
5. Wait 60 min (or set clock) → reload → State C; no edit button
6. Sign in as leadership → app's status chip is `EVALUATED` (if all reviewers submitted)
7. Decline a different assignment → toast → card disappears → leadership audit feed shows decline event
8. Open Completed → only locked-submitted; declined absent. Click into one → State C read-only

### 8.5 Anti-pattern check (run before opening PR)

```bash
git diff origin/staging-role_based_dashboard -- 'frontend/**' \
  | grep -E '(rounded-(md|lg|xl|2xl|3xl|full)|box-shadow|linear-gradient|hover:scale|hover:translate|backdrop-filter|#3213b7|#aafcf0|font-family.*Inter)' \
  && echo "DESIGN-SYSTEM VIOLATION" && exit 1
echo "Clean"
```

Anything caught gets fixed, not whitelisted.

---

## 9. Migration / DB changes

**None.** Schema is the same as Phase 1 (migration 014_admin_platform_phase1 + 015 status CHECK). All work is route handlers + frontend.

---

## 10. Open decisions resolved during brainstorm

| Decision | Resolved as |
|---|---|
| Page set | Inbox + Scoring + Completed history (3 pages) |
| Scoring layout | Two-column: app left, scoring panel right |
| AI score visibility to reviewer | Hidden until submit; revealed in State B/C (anti-anchoring) |
| Edit-window UX | Live countdown + edit-in-place |
| Score input control | 10 segmented buttons (1–10), keyboard-navigable |
| Inbox layout | Cards grouped by status (To review / Editable) |
| Implementation approach | Copy leadership review chrome into `pages/reviewer/` (zero file overlap with the UI-polish session's branch) |
| `applicationSchemas.js` + `answers/` | Copy verbatim, don't import |
| Privacy enforcement | Server-side strip in `GET /reviewer/applications/{track}/{id}` (load-bearing) + client-side hide (defense in depth) |

---

## 11. Glossary

- **State A / B / C** — scoring page render modes: pre-submit / submitted-editable / locked
- **Locked review** — `now() > reviews.locked_at`. PATCH returns 423.
- **Active assignment** — `declined_at IS NULL AND reassigned_to IS NULL`
- **Anti-anchoring guarantee** — the server-side rule that strips `ai_screening` from the response when the caller has no submitted review for the app
- **The three-stream layout** — see memory `parallel-streams-2026-05`; this branch is stream #3
